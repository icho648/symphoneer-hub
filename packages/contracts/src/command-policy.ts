export type CommandStatus =
  | "created"
  | "queued"
  | "delivering"
  | "succeeded"
  | "rejected"
  | "conflict"
  | "expired"
  | "failed";

const transitions: Record<CommandStatus, ReadonlySet<CommandStatus>> = {
  created: new Set(["queued", "expired", "failed"]),
  queued: new Set(["delivering", "expired", "failed"]),
  delivering: new Set(["queued", "succeeded", "rejected", "conflict", "expired", "failed"]),
  succeeded: new Set(),
  rejected: new Set(),
  conflict: new Set(),
  expired: new Set(),
  failed: new Set(),
};

export function canTransitionCommand(from: CommandStatus, to: CommandStatus): boolean {
  return transitions[from].has(to);
}

export function assertCommandTransition(from: CommandStatus, to: CommandStatus): void {
  if (!canTransitionCommand(from, to))
    throw new Error(`invalid command transition: ${from} -> ${to}`);
}

export function isCommandExpired(expiresAt: string | Date, now = new Date()): boolean {
  const value = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(value.getTime())) throw new Error("invalid command expiry");
  return value.getTime() <= now.getTime();
}

export type IdempotentCommandIdentity = {
  installationId: string;
  runtimeId: string;
  kind: string;
  targetId: string;
  expectedEventSequence: number | null;
  expectedTargetUpdatedAt: string | Date | null;
  payload: unknown;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function timestamp(value: string | Date | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid command timestamp");
  return date.toISOString();
}

export function sameIdempotentCommand(
  left: IdempotentCommandIdentity,
  right: IdempotentCommandIdentity,
): boolean {
  return (
    left.installationId === right.installationId &&
    left.runtimeId === right.runtimeId &&
    left.kind === right.kind &&
    left.targetId === right.targetId &&
    left.expectedEventSequence === right.expectedEventSequence &&
    timestamp(left.expectedTargetUpdatedAt) === timestamp(right.expectedTargetUpdatedAt) &&
    canonicalJson(left.payload) === canonicalJson(right.payload)
  );
}
