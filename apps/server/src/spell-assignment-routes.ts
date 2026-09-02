import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  appendSpellAssignmentVersionCommandSchema,
  createSpellAssignmentCommandSchema,
  spellAssignmentSnapshotSchema,
  type SpellAssignmentSnapshot,
  type SpellAssignmentTarget,
  type SpellAssignmentVersionDto,
} from "@arken/contracts";
import {
  characters,
  characterSpellAssignments,
  characterSpellAssignmentVersions,
  gameEvents,
} from "@arken/db";
import { requireAuth, type AuthContext } from "./auth.js";
import {
  buildSpellAssignmentSnapshot,
  evaluateSpellAssignmentPrerequisites,
  hasDuplicateCurrentTarget,
  loadActiveSpellGraph,
  loadCurrentSpellAssignmentVersions,
  SpellAssignmentDomainError,
  type SpellPrerequisiteFailure,
} from "./spell-assignment-storage.js";
import type { SpellPackTransaction } from "./spell-pack-storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type SpellAssignmentDb = Database | SpellPackTransaction;
type AssignmentRow = typeof characterSpellAssignments.$inferSelect;
type AssignmentVersionRow =
  typeof characterSpellAssignmentVersions.$inferSelect;
type EventRow = typeof gameEvents.$inferSelect;

const canonicalUuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const createParamsSchema = z
  .object({ characterId: canonicalUuidSchema })
  .strict();
const appendParamsSchema = z
  .object({
    characterId: canonicalUuidSchema,
    assignmentId: canonicalUuidSchema,
  })
  .strict();

class SpellAssignmentCommandError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "SpellAssignmentCommandError";
  }
}

function fail(
  reply: FastifyReply,
  status: number,
  error: string,
  details?: unknown,
) {
  return reply.code(status).send(
    details === undefined
      ? { error }
      : {
          error,
          details,
        },
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function commandHash(
  operation: "CREATE" | "APPEND",
  assignmentId: string,
  body: unknown,
): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, assignmentId, body }))
    .digest("hex");
}

interface ActionMetadata {
  type: string;
  operation: "CREATE" | "APPEND";
  assignmentId: string;
  assignmentVersionId: string;
  targetVersion: number;
  characterId: string;
  packId: string;
  packVersionId: string;
  target: SpellAssignmentTarget;
  overrideReason?: string;
  commandHash: string;
}

interface ActionPayload {
  operation?: unknown;
  commandHash?: unknown;
  assignmentVersionId?: unknown;
  targetVersion?: unknown;
  characterId?: unknown;
  packId?: unknown;
  packVersionId?: unknown;
  kind?: unknown;
  schoolId?: unknown;
  nodeId?: unknown;
  rank?: unknown;
  overrideReason?: unknown;
}

function actionPayload(metadata: ActionMetadata) {
  return {
    operation: metadata.operation,
    commandHash: metadata.commandHash,
    assignmentVersionId: metadata.assignmentVersionId,
    targetVersion: metadata.targetVersion,
    characterId: metadata.characterId,
    packId: metadata.packId,
    packVersionId: metadata.packVersionId,
    kind: metadata.target.kind,
    schoolId: metadata.target.schoolId,
    nodeId: metadata.target.kind === "NODE" ? metadata.target.nodeId : null,
    rank: metadata.target.kind === "NODE" ? metadata.target.rank : null,
    overrideReason: metadata.overrideReason ?? null,
  };
}

async function findAction(
  db: SpellAssignmentDb,
  campaignId: string,
  actionId: string,
) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  return event ?? null;
}

function actionMatches(
  event: EventRow,
  auth: AuthContext,
  metadata: ActionMetadata,
): boolean {
  const payload = event.payload as ActionPayload | null;
  const expected = actionPayload(metadata);
  return (
    event.membershipId === auth.membershipId &&
    event.type === metadata.type &&
    event.entityType === "CHARACTER_SPELL_ASSIGNMENT" &&
    event.entityId === metadata.assignmentId &&
    event.entityRevision === metadata.targetVersion &&
    payload?.operation === expected.operation &&
    payload.commandHash === expected.commandHash &&
    payload.assignmentVersionId === expected.assignmentVersionId &&
    payload.targetVersion === expected.targetVersion &&
    payload.characterId === expected.characterId &&
    payload.packId === expected.packId &&
    payload.packVersionId === expected.packVersionId &&
    payload.kind === expected.kind &&
    payload.schoolId === expected.schoolId &&
    payload.nodeId === expected.nodeId &&
    payload.rank === expected.rank &&
    payload.overrideReason === expected.overrideReason
  );
}

type ActionState =
  { kind: "MISS" } | { kind: "REPLAY"; event: EventRow } | { kind: "CONFLICT" };

async function classifyAction(
  db: SpellAssignmentDb,
  auth: AuthContext,
  actionId: string,
  metadata: ActionMetadata,
): Promise<ActionState> {
  const event = await findAction(db, auth.campaignId, actionId);
  if (!event) return { kind: "MISS" };
  return actionMatches(event, auth, metadata)
    ? { kind: "REPLAY", event }
    : { kind: "CONFLICT" };
}

async function claimAction(
  tx: SpellPackTransaction,
  auth: AuthContext,
  actionId: string,
  metadata: ActionMetadata,
): Promise<
  Exclude<ActionState, { kind: "MISS" }> | { kind: "CLAIMED"; event: EventRow }
> {
  const [event] = await tx
    .insert(gameEvents)
    .values({
      campaignId: auth.campaignId,
      actionId,
      membershipId: auth.membershipId,
      type: metadata.type,
      entityType: "CHARACTER_SPELL_ASSIGNMENT",
      entityId: metadata.assignmentId,
      entityRevision: metadata.targetVersion,
      payload: actionPayload(metadata),
    })
    .onConflictDoNothing({
      target: [gameEvents.campaignId, gameEvents.actionId],
    })
    .returning();
  if (event) return { kind: "CLAIMED", event };

  const classified = await classifyAction(tx, auth, actionId, metadata);
  if (classified.kind === "MISS")
    throw new Error("SPELL_ASSIGNMENT_ACTION_CLAIM_FAILED");
  return classified;
}

type MutationValue = {
  version: AssignmentVersionRow;
  audit?: Record<string, unknown>;
};
type MutationOutcome =
  | { kind: "RESULT"; value: MutationValue }
  | { kind: "REPLAY"; event: EventRow }
  | { kind: "CONFLICT" };

async function runMutation(
  db: Database,
  auth: AuthContext,
  actionId: string,
  metadata: ActionMetadata,
  lockTarget: (tx: SpellPackTransaction) => Promise<unknown>,
  mutate: (tx: SpellPackTransaction) => Promise<MutationValue>,
): Promise<MutationOutcome> {
  const preflight = await classifyAction(db, auth, actionId, metadata);
  if (preflight.kind !== "MISS") return preflight;

  return db.transaction(async (tx) => {
    // Keep the shared lock order used by existing character mutations:
    // character first, action ledger second. Reversing these two can deadlock
    // when another route reuses the same actionId while holding this character.
    await lockTarget(tx);
    const claimed = await claimAction(tx, auth, actionId, metadata);
    if (claimed.kind !== "CLAIMED") return claimed;
    const result = await mutate(tx);
    if (result.audit)
      await tx
        .update(gameEvents)
        .set({ payload: { ...actionPayload(metadata), ...result.audit } })
        .where(eq(gameEvents.sequence, claimed.event.sequence));
    return { kind: "RESULT" as const, value: result };
  });
}

function versionDto(row: AssignmentVersionRow): SpellAssignmentVersionDto {
  return {
    assignmentId: row.assignmentId,
    assignmentVersionId: row.id,
    version: row.version,
    characterId: row.characterId,
    packId: row.packId,
    packVersionId: row.packVersionId,
    kind: row.kind,
    schoolId: row.schoolId,
    nodeId: row.nodeId,
    rank: row.rank,
    snapshot: spellAssignmentSnapshotSchema.parse(row.snapshot),
    overrideReason: row.overrideReason,
    assignedByMembershipId: row.assignedByMembershipId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function versionForReplay(
  db: Database,
  campaignId: string,
  metadata: ActionMetadata,
) {
  const [row] = await db
    .select()
    .from(characterSpellAssignmentVersions)
    .where(
      and(
        eq(characterSpellAssignmentVersions.campaignId, campaignId),
        eq(characterSpellAssignmentVersions.characterId, metadata.characterId),
        eq(
          characterSpellAssignmentVersions.assignmentId,
          metadata.assignmentId,
        ),
        eq(characterSpellAssignmentVersions.id, metadata.assignmentVersionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function sendMutationOutcome(
  reply: FastifyReply,
  db: Database,
  auth: AuthContext,
  metadata: ActionMetadata,
  outcome: MutationOutcome,
) {
  if (outcome.kind === "CONFLICT")
    return fail(reply, 409, "ACTION_ID_CONFLICT");
  if (outcome.kind === "REPLAY") {
    const saved = await versionForReplay(db, auth.campaignId, metadata);
    return saved
      ? reply.code(200).send(versionDto(saved))
      : fail(reply, 500, "SPELL_ASSIGNMENT_REPLAY_PROJECTION_FAILED");
  }
  return reply.code(201).send(versionDto(outcome.value.version));
}

async function requireGm(
  request: Parameters<typeof requireAuth>[0],
  reply: FastifyReply,
  db: Database,
) {
  const auth = await requireAuth(request, reply, db);
  if (!auth) return null;
  if (auth.role !== "GM") {
    fail(reply, 403, "GM_REQUIRED");
    return null;
  }
  return auth;
}

async function lockCharacter(
  tx: SpellPackTransaction,
  campaignId: string,
  characterId: string,
) {
  const [character] = await tx
    .select({ id: characters.id, lifecycle: characters.lifecycle })
    .from(characters)
    .where(
      and(
        eq(characters.campaignId, campaignId),
        eq(characters.id, characterId),
      ),
    )
    .limit(1)
    .for("update");
  if (!character)
    throw new SpellAssignmentCommandError(404, "CHARACTER_NOT_FOUND");
  if (character.lifecycle !== "ACTIVE")
    throw new SpellAssignmentCommandError(422, "CHARACTER_ARCHIVED");
  return character;
}

async function lockAssignment(
  tx: SpellPackTransaction,
  campaignId: string,
  characterId: string,
  assignmentId: string,
): Promise<AssignmentRow> {
  const [assignment] = await tx
    .select()
    .from(characterSpellAssignments)
    .where(
      and(
        eq(characterSpellAssignments.campaignId, campaignId),
        eq(characterSpellAssignments.characterId, characterId),
        eq(characterSpellAssignments.id, assignmentId),
      ),
    )
    .limit(1)
    .for("update");
  if (!assignment)
    throw new SpellAssignmentCommandError(404, "SPELL_ASSIGNMENT_NOT_FOUND");
  return assignment;
}

async function latestAssignmentVersion(
  tx: SpellPackTransaction,
  campaignId: string,
  assignmentId: string,
) {
  const [version] = await tx
    .select()
    .from(characterSpellAssignmentVersions)
    .where(
      and(
        eq(characterSpellAssignmentVersions.campaignId, campaignId),
        eq(characterSpellAssignmentVersions.assignmentId, assignmentId),
      ),
    )
    .orderBy(desc(characterSpellAssignmentVersions.version))
    .limit(1);
  if (!version) throw new Error("SPELL_ASSIGNMENT_LATEST_VERSION_MISSING");
  return version;
}

function requireExpectedVersion(
  current: AssignmentVersionRow,
  expectedVersion: number,
) {
  if (current.version !== expectedVersion)
    throw new SpellAssignmentCommandError(
      409,
      "SPELL_ASSIGNMENT_VERSION_CONFLICT",
      { expectedVersion, actualVersion: current.version },
    );
}

function hasSameState(
  current: AssignmentVersionRow,
  packVersionId: string,
  target: SpellAssignmentTarget,
) {
  return (
    current.packVersionId === packVersionId &&
    current.kind === target.kind &&
    current.schoolId === target.schoolId &&
    current.nodeId === (target.kind === "NODE" ? target.nodeId : null) &&
    current.rank === (target.kind === "NODE" ? target.rank : null)
  );
}

async function evaluateCandidate(
  tx: SpellPackTransaction,
  campaignId: string,
  characterId: string,
  candidate: SpellAssignmentSnapshot,
  overrideReason: string | undefined,
  excludeAssignmentId?: string,
): Promise<SpellPrerequisiteFailure[]> {
  const current = await loadCurrentSpellAssignmentVersions(
    tx,
    campaignId,
    characterId,
    excludeAssignmentId,
  );
  if (hasDuplicateCurrentTarget(candidate, current))
    throw new SpellAssignmentCommandError(
      409,
      "SPELL_ASSIGNMENT_TARGET_ALREADY_ASSIGNED",
    );
  const failures = evaluateSpellAssignmentPrerequisites(candidate, current);
  if (failures.length > 0 && overrideReason === undefined)
    throw new SpellAssignmentCommandError(
      422,
      "SPELL_ASSIGNMENT_PREREQUISITES_UNMET",
      { failures },
    );
  if (failures.length === 0 && overrideReason !== undefined)
    throw new SpellAssignmentCommandError(
      422,
      "SPELL_ASSIGNMENT_OVERRIDE_NOT_REQUIRED",
    );
  return failures;
}

function isPostgresUniqueViolation(error: unknown): boolean {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "code" in candidate &&
      candidate.code === "23505"
    )
      return true;
  }
  return false;
}

function commandFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof SpellAssignmentCommandError)
    return fail(reply, error.status, error.code, error.details);
  if (error instanceof SpellAssignmentDomainError) {
    const status = error.code.endsWith("NOT_FOUND") ? 404 : 422;
    return fail(reply, status, error.code);
  }
  if (isPostgresUniqueViolation(error))
    return fail(reply, 409, "SPELL_ASSIGNMENT_CONFLICT");
  throw error;
}

function eventType(
  operation: "CREATE" | "APPEND",
  overrideReason: string | undefined,
) {
  if (overrideReason !== undefined)
    return "character_spell_assignment.overridden";
  return operation === "CREATE"
    ? "character_spell_assignment.assigned"
    : "character_spell_assignment.reassigned";
}

export function registerSpellAssignmentRoutes(
  app: FastifyInstance,
  db: Database,
) {
  app.post(
    "/api/characters/:characterId/spell-assignments",
    async (request, reply) => {
      const auth = await requireGm(request, reply, db);
      if (!auth) return;
      const params = createParamsSchema.safeParse(request.params);
      const parsed = createSpellAssignmentCommandSchema.safeParse(request.body);
      if (!params.success || !parsed.success)
        return fail(reply, 400, "INVALID_REQUEST");
      const body = parsed.data;
      const metadata: ActionMetadata = {
        type: eventType("CREATE", body.overrideReason),
        operation: "CREATE",
        assignmentId: body.assignmentId,
        assignmentVersionId: body.assignmentVersionId,
        targetVersion: 1,
        characterId: params.data.characterId,
        packId: body.packId,
        packVersionId: body.packVersionId,
        target: body.target,
        overrideReason: body.overrideReason,
        commandHash: commandHash("CREATE", body.assignmentId, body),
      };
      try {
        const outcome = await runMutation(
          db,
          auth,
          body.actionId,
          metadata,
          (tx) => lockCharacter(tx, auth.campaignId, params.data.characterId),
          async (tx) => {
            const loaded = await loadActiveSpellGraph(
              tx,
              auth.campaignId,
              body.packId,
              body.packVersionId,
            );
            const snapshot = buildSpellAssignmentSnapshot(
              loaded,
              {
                assignmentId: body.assignmentId,
                assignmentVersionId: body.assignmentVersionId,
                assignmentVersion: 1,
              },
              body.target,
            );
            const failures = await evaluateCandidate(
              tx,
              auth.campaignId,
              params.data.characterId,
              snapshot,
              body.overrideReason,
            );
            const [assignment] = await tx
              .insert(characterSpellAssignments)
              .values({
                id: body.assignmentId,
                campaignId: auth.campaignId,
                characterId: params.data.characterId,
                packId: body.packId,
              })
              .returning();
            if (!assignment) throw new Error("SPELL_ASSIGNMENT_CREATE_FAILED");
            const [version] = await tx
              .insert(characterSpellAssignmentVersions)
              .values({
                id: body.assignmentVersionId,
                campaignId: auth.campaignId,
                assignmentId: body.assignmentId,
                characterId: params.data.characterId,
                packId: body.packId,
                packVersionId: body.packVersionId,
                version: 1,
                kind: snapshot.kind,
                schoolId: snapshot.schoolId,
                nodeId: snapshot.nodeId,
                rank: snapshot.rank,
                snapshot,
                overrideReason: body.overrideReason,
                assignedByMembershipId: auth.membershipId,
              })
              .returning();
            if (!version)
              throw new Error("SPELL_ASSIGNMENT_VERSION_CREATE_FAILED");
            return {
              version,
              audit:
                failures.length > 0
                  ? { prerequisiteFailures: failures }
                  : undefined,
            };
          },
        );
        return sendMutationOutcome(reply, db, auth, metadata, outcome);
      } catch (error) {
        return commandFailure(reply, error);
      }
    },
  );

  app.post(
    "/api/characters/:characterId/spell-assignments/:assignmentId/versions",
    async (request, reply) => {
      const auth = await requireGm(request, reply, db);
      if (!auth) return;
      const params = appendParamsSchema.safeParse(request.params);
      const parsed = appendSpellAssignmentVersionCommandSchema.safeParse(
        request.body,
      );
      if (!params.success || !parsed.success)
        return fail(reply, 400, "INVALID_REQUEST");
      const body = parsed.data;
      const targetVersion = body.expectedVersion + 1;
      const metadata: ActionMetadata = {
        type: eventType("APPEND", body.overrideReason),
        operation: "APPEND",
        assignmentId: params.data.assignmentId,
        assignmentVersionId: body.assignmentVersionId,
        targetVersion,
        characterId: params.data.characterId,
        packId: body.packId,
        packVersionId: body.packVersionId,
        target: body.target,
        overrideReason: body.overrideReason,
        commandHash: commandHash("APPEND", params.data.assignmentId, body),
      };
      try {
        const outcome = await runMutation(
          db,
          auth,
          body.actionId,
          metadata,
          (tx) => lockCharacter(tx, auth.campaignId, params.data.characterId),
          async (tx) => {
            const assignment = await lockAssignment(
              tx,
              auth.campaignId,
              params.data.characterId,
              params.data.assignmentId,
            );
            if (assignment.packId !== body.packId)
              throw new SpellAssignmentCommandError(
                409,
                "SPELL_ASSIGNMENT_PACK_MISMATCH",
              );
            const current = await latestAssignmentVersion(
              tx,
              auth.campaignId,
              params.data.assignmentId,
            );
            requireExpectedVersion(current, body.expectedVersion);
            if (hasSameState(current, body.packVersionId, body.target))
              throw new SpellAssignmentCommandError(
                422,
                "SPELL_ASSIGNMENT_NO_CHANGE",
              );
            const loaded = await loadActiveSpellGraph(
              tx,
              auth.campaignId,
              body.packId,
              body.packVersionId,
            );
            const snapshot = buildSpellAssignmentSnapshot(
              loaded,
              {
                assignmentId: params.data.assignmentId,
                assignmentVersionId: body.assignmentVersionId,
                assignmentVersion: targetVersion,
              },
              body.target,
            );
            const failures = await evaluateCandidate(
              tx,
              auth.campaignId,
              params.data.characterId,
              snapshot,
              body.overrideReason,
              params.data.assignmentId,
            );
            const [version] = await tx
              .insert(characterSpellAssignmentVersions)
              .values({
                id: body.assignmentVersionId,
                campaignId: auth.campaignId,
                assignmentId: params.data.assignmentId,
                characterId: params.data.characterId,
                packId: body.packId,
                packVersionId: body.packVersionId,
                version: targetVersion,
                kind: snapshot.kind,
                schoolId: snapshot.schoolId,
                nodeId: snapshot.nodeId,
                rank: snapshot.rank,
                snapshot,
                overrideReason: body.overrideReason,
                assignedByMembershipId: auth.membershipId,
              })
              .returning();
            if (!version)
              throw new Error("SPELL_ASSIGNMENT_VERSION_CREATE_FAILED");
            return {
              version,
              audit:
                failures.length > 0
                  ? {
                      previousAssignmentVersionId: current.id,
                      prerequisiteFailures: failures,
                    }
                  : { previousAssignmentVersionId: current.id },
            };
          },
        );
        return sendMutationOutcome(reply, db, auth, metadata, outcome);
      } catch (error) {
        return commandFailure(reply, error);
      }
    },
  );
}
