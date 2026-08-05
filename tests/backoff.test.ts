import assert from "node:assert/strict";
import test from "node:test";
import { exponentialBackoff } from "../packages/contracts/src/backoff.ts";

test("backoff grows exponentially and caps", () => {
  const fixed = () => 0.5;
  assert.equal(exponentialBackoff({ attempt: 0, random: fixed }), 500);
  assert.equal(exponentialBackoff({ attempt: 3, random: fixed }), 4000);
  assert.equal(exponentialBackoff({ attempt: 20, random: fixed }), 30000);
});
