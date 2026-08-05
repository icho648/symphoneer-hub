import pino from "pino";
import { z } from "zod";
import {
  HubToConnectorMessageSchema,
  RuntimeCommandSchema,
  isCommandExpired,
  redact,
} from "@symphoneer-hub/contracts";
import { createDatabase, HubRepository } from "@symphoneer-hub/database";
import {
  CommandPublisher,
  CommandQueue,
  PresenceStore,
  createCommandWorker,
  createRedis,
} from "@symphoneer-hub/relay";

const config = z
  .object({ DATABASE_URL: z.string().url(), REDIS_URL: z.string().url() })
  .parse(process.env);
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const { db, client: postgres } = createDatabase(config.DATABASE_URL);
const repository = new HubRepository(db);
const workerRedis = createRedis(config.REDIS_URL, { worker: true });
const serviceRedis = createRedis(config.REDIS_URL);
const queueRedis = createRedis(config.REDIS_URL);
await Promise.all([workerRedis.connect(), serviceRedis.connect(), queueRedis.connect()]);

const presence = new PresenceStore(serviceRedis);
const publisher = new CommandPublisher(serviceRedis);
const queue = new CommandQueue(queueRedis);

for (const command of await repository.listRecoverableCommands()) {
  await queue.enqueue(command.id);
}

class DeliveryPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryPendingError";
  }
}

const worker = createCommandWorker(workerRedis, async (job) => {
  const command = await repository.getCommand(job.data.commandId);
  if (!command) return;
  if (["succeeded", "rejected", "conflict", "expired", "failed"].includes(command.status)) return;
  if (isCommandExpired(command.expiresAt)) {
    await repository.setCommandStatus({ commandId: command.id, status: "expired", terminal: true });
    return;
  }
  if (!(await presence.isOnline(command.installationId))) {
    throw new DeliveryPendingError("connector is offline");
  }

  const attemptNumber = job.attemptsMade + 1;
  const attempt = await repository.createCommandAttempt(command.id, attemptNumber);
  if (command.status === "created") {
    await repository.setCommandStatus({ commandId: command.id, status: "queued" });
  }
  await repository.setCommandStatus({ commandId: command.id, status: "delivering" });

  const message = HubToConnectorMessageSchema.parse({
    type: "hub.command",
    commandId: command.id,
    expiresAt: command.expiresAt.toISOString(),
    command: RuntimeCommandSchema.parse(command.payload),
  });
  const subscribers = await publisher.publish(command.installationId, JSON.stringify(message));
  if (subscribers === 0) {
    await repository.finishCommandAttempt({
      attemptId: attempt.id,
      status: "not_routed",
      errorCode: "connector_offline",
      errorMessage: "no API instance currently owns the Connector WebSocket",
    });
    throw new DeliveryPendingError("connector routing unavailable");
  }

  await repository.finishCommandAttempt({ attemptId: attempt.id, status: "published" });
  // The WebSocket result is asynchronous. Throwing keeps the durable BullMQ job retryable;
  // a later attempt exits immediately after the API persists a terminal command result.
  throw new DeliveryPendingError("awaiting connector acknowledgement");
});

worker.on("failed", async (job, error) => {
  if (!job) return;
  const configuredAttempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  if (job.attemptsMade < configuredAttempts) return;
  const command = await repository.getCommand(job.data.commandId);
  if (!command || ["succeeded", "rejected", "conflict", "expired", "failed"].includes(command.status)) return;
  await repository.setCommandStatus({
    commandId: command.id,
    status: isCommandExpired(command.expiresAt) ? "expired" : "failed",
    errorCode: "delivery_exhausted",
    errorMessage: "command delivery retries were exhausted",
    terminal: true,
  });
  logger.error(
    { commandId: command.id, error: redact({ message: error.message }) },
    "command delivery exhausted",
  );
});

worker.on("error", (error) => logger.error({ error: redact({ message: error.message }) }, "worker error"));
logger.info("Symphoneer Hub command worker started");

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down worker");
  await worker.pause();
  await worker.close();
  await queue.close();
  await Promise.all([
    workerRedis.quit(),
    serviceRedis.quit(),
    queueRedis.quit(),
    postgres.end(),
  ]);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      logger.error(
        { error: redact({ message: error instanceof Error ? error.message : "unknown error" }) },
        "worker shutdown failed",
      );
      process.exitCode = 1;
    });
  });
}
