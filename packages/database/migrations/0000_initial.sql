CREATE SCHEMA IF NOT EXISTS hub;
REVOKE ALL ON SCHEMA hub FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA hub FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA hub FROM authenticated';
  END IF;
END
$$;

CREATE TABLE hub.installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX installations_owner_idx ON hub.installations(owner_id);

CREATE TABLE hub.pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES hub.installations(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hub.connector_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES hub.installations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  runtime_id text NOT NULL,
  connector_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (installation_id, runtime_id)
);

CREATE TABLE hub.runtime_snapshots (
  installation_id uuid NOT NULL REFERENCES hub.installations(id) ON DELETE CASCADE,
  runtime_id text NOT NULL,
  event_sequence integer NOT NULL CHECK (event_sequence >= 0),
  snapshot jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, runtime_id)
);

CREATE TABLE hub.runtime_events (
  installation_id uuid NOT NULL REFERENCES hub.installations(id) ON DELETE CASCADE,
  runtime_id text NOT NULL,
  native_event_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  event jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, runtime_id, native_event_id),
  UNIQUE (installation_id, runtime_id, sequence)
);

CREATE TABLE hub.commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  installation_id uuid NOT NULL REFERENCES hub.installations(id) ON DELETE CASCADE,
  runtime_id text NOT NULL,
  kind text NOT NULL,
  target_id text NOT NULL,
  idempotency_key text NOT NULL,
  expected_event_sequence integer CHECK (expected_event_sequence >= 0),
  expected_target_updated_at timestamptz,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','queued','delivering','succeeded','rejected','conflict','expired','failed')),
  result jsonb,
  error_code text,
  error_message text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX commands_delivery_idx ON hub.commands(status, expires_at);
CREATE INDEX commands_installation_idx ON hub.commands(installation_id, created_at DESC);

CREATE TABLE hub.command_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL REFERENCES hub.commands(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (command_id, attempt_number)
);

CREATE TABLE hub.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  installation_id uuid REFERENCES hub.installations(id) ON DELETE SET NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_owner_created_idx ON hub.audit_logs(owner_id, created_at DESC);

ALTER TABLE hub.installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub.pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub.connector_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub.runtime_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub.runtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub.command_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub.audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA hub FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA hub REVOKE ALL ON TABLES FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA hub FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA hub REVOKE ALL ON TABLES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA hub FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA hub REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END
$$;
