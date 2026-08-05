import { createServer } from "node:http";
import { redact } from "@symphoneer-hub/contracts";
import { createDatabase, HubRepository } from "@symphoneer-hub/database";
import {
  CommandQueue,
  CommandSubscriber,
  createRedis,
  FixedWindowRateLimiter,
  PresenceStore,
} from "@symphoneer-hub/relay";
import pino from "pino";
import { createApiApp } from "./app.js";
import { loadConfig } from "./config.js";
import { ConnectorGateway } from "./websocket-gateway.js";

const config = loadConfig();
const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "deviceToken",
      "pairingCode",
      "token",
      "password",
      "*.token",
      "*.secret",
    ],
    censor: "[redacted]",
  },
});

const { db, client: postgres } = createDatabase(config.DATABASE_URL);
const repository = new HubRepository(db);
const redis = createRedis(config.REDIS_URL);
const subscriberRedis = createRedis(config.REDIS_URL);
await Promise.all([redis.connect(), subscriberRedis.connect()]);

const commandQueue = new CommandQueue(redis);
const presence = new PresenceStore(redis);
const pairingLimiter = new FixedWindowRateLimiter(redis);
const subscriber = new CommandSubscriber(subscriberRedis);
const gateway = new ConnectorGateway({
  repository,
  presence,
  subscriber,
  deviceTokenPepper: config.DEVICE_TOKEN_PEPPER,
  logger,
});
await gateway.start();

const app = createApiApp({
  config,
  repository,
  commandQueue,
  presence,
  pairingLimiter,
  logger,
  redisPing: async () => {
    const result = await redis.ping();
    if (result !== "PONG") throw new Error("Redis ping failed");
  },
});
const server = createServer(app);
server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
    .pathname;
  if (pathname !== "/v1/connectors/ws") {
    socket.destroy();
    return;
  }
  void gateway.handleUpgrade(request, socket, head);
});

server.listen(config.API_PORT, config.API_HOST, () => {
  logger.info({ host: config.API_HOST, port: config.API_PORT }, "Symphoneer Hub API listening");
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down API");
  const serverClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeIdleConnections();
  await gateway.close();
  await serverClosed;
  await commandQueue.close();
  await Promise.all([redis.quit(), subscriberRedis.quit(), postgres.end()]);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      logger.error(
        { error: redact({ message: error instanceof Error ? error.message : "unknown error" }) },
        "API shutdown failed",
      );
      process.exitCode = 1;
    });
  });
}
