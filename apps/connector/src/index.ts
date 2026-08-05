import { hostname } from "node:os";
import {
  ConnectorToHubMessageSchema,
  HubToConnectorMessageSchema,
  PairConnectorSchema,
  exponentialBackoff,
  redact,
  sanitizeRuntimeCommandResult,
  sanitizeRuntimeEvent,
  sanitizeRuntimeSnapshot,
  type ConnectorToHubMessage,
  type HubToConnectorMessage,
} from "@symphoneer-hub/contracts";
import WebSocket from "ws";
import { loadConnectorConfig } from "./config.js";
import { RuntimeClient, RuntimeClientError } from "./runtime-client.js";
import {
  ConnectorStateSchema,
  readConnectorState,
  writeConnectorState,
  type ConnectorState,
} from "./state.js";

const config = loadConnectorConfig();
const runtime = new RuntimeClient(config.SYMPHONEER_RUNTIME_URL);
let state = await readConnectorState(config.statePath);
let stopped = false;
let activeSocket: WebSocket | null = null;
const inFlightCommands = new Map<string, Promise<ConnectorToHubMessage>>();

function log(message: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...redact(data) }));
}

async function pair(): Promise<ConnectorState> {
  if (!config.PAIRING_CODE) {
    throw new Error(`no connector state at ${config.statePath}; set PAIRING_CODE once to pair`);
  }
  const snapshot = await runtime.snapshot();
  const input = PairConnectorSchema.parse({
    code: config.PAIRING_CODE,
    runtimeId: snapshot.runtime.runtimeId,
    connectorName: hostname(),
  });
  const response = await fetch(
    `${config.HUB_API_URL.replace(/\/$/, "")}/v1/connectors/pair`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`pairing failed with HTTP ${response.status}`);
  const body = ConnectorStateSchema.parse(await response.json());
  await writeConnectorState(config.statePath, body);
  log("connector paired", {
    installationId: body.installationId,
    runtimeId: body.runtimeId,
  });
  return body;
}

state ??= await pair();

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

async function executeCommand(
  message: Extract<HubToConnectorMessage, { type: "hub.command" }>,
): Promise<ConnectorToHubMessage> {
  if (new Date(message.expiresAt).getTime() <= Date.now()) {
    return ConnectorToHubMessageSchema.parse({
      type: "connector.command_result",
      commandId: message.commandId,
      status: "expired",
      errorCode: "command_expired",
      errorMessage: "command expired before local execution",
      finishedAt: new Date().toISOString(),
    });
  }

  try {
    const result = sanitizeRuntimeCommandResult(await runtime.command(message.command));
    return ConnectorToHubMessageSchema.parse({
      type: "connector.command_result",
      commandId: message.commandId,
      status: result.accepted ? "succeeded" : "rejected",
      result,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    const runtimeError =
      error instanceof RuntimeClientError
        ? error
        : new RuntimeClientError(0, "connector_error", "unexpected Connector error");
    const conflict = runtimeError.status === 409 || runtimeError.code.includes("conflict");
    return ConnectorToHubMessageSchema.parse({
      type: "connector.command_result",
      commandId: message.commandId,
      status: conflict
        ? "conflict"
        : runtimeError.status >= 400 && runtimeError.status < 500
          ? "rejected"
          : "failed",
      errorCode: runtimeError.code,
      errorMessage: runtimeError.message,
      finishedAt: new Date().toISOString(),
    });
  }
}

async function handleCommand(
  socket: WebSocket,
  message: Extract<HubToConnectorMessage, { type: "hub.command" }>,
): Promise<void> {
  let execution = inFlightCommands.get(message.commandId);
  if (!execution) {
    execution = executeCommand(message).finally(() => {
      setTimeout(() => inFlightCommands.delete(message.commandId), 60_000).unref();
    });
    inFlightCommands.set(message.commandId, execution);
  }
  send(socket, await execution);
}

async function connect(current: ConnectorState): Promise<void> {
  return new Promise((resolve) => {
    const socket = new WebSocket(config.HUB_WEBSOCKET_URL, {
      headers: { authorization: `Bearer ${current.deviceToken}` },
      handshakeTimeout: 15_000,
      maxPayload: 1024 * 1024,
    });
    activeSocket = socket;
    let lastSnapshotSequence = -1;
    let eventCursor = 0;
    let polling = false;

    const heartbeat = setInterval(() => {
      send(
        socket,
        ConnectorToHubMessageSchema.parse({
          type: "connector.heartbeat",
          sentAt: new Date().toISOString(),
        }),
      );
    }, config.CONNECTOR_HEARTBEAT_INTERVAL_MS);

    async function syncRuntime(): Promise<void> {
      if (polling || socket.readyState !== WebSocket.OPEN) return;
      polling = true;
      try {
        const snapshot = await runtime.snapshot();
        if (snapshot.runtime.runtimeId !== current.runtimeId) {
          throw new Error("local Runtime identity changed; re-pair the Connector");
        }
        if (snapshot.runtime.lastEventSequence !== lastSnapshotSequence) {
          send(
            socket,
            ConnectorToHubMessageSchema.parse({
              type: "connector.snapshot",
              snapshot: sanitizeRuntimeSnapshot(snapshot),
            }),
          );
          lastSnapshotSequence = snapshot.runtime.lastEventSequence;
        }

        const eventBatch = await runtime.events(eventCursor);
        const events = eventBatch.events.slice(0, 200).map(sanitizeRuntimeEvent);
        if (events.length > 0) {
          send(
            socket,
            ConnectorToHubMessageSchema.parse({ type: "connector.events", events }),
          );
          eventCursor = events.at(-1)?.sequence ?? eventCursor;
        }
      } catch (error) {
        log("Runtime synchronization failed", {
          error: error instanceof Error ? error.message : "unknown error",
        });
      } finally {
        polling = false;
      }
    }

    const poll = setInterval(() => void syncRuntime(), config.CONNECTOR_POLL_INTERVAL_MS);

    socket.on("open", () => {
      log("connector websocket connected", { installationId: current.installationId });
      send(
        socket,
        ConnectorToHubMessageSchema.parse({
          type: "connector.hello",
          protocolVersion: 1,
          runtimeId: current.runtimeId,
          connectorVersion: "0.1.0",
        }),
      );
      void syncRuntime();
    });

    socket.on("message", (raw) => {
      try {
        const message = HubToConnectorMessageSchema.parse(JSON.parse(raw.toString()));
        if (message.type === "hub.command") void handleCommand(socket, message);
        if (message.type === "hub.error") {
          log("Hub reported an error", { code: message.code, detail: message.message });
        }
      } catch (error) {
        log("invalid Hub message", {
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    });

    socket.on("error", (error) => {
      log("connector websocket error", { error: error.message });
    });
    socket.on("close", (code, reason) => {
      clearInterval(heartbeat);
      clearInterval(poll);
      if (activeSocket === socket) activeSocket = null;
      log("connector websocket closed", { code, reason: reason.toString() });
      resolve();
    });
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopped = true;
    activeSocket?.close(1000, "connector stopping");
  });
}

for (let attempt = 0; !stopped; attempt += 1) {
  await connect(state);
  if (stopped) break;
  const delay = exponentialBackoff({ attempt });
  log("reconnecting Connector", { delayMs: delay });
  await new Promise((resolve) => setTimeout(resolve, delay));
}
