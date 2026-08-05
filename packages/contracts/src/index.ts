import { z } from "zod";

export { exponentialBackoff } from "./backoff.js";
export {
  assertCommandTransition,
  canTransitionCommand,
  isCommandExpired,
  sameIdempotentCommand,
  type CommandStatus,
  type IdempotentCommandIdentity,
} from "./command-policy.js";
export {
  createOpaqueToken,
  createPairingCode,
  digestSecret,
  normalizePairingCode,
  redact,
  safeDigestEqual,
} from "./security.js";

const NonEmptyString = z.string().trim().min(1);
const Timestamp = z.iso.datetime({ offset: true });

export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const RuntimeAttemptSchema = z
  .object({
    schemaVersion: NonEmptyString,
    id: NonEmptyString,
    taskId: NonEmptyString,
    sequence: z.number().int().positive(),
    startReason: NonEmptyString,
    status: NonEmptyString,
    workspaceId: NonEmptyString,
    updatedAt: Timestamp,
    startedAt: Timestamp,
    finishedAt: Timestamp.nullable().optional(),
    failure: z.string().nullable().optional(),
  })
  .passthrough();

export const RuntimeTaskSchema = z
  .object({
    schemaVersion: NonEmptyString,
    id: NonEmptyString,
    identifier: NonEmptyString,
    title: NonEmptyString,
    state: NonEmptyString,
    labels: z.array(NonEmptyString).default([]),
    dispatchable: z.boolean(),
    source: z
      .object({ kind: NonEmptyString, nativeId: NonEmptyString, url: z.url() })
      .passthrough(),
  })
  .passthrough();

const LocalVerificationSchema = z
  .object({
    schemaVersion: NonEmptyString,
    id: NonEmptyString,
    attemptId: NonEmptyString,
    checkId: NonEmptyString,
    status: NonEmptyString,
    argv: z.array(NonEmptyString),
    cwd: NonEmptyString,
    gitHead: NonEmptyString,
    tool: z.object({ name: NonEmptyString, version: NonEmptyString }),
    startedAt: Timestamp,
    finishedAt: Timestamp.nullable(),
    exitCode: z.number().int().nullable(),
    artifactRef: z.string().nullable(),
  })
  .passthrough();

const LocalReviewSchema = z
  .object({
    schemaVersion: NonEmptyString,
    id: NonEmptyString,
    attemptId: NonEmptyString,
    decision: NonEmptyString,
    decidedAt: Timestamp,
  })
  .passthrough();

const LocalInterventionSchema = z
  .object({
    schemaVersion: NonEmptyString,
    id: NonEmptyString,
    attemptId: NonEmptyString,
    kind: NonEmptyString,
    state: NonEmptyString,
    createdAt: Timestamp,
  })
  .passthrough();

export const LocalRuntimeSnapshotSchema = z
  .object({
    schemaVersion: NonEmptyString,
    projectionVersion: NonEmptyString,
    runtime: z
      .object({
        schemaVersion: NonEmptyString,
        status: z.enum(["online", "offline"]),
        runtimeId: NonEmptyString,
        endpoint: z.url(),
        startedAt: Timestamp,
        lastEventSequence: z.number().int().nonnegative(),
      })
      .passthrough(),
    tasks: z.array(RuntimeTaskSchema),
    attempts: z.array(RuntimeAttemptSchema),
    verifications: z.array(LocalVerificationSchema),
    reviews: z.array(LocalReviewSchema),
    interventions: z.array(LocalInterventionSchema),
  })
  .passthrough();
export type LocalRuntimeSnapshot = z.infer<typeof LocalRuntimeSnapshotSchema>;

const LocalDomainEventSchema = z
  .object({
    schemaVersion: NonEmptyString,
    id: NonEmptyString,
    type: NonEmptyString,
    source: z.enum(["symphony-core", "runtime", "adapter", "human"]),
    occurredAt: Timestamp,
    aggregate: z.object({
      kind: z.enum(["task", "attempt", "workspace", "verification", "review", "intervention"]),
      id: NonEmptyString,
    }),
    taskId: NonEmptyString.optional(),
    attemptId: NonEmptyString.optional(),
    idempotencyKey: NonEmptyString.optional(),
    payload: z.record(z.string(), JsonValueSchema),
  })
  .passthrough();

export const LocalRuntimeEventSchema = z
  .object({ sequence: z.number().int().positive(), event: LocalDomainEventSchema })
  .passthrough();
export type LocalRuntimeEvent = z.infer<typeof LocalRuntimeEventSchema>;

export const RuntimeEventSummarySchema = z.object({
  sequence: z.number().int().positive(),
  event: LocalDomainEventSchema.pick({
    schemaVersion: true,
    id: true,
    type: true,
    source: true,
    occurredAt: true,
    aggregate: true,
    taskId: true,
    attemptId: true,
  }),
});
export type RuntimeEventSummary = z.infer<typeof RuntimeEventSummarySchema>;

export function sanitizeRuntimeEvent(event: LocalRuntimeEvent): RuntimeEventSummary {
  return RuntimeEventSummarySchema.parse(event);
}

const VerificationSummarySchema = LocalVerificationSchema.pick({
  schemaVersion: true,
  id: true,
  attemptId: true,
  checkId: true,
  status: true,
  gitHead: true,
  tool: true,
  startedAt: true,
  finishedAt: true,
  exitCode: true,
});
const ReviewSummarySchema = LocalReviewSchema.pick({
  schemaVersion: true,
  id: true,
  attemptId: true,
  decision: true,
  decidedAt: true,
});
const InterventionSummarySchema = LocalInterventionSchema.pick({
  schemaVersion: true,
  id: true,
  attemptId: true,
  kind: true,
  state: true,
  createdAt: true,
});

export const RuntimeSnapshotSchema = z.object({
  schemaVersion: NonEmptyString,
  projectionVersion: NonEmptyString,
  runtime: z.object({
    schemaVersion: NonEmptyString,
    status: z.enum(["online", "offline"]),
    runtimeId: NonEmptyString,
    startedAt: Timestamp,
    lastEventSequence: z.number().int().nonnegative(),
  }),
  tasks: z.array(RuntimeTaskSchema.strip()),
  attempts: z.array(RuntimeAttemptSchema.strip()),
  verifications: z.array(VerificationSummarySchema),
  reviews: z.array(ReviewSummarySchema),
  interventions: z.array(InterventionSummarySchema),
});
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;

export function sanitizeRuntimeSnapshot(snapshot: LocalRuntimeSnapshot): RuntimeSnapshot {
  return RuntimeSnapshotSchema.parse({
    schemaVersion: snapshot.schemaVersion,
    projectionVersion: snapshot.projectionVersion,
    runtime: {
      schemaVersion: snapshot.runtime.schemaVersion,
      status: snapshot.runtime.status,
      runtimeId: snapshot.runtime.runtimeId,
      startedAt: snapshot.runtime.startedAt,
      lastEventSequence: snapshot.runtime.lastEventSequence,
    },
    tasks: snapshot.tasks,
    attempts: snapshot.attempts,
    verifications: snapshot.verifications,
    reviews: snapshot.reviews,
    interventions: snapshot.interventions,
  });
}

export const RuntimeCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pause_attempt"),
    idempotencyKey: NonEmptyString,
    attemptId: NonEmptyString,
    expectedEventSequence: z.number().int().nonnegative().optional(),
    expectedAttemptUpdatedAt: Timestamp.optional(),
  }),
  z.object({
    kind: z.literal("retry_attempt"),
    idempotencyKey: NonEmptyString,
    attemptId: NonEmptyString,
    expectedEventSequence: z.number().int().nonnegative().optional(),
    expectedAttemptUpdatedAt: Timestamp.optional(),
  }),
  z.object({
    kind: z.literal("respond_intervention"),
    idempotencyKey: NonEmptyString,
    interventionId: NonEmptyString,
    decidedBy: NonEmptyString,
    decision: z.enum(["approved", "rejected", "answered", "canceled"]),
    response: z.string().optional(),
    expectedEventSequence: z.number().int().nonnegative().optional(),
  }),
]);
export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>;

export const LocalRuntimeCommandResultSchema = z.object({
  schemaVersion: NonEmptyString,
  accepted: z.boolean(),
  eventSequence: z.number().int().nonnegative(),
  message: NonEmptyString,
  snapshot: LocalRuntimeSnapshotSchema,
});
export type LocalRuntimeCommandResult = z.infer<typeof LocalRuntimeCommandResultSchema>;

export const RuntimeCommandResultSchema = z.object({
  schemaVersion: NonEmptyString,
  accepted: z.boolean(),
  eventSequence: z.number().int().nonnegative(),
  message: NonEmptyString,
  snapshot: RuntimeSnapshotSchema,
});
export type RuntimeCommandResult = z.infer<typeof RuntimeCommandResultSchema>;

export function sanitizeRuntimeCommandResult(
  result: LocalRuntimeCommandResult,
): RuntimeCommandResult {
  return RuntimeCommandResultSchema.parse({
    ...result,
    snapshot: sanitizeRuntimeSnapshot(result.snapshot),
  });
}

export const ConnectorToHubMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("connector.hello"),
    protocolVersion: z.literal(1),
    runtimeId: NonEmptyString,
    connectorVersion: NonEmptyString,
  }),
  z.object({ type: z.literal("connector.heartbeat"), sentAt: Timestamp }),
  z.object({ type: z.literal("connector.snapshot"), snapshot: RuntimeSnapshotSchema }),
  z.object({
    type: z.literal("connector.events"),
    events: z.array(RuntimeEventSummarySchema).min(1).max(200),
  }),
  z.object({
    type: z.literal("connector.command_result"),
    commandId: z.uuid(),
    status: z.enum(["succeeded", "rejected", "conflict", "expired", "failed"]),
    result: RuntimeCommandResultSchema.optional(),
    errorCode: NonEmptyString.optional(),
    errorMessage: NonEmptyString.optional(),
    finishedAt: Timestamp,
  }),
]);
export type ConnectorToHubMessage = z.infer<typeof ConnectorToHubMessageSchema>;

export const HubToConnectorMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hub.ready"), connectionId: z.uuid(), serverTime: Timestamp }),
  z.object({
    type: z.literal("hub.command"),
    commandId: z.uuid(),
    expiresAt: Timestamp,
    command: RuntimeCommandSchema,
  }),
  z.object({ type: z.literal("hub.error"), code: NonEmptyString, message: NonEmptyString }),
]);
export type HubToConnectorMessage = z.infer<typeof HubToConnectorMessageSchema>;

export const CreateInstallationSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export const CreatePairingCodeSchema = z.object({
  ttlSeconds: z.number().int().min(60).max(900).default(300),
});
export const PairConnectorSchema = z.object({
  code: NonEmptyString,
  runtimeId: NonEmptyString,
  connectorName: z.string().trim().min(1).max(80),
});
export const PauseAttemptSchema = z.object({
  runtimeId: NonEmptyString,
  attemptId: NonEmptyString,
  expectedEventSequence: z.number().int().nonnegative(),
  expectedAttemptUpdatedAt: Timestamp,
  expiresInSeconds: z.number().int().min(10).max(300).default(60),
});
