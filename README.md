# Symphoneer Hub

Symphoneer Hub is the optional remote control plane for a local-first Symphoneer Runtime.
The local Runtime remains authoritative for Tasks, Attempts, Workspaces, Codex execution,
Verification, and every state transition. Hub stores a remote projection, connection
presence, command delivery records, and audit evidence.

## MVP

The first vertical slice supports:

1. GitHub sign-in through Supabase Auth, with a development-auth mode for local work.
2. Installation creation and one-time pairing codes.
3. A local Connector that makes an outbound authenticated WebSocket connection.
4. Runtime snapshot and payload-free event-summary synchronization without uploading source code or raw provider payloads.
5. Remote `pause_attempt` delivery with idempotency keys, optimistic preconditions, expiry,
   persistence, retries, and audit logs.

## Authority boundary

```text
Browser -> Hub Web -> Hub API -> PostgreSQL
                         |    -> Redis / BullMQ
                         -> WebSocket -> Local Connector -> loopback Runtime HTTP
```

Hub never runs a Scheduler, creates a Workspace, executes Codex, runs Verification, or
writes Git. The Connector only maps versioned Hub commands to the existing loopback Runtime
API. Network delivery is at-least-once; the Runtime command's idempotency key and optimistic
preconditions protect business effects.

## Local setup

Requirements: Node.js 22.18+, pnpm 11, Docker with Compose.

```bash
corepack enable
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
pnpm dev
```

Run the Connector in another terminal after creating a pairing code in the Web UI:

```bash
PAIRING_CODE=XXXX-XXXX pnpm dev:connector
```

For local development without Supabase, keep `AUTH_MODE=dev` and
`NEXT_PUBLIC_AUTH_MODE=dev`. The Web sends the configured development user ID. Production
must use `AUTH_MODE=supabase`; the API verifies asymmetric Supabase JWTs against the project
JWKS and never accepts user metadata as authorization input.

## Supabase setup

Hub uses Supabase only for identity and PostgreSQL hosting; all application data goes through
the Hub API rather than the Data API.

1. Enable GitHub in Supabase Auth.
2. Add `http://localhost:3000/auth/callback` and the production callback URL.
3. Use an asymmetric JWT signing key.
4. Configure the publishable key in the Web environment; never expose a secret or
   `service_role` key.
5. Point `DATABASE_URL` at the Supabase direct or pooler connection.

Application tables live in the private `hub` schema. The migration revokes access from
`anon` and `authenticated`; browser clients do not query them directly.

## Commands

```bash
pnpm check               # format, typecheck, project rules, tests and builds
pnpm check:offline       # dependency-free checks available in restricted environments
pnpm db:new add_feature  # create an immutable SQL migration
pnpm db:migrate
```

## Deployment

- `apps/web`: Vercel.
- `apps/api` and `apps/worker`: a persistent Node host supporting WebSocket connections and
  graceful shutdown, such as Fly.io, Railway, Render, or a VM/container platform.
- PostgreSQL: Supabase or another managed PostgreSQL provider.
- Redis: managed Redis with persistence, `noeviction`, TLS, and separate credentials.
- `apps/connector`: runs on the machine that owns the local Symphoneer Runtime.

Do not deploy the API as a short-lived serverless function: Connector WebSockets, Redis
subscriptions, and graceful delivery acknowledgements require a long-running process.

The repository includes a committed `pnpm-lock.yaml`. CI uses a frozen install, starts
PostgreSQL and Redis services, applies the SQL migrations, and runs the complete `pnpm check`
gate. See [Validation](VALIDATION.md) for the distinction between CI-verified behavior and the
remaining live-integration checks.

Deterministic Symphoneer E2E fixtures are maintained separately in
[`icho648/symphoneer-fixtures`](https://github.com/icho648/symphoneer-fixtures).

See [Architecture](docs/ARCHITECTURE.md), [Threat model](docs/THREAT_MODEL.md), and
[Runbook](docs/RUNBOOK.md).
