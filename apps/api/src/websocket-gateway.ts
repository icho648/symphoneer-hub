import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  ConnectorToHubMessageSchema,
  digestSecret,
  HubToConnectorMessageSchema,
  RuntimeSnapshotSchema,
  redact,
} from "@symphoneer-hub/contracts";
import type { HubRepository } from "@symphoneer-hub/database";
import type { CommandSubscriber, PresenceStore } from "@symphoneer-hub/relay";
import type pino from "pino";
import { WebSocket, WebSocketServer } from "ws";

export type GatewayDependencies = {
  repository: HubRepository;
  presence: PresenceStore;
  subscriber: CommandSubscriber;
  deviceTokenPepper: string;
  logger: pino.Logger;
};

type Connection = {
  socket: WebSocket;
  connectionId: string;
  credentialId: string;
  installationId: string;
  runtimeId: string;
};

function tokenFromRequest(request: IncomingMessage): string | null {
  const value = request.headers.authorization;
  if (!value?.toLowerCase().startsWith("bearer ")) return null;
  return value.slice(7).trim() || null;
}

export class ConnectorGateway {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  private readonly connections = new Map<string, Connection>();
  private readonly dependencies: GatewayDependencies;

  constructor(dependencies: GatewayDependencies) {
    this.dependencies = dependencies;
  }

  async start(): Promise<void> {
    await this.dependencies.subscriber.subscribe((installationId, payload) => {
      const connection = this.connections.get(installationId);
      if (connection?.socket.readyState !== WebSocket.OPEN) return;
      try {
        connection.socket.send(payload);
      } catch (error) {
        this.dependencies.logger.warn(
          {
            installationId,
            error: redact({ message: error instanceof Error ? error.message : "unknown error" }),
          },
          "failed to route command to connector",
        );
      }
    });
  }

  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      const token = tokenFromRequest(request);
      if (!token) throw new Error("missing device token");
      const connector = await this.dependencies.repository.findConnectorByTokenHash(
        digestSecret(token, this.dependencies.deviceTokenPepper),
      );
      if (!connector) throw new Error("invalid device token");

      this.server.handleUpgrade(request, socket, head, (webSocket) => {
        const connection: Connection = {
          socket: webSocket,
          connectionId: randomUUID(),
          credentialId: connector.credentialId,
          installationId: connector.installationId,
          runtimeId: connector.runtimeId,
        };
        this.bind(connection);
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  }

  private bind(connection: Connection): void {
    const previous = this.connections.get(connection.installationId);
    previous?.socket.close(4001, "superseded by a newer connector connection");
    this.connections.set(connection.installationId, connection);

    void this.touch(connection).catch((error: unknown) => {
      this.dependencies.logger.warn(
        {
          installationId: connection.installationId,
          error: redact({ message: error instanceof Error ? error.message : "unknown error" }),
        },
        "failed to record connector presence",
      );
    });
    connection.socket.send(
      JSON.stringify(
        HubToConnectorMessageSchema.parse({
          type: "hub.ready",
          connectionId: connection.connectionId,
          serverTime: new Date().toISOString(),
        }),
      ),
    );

    connection.socket.on("message", (raw) => {
      void this.onMessage(connection, raw.toString()).catch((error: unknown) => {
        this.dependencies.logger.error(
          {
            installationId: connection.installationId,
            error: redact({ message: error instanceof Error ? error.message : "unknown error" }),
          },
          "connector message handling failed",
        );
        connection.socket.close(1011, "connector message handling failed");
      });
    });
    connection.socket.on("close", () => {
      void this.onClose(connection).catch((error: unknown) => {
        this.dependencies.logger.warn(
          {
            installationId: connection.installationId,
            error: redact({ message: error instanceof Error ? error.message : "unknown error" }),
          },
          "failed to clear connector presence",
        );
      });
    });
    connection.socket.on("error", (error) => {
      this.dependencies.logger.warn(
        { installationId: connection.installationId, error: redact({ message: error.message }) },
        "connector websocket error",
      );
    });
  }

  private async onMessage(connection: Connection, raw: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      connection.socket.close(1007, "invalid JSON");
      return;
    }
    const parsed = ConnectorToHubMessageSchema.safeParse(message);
    if (!parsed.success) {
      connection.socket.close(1007, "invalid connector message");
      return;
    }

    switch (parsed.data.type) {
      case "connector.hello":
        if (parsed.data.runtimeId !== connection.runtimeId) {
          connection.socket.close(1008, "runtime identity mismatch");
          return;
        }
        await this.touch(connection);
        break;
      case "connector.heartbeat":
        await this.touch(connection);
        break;
      case "connector.snapshot": {
        const snapshot = RuntimeSnapshotSchema.parse(parsed.data.snapshot);
        if (snapshot.runtime.runtimeId !== connection.runtimeId) {
          connection.socket.close(1008, "snapshot runtime mismatch");
          return;
        }
        await this.dependencies.repository.upsertSnapshot(connection.installationId, snapshot);
        await this.touch(connection);
        break;
      }
      case "connector.events": {
        await this.dependencies.repository.insertRuntimeEvents(
          connection.installationId,
          connection.runtimeId,
          parsed.data.events,
        );
        await this.touch(connection);
        break;
      }
      case "connector.command_result": {
        const completed = await this.dependencies.repository.completeCommandFromConnector({
          commandId: parsed.data.commandId,
          installationId: connection.installationId,
          runtimeId: connection.runtimeId,
          status: parsed.data.status,
          ...(parsed.data.result === undefined ? {} : { result: parsed.data.result }),
          ...(parsed.data.errorCode === undefined ? {} : { errorCode: parsed.data.errorCode }),
          ...(parsed.data.errorMessage === undefined
            ? {}
            : { errorMessage: parsed.data.errorMessage }),
        });
        if (completed) {
          await this.dependencies.repository.appendAudit({
            ownerId: completed.ownerId,
            installationId: connection.installationId,
            actorType: "connector",
            actorId: connection.credentialId,
            action: "command.completed",
            targetType: "command",
            targetId: completed.commandId,
            metadata: { status: parsed.data.status },
          });
        }
        await this.touch(connection);
        break;
      }
    }
  }

  private async touch(connection: Connection): Promise<void> {
    await Promise.all([
      this.dependencies.presence.online(connection.installationId, connection.connectionId),
      this.dependencies.repository.touchConnector(connection.credentialId),
    ]);
  }

  private async onClose(connection: Connection): Promise<void> {
    if (this.connections.get(connection.installationId)?.connectionId === connection.connectionId) {
      this.connections.delete(connection.installationId);
      await this.dependencies.presence.offline(connection.installationId, connection.connectionId);
    }
  }

  async close(): Promise<void> {
    for (const connection of this.connections.values()) {
      connection.socket.close(1012, "server restarting");
    }
    this.connections.clear();
    await this.dependencies.subscriber.close();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
