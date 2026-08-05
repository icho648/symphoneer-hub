import {
  type CommandStatus,
  canTransitionCommand,
  type RuntimeCommand,
  type RuntimeEventSummary,
  type RuntimeSnapshot,
  sameIdempotentCommand,
} from "@symphoneer-hub/contracts";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  auditLogs,
  commandAttempts,
  commands,
  connectorCredentials,
  installations,
  pairingCodes,
  runtimeEvents,
  runtimeSnapshots,
} from "./schema.js";

export class HubRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async assertInstallationOwner(ownerId: string, installationId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: installations.id })
      .from(installations)
      .where(and(eq(installations.id, installationId), eq(installations.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new RepositoryError("not_found", "installation not found");
  }

  async assertRuntimeOwner(
    ownerId: string,
    installationId: string,
    runtimeId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: connectorCredentials.id })
      .from(connectorCredentials)
      .innerJoin(installations, eq(installations.id, connectorCredentials.installationId))
      .where(
        and(
          eq(installations.ownerId, ownerId),
          eq(connectorCredentials.installationId, installationId),
          eq(connectorCredentials.runtimeId, runtimeId),
          isNull(connectorCredentials.revokedAt),
        ),
      )
      .limit(1);
    if (!row)
      throw new RepositoryError("runtime_not_found", "runtime is not paired to this installation");
  }

  async createInstallation(ownerId: string, name: string) {
    const [row] = await this.db.insert(installations).values({ ownerId, name }).returning();
    if (!row) throw new RepositoryError("write_failed", "installation was not created");
    await this.appendAudit({
      ownerId,
      installationId: row.id,
      actorType: "user",
      actorId: ownerId,
      action: "installation.created",
      targetType: "installation",
      targetId: row.id,
      metadata: { name },
    });
    return row;
  }

  listInstallations(ownerId: string) {
    return this.db
      .select()
      .from(installations)
      .where(eq(installations.ownerId, ownerId))
      .orderBy(desc(installations.updatedAt));
  }

  async createPairingCode(input: {
    ownerId: string;
    installationId: string;
    codeHash: string;
    expiresAt: Date;
  }) {
    await this.assertInstallationOwner(input.ownerId, input.installationId);
    await this.db
      .delete(pairingCodes)
      .where(
        and(eq(pairingCodes.installationId, input.installationId), isNull(pairingCodes.consumedAt)),
      );
    const [row] = await this.db
      .insert(pairingCodes)
      .values({
        installationId: input.installationId,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
      })
      .returning({ id: pairingCodes.id });
    if (!row) throw new RepositoryError("write_failed", "pairing code was not created");
    return row;
  }

  async consumePairingCode(input: {
    codeHash: string;
    runtimeId: string;
    connectorName: string;
    tokenHash: string;
  }) {
    return this.db.transaction(async (tx) => {
      const [pairing] = await tx
        .select()
        .from(pairingCodes)
        .where(
          and(
            eq(pairingCodes.codeHash, input.codeHash),
            isNull(pairingCodes.consumedAt),
            gt(pairingCodes.expiresAt, new Date()),
          ),
        )
        .for("update")
        .limit(1);
      if (!pairing)
        throw new RepositoryError("invalid_pairing_code", "pairing code is invalid or expired");

      const [installation] = await tx
        .select({ ownerId: installations.ownerId })
        .from(installations)
        .where(eq(installations.id, pairing.installationId))
        .limit(1);
      if (!installation) throw new RepositoryError("not_found", "installation not found");

      await tx
        .update(pairingCodes)
        .set({ consumedAt: new Date() })
        .where(eq(pairingCodes.id, pairing.id));

      const [credential] = await tx
        .insert(connectorCredentials)
        .values({
          installationId: pairing.installationId,
          tokenHash: input.tokenHash,
          runtimeId: input.runtimeId,
          connectorName: input.connectorName,
        })
        .onConflictDoUpdate({
          target: [connectorCredentials.installationId, connectorCredentials.runtimeId],
          set: {
            tokenHash: input.tokenHash,
            connectorName: input.connectorName,
            revokedAt: null,
            lastSeenAt: new Date(),
          },
        })
        .returning();
      if (!credential)
        throw new RepositoryError("write_failed", "connector credential was not created");

      await tx.insert(auditLogs).values({
        ownerId: installation.ownerId,
        installationId: pairing.installationId,
        actorType: "connector",
        actorId: credential.id,
        action: "connector.paired",
        targetType: "runtime",
        targetId: input.runtimeId,
        metadata: { connectorName: input.connectorName },
      });
      return { credential, ownerId: installation.ownerId };
    });
  }

  async findConnectorByTokenHash(tokenHash: string) {
    const [row] = await this.db
      .select({
        credentialId: connectorCredentials.id,
        installationId: connectorCredentials.installationId,
        runtimeId: connectorCredentials.runtimeId,
        ownerId: installations.ownerId,
      })
      .from(connectorCredentials)
      .innerJoin(installations, eq(installations.id, connectorCredentials.installationId))
      .where(
        and(eq(connectorCredentials.tokenHash, tokenHash), isNull(connectorCredentials.revokedAt)),
      )
      .limit(1);
    return row ?? null;
  }

  async touchConnector(credentialId: string) {
    await this.db
      .update(connectorCredentials)
      .set({ lastSeenAt: new Date() })
      .where(eq(connectorCredentials.id, credentialId));
  }

  async upsertSnapshot(installationId: string, snapshot: RuntimeSnapshot) {
    await this.db
      .insert(runtimeSnapshots)
      .values({
        installationId,
        runtimeId: snapshot.runtime.runtimeId,
        eventSequence: snapshot.runtime.lastEventSequence,
        snapshot,
        observedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [runtimeSnapshots.installationId, runtimeSnapshots.runtimeId],
        set: {
          eventSequence: sql`greatest(${runtimeSnapshots.eventSequence}, excluded.event_sequence)`,
          snapshot: sql`case when excluded.event_sequence >= ${runtimeSnapshots.eventSequence} then excluded.snapshot else ${runtimeSnapshots.snapshot} end`,
          observedAt: sql`case when excluded.event_sequence >= ${runtimeSnapshots.eventSequence} then excluded.observed_at else ${runtimeSnapshots.observedAt} end`,
        },
      });
  }

  async insertRuntimeEvents(
    installationId: string,
    runtimeId: string,
    events: RuntimeEventSummary[],
  ): Promise<void> {
    if (events.length === 0) return;
    await this.db
      .insert(runtimeEvents)
      .values(
        events.map((item) => ({
          installationId,
          runtimeId,
          nativeEventId: item.event.id,
          sequence: item.sequence,
          event: item,
          observedAt: new Date(),
        })),
      )
      .onConflictDoNothing({
        target: [
          runtimeEvents.installationId,
          runtimeEvents.runtimeId,
          runtimeEvents.nativeEventId,
        ],
      });
  }

  async getSnapshot(ownerId: string, installationId: string) {
    const [row] = await this.db
      .select({
        runtimeId: runtimeSnapshots.runtimeId,
        eventSequence: runtimeSnapshots.eventSequence,
        snapshot: runtimeSnapshots.snapshot,
        observedAt: runtimeSnapshots.observedAt,
      })
      .from(runtimeSnapshots)
      .innerJoin(installations, eq(installations.id, runtimeSnapshots.installationId))
      .where(
        and(
          eq(runtimeSnapshots.installationId, installationId),
          eq(installations.ownerId, ownerId),
        ),
      )
      .orderBy(desc(runtimeSnapshots.observedAt))
      .limit(1);
    return row ?? null;
  }

  async createCommand(input: {
    ownerId: string;
    installationId: string;
    runtimeId: string;
    targetId: string;
    idempotencyKey: string;
    expectedEventSequence: number;
    expectedTargetUpdatedAt: Date;
    command: RuntimeCommand;
    expiresAt: Date;
  }) {
    await this.assertRuntimeOwner(input.ownerId, input.installationId, input.runtimeId);
    const [row] = await this.db
      .insert(commands)
      .values({
        ownerId: input.ownerId,
        installationId: input.installationId,
        runtimeId: input.runtimeId,
        kind: input.command.kind,
        targetId: input.targetId,
        idempotencyKey: input.idempotencyKey,
        expectedEventSequence: input.expectedEventSequence,
        expectedTargetUpdatedAt: input.expectedTargetUpdatedAt,
        payload: input.command,
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing({ target: [commands.ownerId, commands.idempotencyKey] })
      .returning();
    if (row) {
      await this.appendAudit({
        ownerId: input.ownerId,
        installationId: input.installationId,
        actorType: "user",
        actorId: input.ownerId,
        action: "command.created",
        targetType: "command",
        targetId: row.id,
        metadata: { kind: input.command.kind, targetId: input.targetId },
      });
      return { command: row, created: true as const };
    }
    const [existing] = await this.db
      .select()
      .from(commands)
      .where(
        and(eq(commands.ownerId, input.ownerId), eq(commands.idempotencyKey, input.idempotencyKey)),
      )
      .limit(1);
    if (!existing) throw new RepositoryError("write_failed", "command was not created");
    const sameRequest = sameIdempotentCommand(
      {
        installationId: existing.installationId,
        runtimeId: existing.runtimeId,
        kind: existing.kind,
        targetId: existing.targetId,
        expectedEventSequence: existing.expectedEventSequence,
        expectedTargetUpdatedAt: existing.expectedTargetUpdatedAt,
        payload: existing.payload,
      },
      {
        installationId: input.installationId,
        runtimeId: input.runtimeId,
        kind: input.command.kind,
        targetId: input.targetId,
        expectedEventSequence: input.expectedEventSequence,
        expectedTargetUpdatedAt: input.expectedTargetUpdatedAt,
        payload: input.command,
      },
    );
    if (!sameRequest) {
      throw new RepositoryError(
        "idempotency_key_reused",
        "idempotency key was already used for a different command",
      );
    }
    return { command: existing, created: false as const };
  }

  async getCommand(commandId: string) {
    const [row] = await this.db.select().from(commands).where(eq(commands.id, commandId)).limit(1);
    return row ?? null;
  }

  async getCommandForOwner(ownerId: string, installationId: string, commandId: string) {
    const [row] = await this.db
      .select({
        id: commands.id,
        status: commands.status,
        result: commands.result,
        errorCode: commands.errorCode,
        errorMessage: commands.errorMessage,
        expiresAt: commands.expiresAt,
        createdAt: commands.createdAt,
        updatedAt: commands.updatedAt,
        finishedAt: commands.finishedAt,
      })
      .from(commands)
      .where(
        and(
          eq(commands.id, commandId),
          eq(commands.ownerId, ownerId),
          eq(commands.installationId, installationId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async setCommandStatus(input: {
    commandId: string;
    status: CommandStatus;
    result?: unknown;
    errorCode?: string;
    errorMessage?: string;
    terminal?: boolean;
  }) {
    const [current] = await this.db
      .select({ status: commands.status })
      .from(commands)
      .where(eq(commands.id, input.commandId))
      .limit(1);
    if (!current) return null;
    const currentStatus = current.status as CommandStatus;
    if (currentStatus !== input.status && !canTransitionCommand(currentStatus, input.status)) {
      throw new RepositoryError(
        "command_conflict",
        `invalid command transition: ${currentStatus} -> ${input.status}`,
      );
    }

    const values = {
      status: input.status,
      updatedAt: new Date(),
      ...(input.result === undefined ? {} : { result: input.result }),
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
      ...(input.terminal === undefined ? {} : { finishedAt: input.terminal ? new Date() : null }),
    };
    const [row] = await this.db
      .update(commands)
      .set(values)
      .where(and(eq(commands.id, input.commandId), eq(commands.status, current.status)))
      .returning();
    if (!row) throw new RepositoryError("command_conflict", "command status changed concurrently");
    return row;
  }

  async completeCommandFromConnector(input: {
    commandId: string;
    installationId: string;
    runtimeId: string;
    status: string;
    result?: unknown;
    errorCode?: string;
    errorMessage?: string;
  }) {
    const values = {
      status: input.status,
      updatedAt: new Date(),
      finishedAt: new Date(),
      ...(input.result === undefined ? {} : { result: input.result }),
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
    };
    const [row] = await this.db
      .update(commands)
      .set(values)
      .where(
        and(
          eq(commands.id, input.commandId),
          eq(commands.installationId, input.installationId),
          eq(commands.runtimeId, input.runtimeId),
          sql`${commands.status} in ('queued', 'delivering')`,
        ),
      )
      .returning({ ownerId: commands.ownerId, commandId: commands.id });
    return row ?? null;
  }

  async createCommandAttempt(commandId: string, attemptNumber: number) {
    const [row] = await this.db
      .insert(commandAttempts)
      .values({ commandId, attemptNumber, status: "delivering" })
      .onConflictDoNothing({
        target: [commandAttempts.commandId, commandAttempts.attemptNumber],
      })
      .returning();
    if (row) return row;
    const [existing] = await this.db
      .select()
      .from(commandAttempts)
      .where(
        and(
          eq(commandAttempts.commandId, commandId),
          eq(commandAttempts.attemptNumber, attemptNumber),
        ),
      )
      .limit(1);
    if (!existing) throw new RepositoryError("write_failed", "command attempt was not created");
    return existing;
  }

  async finishCommandAttempt(input: {
    attemptId: string;
    status: string;
    errorCode?: string;
    errorMessage?: string;
  }) {
    await this.db
      .update(commandAttempts)
      .set({
        status: input.status,
        ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
        ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
        finishedAt: new Date(),
      })
      .where(eq(commandAttempts.id, input.attemptId));
  }

  async listRecoverableCommands(limit = 100) {
    return this.db
      .select({ id: commands.id })
      .from(commands)
      .where(
        sql`${commands.status} in ('created', 'queued', 'delivering') and ${commands.expiresAt} > now()`,
      )
      .limit(limit);
  }

  async appendAudit(input: typeof auditLogs.$inferInsert) {
    await this.db.insert(auditLogs).values(input);
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }
}

export class RepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RepositoryError";
  }
}
