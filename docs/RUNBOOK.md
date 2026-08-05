# Operations Runbook

## Health checks

- API liveness: `GET /healthz/live`
- API readiness: `GET /healthz/ready` checks PostgreSQL and Redis.
- Worker readiness: process log after PostgreSQL/Redis connections and queue subscription.
- Connector presence: Redis TTL and the last durable `last_seen_at` timestamp.

## PostgreSQL

- Create append-only SQL migrations with `pnpm db:new <name>` and apply them before starting a new API version.
- The migration runner serializes with a PostgreSQL advisory lock and rejects checksum drift in already-applied files.
- Take managed daily backups and test restore at least quarterly.
- On migration failure, stop rollout; do not run a partially compatible API fleet.
- Monitor connection saturation, transaction latency, deadlocks and disk growth.
- Runtime snapshot, payload-free event summaries, and audit logs need explicit retention policies before production.

## Redis

- Require persistence, TLS and `maxmemory-policy noeviction`.
- If Redis is unavailable, REST reads may continue from PostgreSQL but new commands return
  `503 relay_unavailable`; do not pretend they were queued.
- After recovery, the worker reconciles durable `created` or retryable commands from
  PostgreSQL.

## Connector incidents

- `offline`: verify the local Runtime, Connector process, device credential and outbound
  network access.
- repeated conflicts: refresh the Runtime snapshot; the user is acting on stale sequence or
  Attempt `updatedAt`.
- duplicate delivery: expected under at-least-once transport; confirm the same idempotency key
  reached the Runtime and only one business effect occurred.
- credential exposure: revoke the credential in PostgreSQL, stop the Connector, create a new
  pairing code and rotate the token pepper if systemic exposure is suspected.

## Graceful shutdown

API stops accepting upgrades, closes WebSockets with a retryable status, unsubscribes Redis,
and drains HTTP. Worker pauses job intake and waits for active jobs. Connector stops polling,
sends a final presence update when possible, and closes its WebSocket.

## Logging

Every log includes correlation IDs where applicable: request, installation, runtime, command
and attempt. Never log raw bearer tokens, pairing codes, device tokens, cookies, provider
payloads or full Runtime snapshots.

## Reverse proxy and pairing limits

Keep `TRUST_PROXY_HOPS=0` when the API is reached directly. Set it to the exact trusted proxy
hop count only when the deployment platform terminates the client connection through that proxy;
otherwise an attacker could spoof the address used by the pairing limiter. Pairing is capped at ten
attempts per minute per digested client address and still fails closed when Redis is unavailable.
