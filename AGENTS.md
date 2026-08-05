# Agent Guide

## Authority

Symphoneer Hub is a remote client and control plane. Never add a Scheduler, Workspace
manager, Agent Runner, Verification executor, Git writer, or cloud code execution path.
Local Symphoneer Runtime remains authoritative.

## Security invariants

- Do not upload source code, raw diffs, credentials, cookies, Authorization headers, or raw
  provider payloads.
- Persist only HMAC digests of pairing codes and device tokens.
- Every user operation must be scoped by JWT `sub` ownership.
- Every command requires an idempotency key, optimistic preconditions, and expiry.
- PostgreSQL is the durable fact source; Redis state must be rebuildable.
- Runtime endpoints must remain loopback HTTP.

## Verification

Run `pnpm check` for production changes. Issues explicitly marked as V1 smoke-fixture tasks may
change only `fixtures/smoke-app/**` and run `pnpm check:smoke`.
