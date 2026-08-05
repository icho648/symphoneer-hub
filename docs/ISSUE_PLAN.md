# Implementation Issue Plan

1. **Bootstrap and smoke fixture** — repository contract, CI, offline verification.
2. **Database and ownership model** — private `hub` schema, migrations, repository tests.
3. **Authentication and installations** — Supabase JWT verification, dev auth, CRUD.
4. **Pairing and credentials** — one-time codes, transactional consume, revocation.
5. **Connector presence** — authenticated WebSocket, heartbeat, Redis TTL.
6. **Runtime projection** — snapshot/event ingest, deduplication and stale update protection.
7. **Remote pause command** — durable command, BullMQ, Pub/Sub, idempotency and conflict UI.
8. **Failure recovery** — restart reconciliation, ACK loss, offline retry, expiry.
9. **Observability and deployment** — structured logs, metrics/traces, dashboards and runbook.
10. **Real Symphoneer smoke** — first isolated fixture task, then a real Hub module issue.
