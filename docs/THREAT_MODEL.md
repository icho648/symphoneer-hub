# Threat Model

## Protected assets

- Local source code, Git credentials and uncommitted work.
- GitHub and model-provider credentials.
- Runtime command authority.
- Remote projection and audit history.
- Device credentials and pairing codes.

## Trust boundaries

1. Browser to Hub API: authenticated with a Supabase access token.
2. Connector to Hub: authenticated with a random device token shown only once.
3. Connector to Runtime: loopback HTTP only.
4. Hub API to PostgreSQL/Redis: private network and TLS in production.

## Required controls

- Never accept `user_metadata` as authorization input; ownership comes from the JWT `sub`.
- Pairing codes are one-time, short-lived, HMAC-digested, consumed transactionally, and rate-limited by a privacy-preserving digest of the client address.
- Device tokens are random, HMAC-digested, revocable, and written to disk with mode `0600`.
- Every command is scoped to an owner, installation, runtime and target object.
- Every command has an idempotency key, optimistic preconditions and expiry.
- Connector messages are schema-validated and size-limited; event synchronization drops payloads and idempotency keys before upload.
- Logs redact Authorization, Cookie, tokens, provider payloads and common secret keys.
- The Hub never receives repository source, complete diffs, runtime credentials or raw Codex
  payloads.
- Runtime HTTP remains loopback; the Connector creates only outbound network connections.

## Explicit non-guarantees

The Connector runs under the user's OS identity and is not a sandbox. Hub cannot protect a
machine already compromised at that identity. Remote control should be disabled by revoking
the device credential or stopping the Connector.
