# Validation status

Validated on 2026-08-05 through the repository's GitHub Actions CI and the earlier
dependency-free checks.

## CI verified

The `main` branch completed the full CI gate successfully with:

- a frozen installation from the committed `pnpm-lock.yaml`;
- PostgreSQL 17 and Redis 7.4 service containers;
- execution of the immutable SQL migrations against PostgreSQL;
- Biome formatting and lint checks;
- repository structure and authority-boundary checks;
- TypeScript builds for the API, Connector, Worker, contracts, database, and relay packages;
- Node tests covering pairing-code normalization and HMAC storage, secret redaction, retry
  backoff and capping, command transitions, expiry, and semantic idempotency reuse;
- the Next.js production build.

## Still requires live integration

CI validates compilation, migration compatibility, deterministic tests, and production builds.
The following require configured external systems or a running local Symphoneer Runtime and
are therefore not claimed as completed:

- Supabase GitHub OAuth and JWKS verification against a real Supabase project;
- browser sign-in and callback behavior in a deployed environment;
- a real Connector pairing and authenticated WebSocket session;
- synchronization from a running local Runtime;
- an end-to-end `pause_attempt` command and acknowledgement;
- production Redis persistence, restart, and failover behavior;
- deployment health, TLS, secret rotation, and operational alerts.

## Local verification

```bash
corepack enable
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
pnpm check
```

After that gate passes, configure a real Supabase project, pair one Connector, sync one local
Runtime snapshot, and exercise a real `pause_attempt` before calling a deployment production
ready.
