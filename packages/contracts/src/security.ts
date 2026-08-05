import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function createOpaqueToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16) throw new Error("token entropy must be at least 16 bytes");
  return randomBytes(bytes).toString("base64url");
}

export function createPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (value) => alphabet[value % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function normalizePairingCode(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(normalized)) {
    throw new Error("pairing code must contain 8 unambiguous characters");
  }
  return normalized;
}

export function digestSecret(secret: string, pepper: string): string {
  if (pepper.length < 32) throw new Error("secret pepper must be at least 32 characters");
  return createHmac("sha256", pepper).update(secret, "utf8").digest("hex");
}

export function safeDigestEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

const secretKeyPattern = /(authorization|cookie|token|secret|password|api[-_]?key|credential)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKeyPattern.test(key) ? "[redacted]" : redact(item, depth + 1),
      ]),
    );
  }
  if (typeof value === "string" && /^(bearer\s+|sb_(secret|publishable)_|gh[pousr]_)/i.test(value)) {
    return "[redacted]";
  }
  return value;
}
