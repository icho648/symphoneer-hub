import cors from "cors";
import express, { type Request } from "express";
import pinoHttp from "pino-http";
import {
  CreateInstallationSchema,
  CreatePairingCodeSchema,
  PairConnectorSchema,
  PauseAttemptSchema,
  createOpaqueToken,
  createPairingCode,
  digestSecret,
  normalizePairingCode,
  redact,
  type RuntimeCommand,
} from "@symphoneer-hub/contracts";
import type { HubRepository } from "@symphoneer-hub/database";
import type {
  CommandQueue,
  FixedWindowRateLimiter,
  PresenceStore,
} from "@symphoneer-hub/relay";
import type pino from "pino";
import type { ApiConfig } from "./config.js";
import { type AuthenticatedRequest, createAuthMiddleware } from "./auth.js";
import { ApiError, errorHandler } from "./errors.js";

export type ApiDependencies = {
  config: ApiConfig;
  repository: HubRepository;
  commandQueue: CommandQueue;
  presence: PresenceStore;
  pairingLimiter: FixedWindowRateLimiter;
  logger: pino.Logger;
  redisPing: () => Promise<void>;
};

function parseBody<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "invalid_request", "request body is invalid");
  return parsed.data;
}

function installationId(request: Request): string {
  const value = request.params.installationId;
  if (!value) throw new ApiError(400, "invalid_installation", "installation ID is required");
  return value;
}

export function createApiApp(dependencies: ApiDependencies) {
  const { config, repository, commandQueue, logger } = dependencies;
  const app = express();

  app.disable("x-powered-by");
  if (config.TRUST_PROXY_HOPS > 0) app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use(
    pinoHttp({
      logger,
      customProps: (request) => ({ requestId: request.id }),
      serializers: {
        req: (request) => ({ method: request.method, url: request.url }),
        res: (response) => ({ statusCode: response.statusCode }),
        err: (error) => redact({ type: error.type, message: error.message, stack: error.stack }),
      },
    }),
  );
  app.use(cors({ origin: config.WEB_ORIGIN, allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-dev-user-id"] }));
  app.use(express.json({ limit: "512kb" }));

  app.get("/healthz/live", (_request, response) => response.json({ status: "ok" }));
  app.get("/healthz/ready", async (_request, response, next) => {
    try {
      await Promise.all([repository.ping(), dependencies.redisPing()]);
      response.json({ status: "ok" });
    } catch (error) {
      next(new ApiError(503, "not_ready", "database or relay is unavailable"));
    }
  });

  const authenticate = createAuthMiddleware(config);

  app.post("/v1/installations", authenticate, async (request, response) => {
    const input = parseBody(CreateInstallationSchema, request.body);
    const user = (request as AuthenticatedRequest).user;
    const row = await repository.createInstallation(user.id, input.name);
    response.status(201).json({ installation: row });
  });

  app.get("/v1/installations", authenticate, async (request, response) => {
    const user = (request as AuthenticatedRequest).user;
    const rows = await repository.listInstallations(user.id);
    const enriched = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        online: await dependencies.presence.isOnline(row.id),
      })),
    );
    response.json({ installations: enriched });
  });

  app.post("/v1/installations/:installationId/pairing-codes", authenticate, async (request, response) => {
    const input = parseBody(CreatePairingCodeSchema, request.body ?? {});
    const user = (request as AuthenticatedRequest).user;
    const code = createPairingCode();
    const normalized = normalizePairingCode(code);
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    await repository.createPairingCode({
      ownerId: user.id,
      installationId: installationId(request),
      codeHash: digestSecret(normalized, config.PAIRING_PEPPER),
      expiresAt,
    });
    response.status(201).json({ code, expiresAt: expiresAt.toISOString() });
  });

  app.post("/v1/connectors/pair", async (request, response) => {
    const input = parseBody(PairConnectorSchema, request.body);
    const rateKey = digestSecret(request.ip || request.socket.remoteAddress || "unknown", config.PAIRING_PEPPER).slice(0, 32);
    if (!(await dependencies.pairingLimiter.consume(`pair:${rateKey}`, 10, 60))) {
      throw new ApiError(429, "pairing_rate_limited", "too many pairing attempts");
    }
    let normalized: string;
    try {
      normalized = normalizePairingCode(input.code);
    } catch {
      throw new ApiError(400, "invalid_pairing_code", "pairing code has an invalid format");
    }
    const deviceToken = createOpaqueToken(32);
    const result = await repository.consumePairingCode({
      codeHash: digestSecret(normalized, config.PAIRING_PEPPER),
      runtimeId: input.runtimeId,
      connectorName: input.connectorName,
      tokenHash: digestSecret(deviceToken, config.DEVICE_TOKEN_PEPPER),
    });
    response.status(201).json({
      installationId: result.credential.installationId,
      runtimeId: result.credential.runtimeId,
      deviceToken,
    });
  });

  app.get("/v1/installations/:installationId/snapshot", authenticate, async (request, response) => {
    const user = (request as AuthenticatedRequest).user;
    const snapshot = await repository.getSnapshot(user.id, installationId(request));
    if (!snapshot) throw new ApiError(404, "snapshot_not_found", "runtime snapshot not found");
    response.json(snapshot);
  });

  app.post("/v1/installations/:installationId/commands/pause-attempt", authenticate, async (request, response) => {
    const input = parseBody(PauseAttemptSchema, request.body);
    const user = (request as AuthenticatedRequest).user;
    const idempotencyKey = request.header("idempotency-key")?.trim();
    if (!idempotencyKey) throw new ApiError(400, "idempotency_key_required", "Idempotency-Key header is required");
    const command: RuntimeCommand = {
      kind: "pause_attempt",
      idempotencyKey,
      attemptId: input.attemptId,
      expectedEventSequence: input.expectedEventSequence,
      expectedAttemptUpdatedAt: input.expectedAttemptUpdatedAt,
    };
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
    const created = await repository.createCommand({
      ownerId: user.id,
      installationId: installationId(request),
      runtimeId: input.runtimeId,
      targetId: input.attemptId,
      idempotencyKey,
      expectedEventSequence: input.expectedEventSequence,
      expectedTargetUpdatedAt: new Date(input.expectedAttemptUpdatedAt),
      command,
      expiresAt,
    });
    const row = created.command;
    if (row.status === "created") {
      try {
        await commandQueue.enqueue(row.id);
        await repository.setCommandStatus({ commandId: row.id, status: "queued" });
      } catch {
        throw new ApiError(503, "relay_unavailable", `command ${row.id} was persisted but could not be queued; retry with the same idempotency key`);
      }
    }
    const terminal = ["succeeded", "rejected", "conflict", "expired", "failed"].includes(row.status);
    response.status(terminal ? 200 : 202).json({
      commandId: row.id,
      status: row.status === "created" ? "queued" : row.status,
      expiresAt: row.expiresAt.toISOString(),
      replayed: !created.created,
    });
  });

  app.get("/v1/installations/:installationId/commands/:commandId", authenticate, async (request, response) => {
    const user = (request as AuthenticatedRequest).user;
    const commandId = request.params.commandId;
    if (!commandId) throw new ApiError(400, "invalid_command", "command ID is required");
    const row = await repository.getCommandForOwner(user.id, installationId(request), commandId);
    if (!row) throw new ApiError(404, "command_not_found", "command not found");
    response.json({ command: row });
  });

  app.use(errorHandler);
  return app;
}
