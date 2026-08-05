export type Counter = Readonly<{ value: number; revision: number }>;

export function increment(counter: Counter, amount = 1): Counter {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError("amount must be a positive safe integer");
  }
  const next = counter.value + amount;
  if (!Number.isSafeInteger(next)) throw new RangeError("counter overflow");
  return { value: next, revision: counter.revision + 1 };
}
