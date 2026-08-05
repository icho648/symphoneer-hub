# Architecture

## Processes

```text
apps/web       Authenticated remote task board and pairing UX
apps/api       REST API, Connector WebSocket gateway, auth and persistence
apps/worker    Durable command delivery and retry worker
apps/connector Outbound bridge to one local Symphoneer Runtime
```

## Data authority

| Object | Authority | Hub responsibility |
|---|---|---|
| Task and Issue state | Tracker / GitHub | Store a read-only remote projection |
| Attempt state | Local Symphoneer Runtime | Store latest snapshot and sequence |
| Workspace and Git | Local Runtime / Git | Never upload paths, source, secrets, or raw diff |
| Runtime command effect | Local Runtime | Persist intent, deliver, and audit result |
| Presence | Connector heartbeat | Redis TTL; it is ephemeral and rebuildable |
| Command record | PostgreSQL | Durable delivery and audit fact |

## Delivery semantics

Commands are persisted before enqueueing. BullMQ retries delivery when the Connector is
briefly offline. Redis Pub/Sub routes a command to the API instance that owns the WebSocket.
The Connector may receive the same command more than once after reconnect or acknowledgement
loss. It forwards the same Runtime `idempotencyKey`; the Runtime remains responsible for
idempotent business effects and optimistic conflict detection.

```text
created -> queued -> delivering -> succeeded
                     |          -> rejected
                     |          -> conflict
                     |          -> expired
                     `----------> failed (retryable or terminal)
```

## Database

The `hub` PostgreSQL schema contains installations, pairing codes, device credentials,
runtime snapshots/events, commands, command attempts, and audit logs. Secrets are stored as
HMAC digests. Plain pairing codes and device tokens are shown once and never persisted.

## Redis

Redis contains only rebuildable state:

- presence keys with TTL;
- BullMQ command jobs;
- command Pub/Sub routing channels;
- optional rate-limit counters.

PostgreSQL remains the fact source. Redis must use `noeviction`; eviction must not silently
become command loss.

## Fixture strategy

`fixtures/smoke-app` is an isolated deterministic package inside this real product repository.
Symphoneer V1 E2E issues may modify only that directory and run `pnpm check:smoke`. Once the
basic loop is proven, later smoke tests may target real Hub modules and infrastructure.
