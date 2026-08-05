import assert from "node:assert/strict";
import test from "node:test";
import { digestSecret, normalizePairingCode, redact } from "../packages/contracts/src/security.ts";

test("pairing codes normalize deterministically", () => {
  assert.equal(normalizePairingCode("abcd-2345"), "ABCD2345");
  assert.throws(() => normalizePairingCode("too-short"));
});

test("secret digests are stable but pepper-bound", () => {
  const pepper = "a".repeat(32);
  assert.equal(digestSecret("token", pepper), digestSecret("token", pepper));
  assert.notEqual(digestSecret("token", pepper), digestSecret("token", "b".repeat(32)));
});

test("structured logs redact credential-shaped values", () => {
  assert.deepEqual(redact({ authorization: "Bearer abc", nested: { deviceToken: "secret", safe: "ok" } }), {
    authorization: "[redacted]",
    nested: { deviceToken: "[redacted]", safe: "ok" },
  });
});
