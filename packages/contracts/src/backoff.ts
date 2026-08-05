export type BackoffOptions = {
  attempt: number;
  baseMs?: number;
  maxMs?: number;
  jitterRatio?: number;
  random?: () => number;
};

export function exponentialBackoff({
  attempt,
  baseMs = 500,
  maxMs = 30_000,
  jitterRatio = 0.2,
  random = Math.random,
}: BackoffOptions): number {
  if (!Number.isInteger(attempt) || attempt < 0)
    throw new Error("attempt must be a non-negative integer");
  if (baseMs <= 0 || maxMs < baseMs) throw new Error("invalid backoff bounds");
  if (jitterRatio < 0 || jitterRatio > 1) throw new Error("jitterRatio must be between 0 and 1");
  const capped = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = capped * jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}
