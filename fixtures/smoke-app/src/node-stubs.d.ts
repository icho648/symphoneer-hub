declare module "node:assert/strict" {
  const assert: {
    deepEqual(actual: unknown, expected: unknown): void;
    throws(block: () => unknown, error?: unknown): void;
  };
  export default assert;
}

declare module "node:test" {
  const test: (name: string, block: () => void | Promise<void>) => void;
  export default test;
}
