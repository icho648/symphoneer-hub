import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCommandTransition,
  canTransitionCommand,
  isCommandExpired,
  sameIdempotentCommand,
} from "../packages/contracts/src/command-policy.ts";

test("only explicit command transitions are allowed", () => {
  assert.equal(canTransitionCommand("created", "queued"), true);
  assert.equal(canTransitionCommand("succeeded", "queued"), false);
  assert.throws(() => assertCommandTransition("succeeded", "failed"));
});

test("expiry is deterministic at the boundary", () => {
  const now = new Date("2026-08-05T10:00:00.000Z");
  assert.equal(isCommandExpired("2026-08-05T10:00:00.000Z", now), true);
  assert.equal(isCommandExpired("2026-08-05T10:00:01.000Z", now), false);
});

test("idempotency compares semantic command identity", () => {
  const base = {
    installationId: "installation-1",
    runtimeId: "runtime-1",
    kind: "pause_attempt",
    targetId: "attempt-1",
    expectedEventSequence: 7,
    expectedTargetUpdatedAt: new Date("2026-08-05T10:00:00.000Z"),
    payload: { attemptId: "attempt-1", kind: "pause_attempt", idempotencyKey: "key-1" },
  };
  assert.equal(
    sameIdempotentCommand(base, {
      ...base,
      expectedTargetUpdatedAt: "2026-08-05T10:00:00.000Z",
      payload: { idempotencyKey: "key-1", kind: "pause_attempt", attemptId: "attempt-1" },
    }),
    true,
  );
  assert.equal(sameIdempotentCommand(base, { ...base, targetId: "attempt-2" }), false);
});
