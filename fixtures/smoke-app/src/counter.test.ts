import assert from "node:assert/strict";
import test from "node:test";
import { increment } from "./counter.js";

test("increment returns a new revision", () => {
  const original = { value: 2, revision: 4 };
  assert.deepEqual(increment(original, 3), { value: 5, revision: 5 });
  assert.deepEqual(original, { value: 2, revision: 4 });
});

test("increment rejects invalid changes", () => {
  assert.throws(() => increment({ value: 0, revision: 0 }, 0), RangeError);
});
