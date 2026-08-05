import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const hub = pgSchema("hub");

export const installations = hub.table(
  "installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("installations_owner_idx").on(table.ownerId)],
);

export const pairingCodes = hub.table(
  "pairing_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("pairing_codes_hash_uq").on(table.codeHash)],
);

export const connectorCredentials = hub.table(
  "connector_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    runtimeId: text("runtime_id").notNull(),
    connectorName: text("connector_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("connector_credentials_token_uq").on(table.tokenHash),
    uniqueIndex("connector_credentials_installation_runtime_uq").on(
      table.installationId,
      table.runtimeId,
    ),
  ],
);

export const runtimeSnapshots = hub.table(
  "runtime_snapshots",
  {
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id, { onDelete: "cascade" }),
    runtimeId: text("runtime_id").notNull(),
    eventSequence: integer("event_sequence").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.installationId, table.runtimeId] })],
);

export const runtimeEvents = hub.table(
  "runtime_events",
  {
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id, { onDelete: "cascade" }),
    runtimeId: text("runtime_id").notNull(),
    nativeEventId: text("native_event_id").notNull(),
    sequence: integer("sequence").notNull(),
    event: jsonb("event").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.installationId, table.runtimeId, table.nativeEventId] }),
    uniqueIndex("runtime_events_sequence_uq").on(
      table.installationId,
      table.runtimeId,
      table.sequence,
    ),
  ],
);

export const commands = hub.table(
  "commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id, { onDelete: "cascade" }),
    runtimeId: text("runtime_id").notNull(),
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    expectedEventSequence: integer("expected_event_sequence"),
    expectedTargetUpdatedAt: timestamp("expected_target_updated_at", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("created"),
    result: jsonb("result"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("commands_owner_idempotency_uq").on(table.ownerId, table.idempotencyKey),
    index("commands_delivery_idx").on(table.status, table.expiresAt),
    index("commands_installation_idx").on(table.installationId, table.createdAt),
  ],
);

export const commandAttempts = hub.table(
  "command_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commandId: uuid("command_id")
      .notNull()
      .references(() => commands.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("command_attempt_number_uq").on(table.commandId, table.attemptNumber)],
);

export const auditLogs = hub.table(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    installationId: uuid("installation_id").references(() => installations.id, {
      onDelete: "set null",
    }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_owner_created_idx").on(table.ownerId, table.createdAt)],
);
