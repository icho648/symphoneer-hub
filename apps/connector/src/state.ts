import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const ConnectorStateSchema = z.object({
  installationId: z.uuid(),
  runtimeId: z.string().min(1),
  deviceToken: z.string().min(32),
});
export type ConnectorState = z.infer<typeof ConnectorStateSchema>;

export async function readConnectorState(path: string): Promise<ConnectorState | null> {
  try {
    return ConnectorStateSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeConnectorState(path: string, state: ConnectorState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
