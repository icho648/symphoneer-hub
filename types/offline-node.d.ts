declare const Buffer: {
  from(value: string, encoding?: string): { length: number };
};

declare module "node:crypto" {
  export function createHmac(algorithm: string, key: string): {
    update(value: string, encoding?: string): { digest(encoding: string): string };
  };
  export function randomBytes(size: number): Uint8Array & { toString(encoding: string): string };
  export function timingSafeEqual(left: { length: number }, right: { length: number }): boolean;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown): void;
    notEqual(actual: unknown, expected: unknown): void;
    deepEqual(actual: unknown, expected: unknown): void;
    throws(block: () => unknown, error?: unknown): void;
  };
  export default assert;
}

declare module "node:test" {
  const test: (name: string, block: () => void | Promise<void>) => void;
  export default test;
}
