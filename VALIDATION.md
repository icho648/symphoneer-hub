# Validation status

Validated on 2026-08-05 in the available execution environment.

## Passed

- Repository structure and authority-boundary checks.
- TypeScript syntax check over all source files with `noCheck`, independent of installed packages.
- Dependency-free typecheck for the security, retry, and command-policy core.
- Seven Node tests covering pairing-code normalization and HMAC storage, secret redaction,
  retry backoff/capping, command transitions, expiry, and semantic idempotency reuse.
- Two deterministic `fixtures/smoke-app` tests.

## Not verified here

The execution environment had no Docker, no pnpm, and no reachable npm registry. Therefore the
following remain explicitly unverified rather than inferred from scaffolding:

- dependency resolution and `pnpm-lock.yaml` generation;
- full `tsc -b`, Biome, Next.js build, and application package builds;
- PostgreSQL migration execution and database integration behavior;
- Redis/BullMQ delivery, Pub/Sub routing, and restart reconciliation;
- Supabase GitHub OAuth and JWKS verification against a real project;
- Browser, WebSocket, Connector-to-Runtime, and deployed end-to-end smoke tests.

## First connected-environment gate

```bash
corepack enable
pnpm install
# Commit the generated pnpm-lock.yaml, then make CI use --frozen-lockfile.
docker compose up -d
pnpm db:migrate
pnpm check
```

Then configure a real Supabase project, pair one Connector, sync one local Runtime snapshot,
and exercise a real `pause_attempt` command before calling the MVP compatible or deployable.
