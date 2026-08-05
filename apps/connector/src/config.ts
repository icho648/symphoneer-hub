import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  HUB_API_URL: z.string().url().default("http://localhost:4000"),
  HUB_WEBSOCKET_URL: z.string().url().default("ws://localhost:4000/v1/connectors/ws"),
  SYMPHONEER_RUNTIME_URL: z.string().url().default("http://127.0.0.1:47100"),
  PAIRING_CODE: z.string().optional(),
  CONNECTOR_STATE_PATH: z.string().optional(),
  CONNECTOR_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(2000),
  CONNECTOR_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
});

export type ConnectorConfig = z.infer<typeof ConfigSchema> & { statePath: string };

export function loadConnectorConfig(environment: NodeJS.ProcessEnv = process.env): ConnectorConfig {
  const parsed = ConfigSchema.parse(environment);
  return {
    ...parsed,
    statePath:
      parsed.CONNECTOR_STATE_PATH ??
      join(homedir(), ".config", "symphoneer-hub", "connector.json"),
  };
}
