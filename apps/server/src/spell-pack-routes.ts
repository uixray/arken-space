import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  SPELL_REFERENCE_IMPORT_MAX_SOURCE_CHARS,
  appendSpellPackDraftVersionCommandSchema,
  archiveSpellPackCommandSchema,
  createSpellPackCommandSchema,
  previewSpellReferenceImportCommandSchema,
  spellProgressionGraphSchema,
  transitionSpellPackLifecycleCommandSchema,
  validateSpellPackGraphSchema,
  validateSpellProgressionGraph,
  type SpellGraphValidationIssue,
  type SpellPackLifecycle,
  type SpellPackValidationResponse,
  type SpellPackVersionDto,
  type SpellProgressionGraph,
} from "@arken/contracts";
import { gameEvents, spellPackVersions, spellPacks } from "@arken/db";
import { requireAuth, type AuthContext } from "./auth.js";
import { previewSpellReferenceImport } from "./spell-reference-import.js";
import {
  appendSpellPackVersionInTransaction,
  createSpellPackInTransaction,
  SpellPackStorageError,
  validateSpellGraphSnapshot,
  type SpellPackTransaction,
} from "./spell-pack-storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type SpellPackDb = Database | SpellPackTransaction;
type VersionRow = typeof spellPackVersions.$inferSelect;
type EventRow = typeof gameEvents.$inferSelect;

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

const LIFECYCLE_TRANSITIONS: Readonly<
  Record<SpellPackLifecycle, readonly SpellPackLifecycle[]>
> = {
  DRAFT: ["REFERENCE", "ACTIVE"],
  REFERENCE: ["ACTIVE"],
  ACTIVE: [],
  ARCHIVED: [],
};

class SpellPackCommandError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "SpellPackCommandError";
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

function commandHash(type: string, packId: string, body: unknown): string {
  return createHash("sha256")
    .update(canonicalJson({ type, packId, body }))
    .digest("hex");
}

interface ActionMetadata {
  type: string;
  packId: string;
  targetVersionId: string;
  targetVersion: number;
  lifecycle: SpellPackLifecycle;
  expectedVersion: number;
  commandHash: string;
}

interface ActionPayload {
  commandHash?: unknown;
  targetVersionId?: unknown;
  targetVersion?: unknown;
  lifecycle?: unknown;
  expectedVersion?: unknown;
}

function actionPayload(metadata: ActionMetadata) {
  return {
    commandHash: metadata.commandHash,
    targetVersionId: metadata.targetVersionId,
    targetVersion: metadata.targetVersion,
    lifecycle: metadata.lifecycle,
    expectedVersion: metadata.expectedVersion,
  };
}

async function findAction(
  db: SpellPackDb,
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
  return (
    event.membershipId === auth.membershipId &&
    event.type === metadata.type &&
    event.entityType === "SPELL_PACK" &&
    event.entityId === metadata.packId &&
    event.entityRevision === metadata.targetVersion &&
    payload?.commandHash === metadata.commandHash &&
    payload.targetVersionId === metadata.targetVersionId &&
    payload.targetVersion === metadata.targetVersion &&
    payload.lifecycle === metadata.lifecycle &&
    payload.expectedVersion === metadata.expectedVersion
  );
}

type ActionState =
  { kind: "MISS" } | { kind: "REPLAY"; event: EventRow } | { kind: "CONFLICT" };

async function classifyAction(
  db: SpellPackDb,
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
      entityType: "SPELL_PACK",
      entityId: metadata.packId,
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
    throw new Error("SPELL_PACK_ACTION_CLAIM_FAILED");
  return classified;
}

type MutationValue<T> = { value: T; audit?: Record<string, unknown> };
type MutationOutcome<T> =
  | { kind: "RESULT"; value: T }
  | { kind: "REPLAY"; event: EventRow }
  | { kind: "CONFLICT" };

async function runMutation<T>(
  db: Database,
  auth: AuthContext,
  actionId: string,
  metadata: ActionMetadata,
  mutate: (tx: SpellPackTransaction) => Promise<MutationValue<T>>,
): Promise<MutationOutcome<T>> {
  const preflight = await classifyAction(db, auth, actionId, metadata);
  if (preflight.kind !== "MISS") return preflight;

  return db.transaction(async (tx) => {
    const claimed = await claimAction(tx, auth, actionId, metadata);
    if (claimed.kind !== "CLAIMED") return claimed;

    const result = await mutate(tx);
    if (result.audit)
      await tx
        .update(gameEvents)
        .set({ payload: { ...actionPayload(metadata), ...result.audit } })
        .where(eq(gameEvents.sequence, claimed.event.sequence));
    return { kind: "RESULT" as const, value: result.value };
  });
}

function versionDto(
  row: VersionRow & { graph: SpellProgressionGraph },
  warnings: SpellGraphValidationIssue[],
): SpellPackVersionDto {
  return {
    packId: row.packId,
    versionId: row.id,
    version: row.version,
    lifecycle: row.lifecycle,
    graph: row.graph,
    warnings,
    createdAt: row.createdAt.toISOString(),
  };
}

function validatedVersion(row: VersionRow) {
  const validated = validateSpellGraphSnapshot(row.graph);
  return {
    row: { ...row, graph: validated.graph },
    warnings: validated.warnings,
  };
}

async function versionForReplay(
  db: Database,
  campaignId: string,
  packId: string,
  event: EventRow,
) {
  const payload = event.payload as ActionPayload | null;
  if (typeof payload?.targetVersionId !== "string") return null;
  const [row] = await db
    .select()
    .from(spellPackVersions)
    .where(
      and(
        eq(spellPackVersions.campaignId, campaignId),
        eq(spellPackVersions.packId, packId),
        eq(spellPackVersions.id, payload.targetVersionId),
      ),
    )
    .limit(1);
  return row ? validatedVersion(row) : null;
}

async function lockedLatestVersion(
  tx: SpellPackTransaction,
  campaignId: string,
  packId: string,
) {
  const [pack] = await tx
    .select({ id: spellPacks.id })
    .from(spellPacks)
    .where(
      and(eq(spellPacks.campaignId, campaignId), eq(spellPacks.id, packId)),
    )
    .limit(1)
    .for("update");
  if (!pack) throw new SpellPackCommandError(404, "SPELL_PACK_NOT_FOUND");

  const [version] = await tx
    .select()
    .from(spellPackVersions)
    .where(
      and(
        eq(spellPackVersions.campaignId, campaignId),
        eq(spellPackVersions.packId, packId),
      ),
    )
    .orderBy(desc(spellPackVersions.version))
    .limit(1);
  if (!version) throw new Error("SPELL_PACK_LATEST_VERSION_MISSING");
  return validatedVersion(version);
}

function requireExpectedVersion(
  current: VersionRow,
  expectedVersion: number,
): void {
  if (current.version !== expectedVersion)
    throw new SpellPackCommandError(409, "SPELL_PACK_VERSION_CONFLICT", {
      expectedVersion,
      actualVersion: current.version,
    });
}

function cloneGraphVersion(
  graph: SpellProgressionGraph,
  versionId: string,
  version: number,
  lifecycle: SpellPackLifecycle,
): SpellProgressionGraph {
  return {
    ...graph,
    versionId,
    version,
    lifecycle,
    schools: graph.schools.map((school) => ({
      ...school,
      packVersionId: versionId,
    })),
    nodes: graph.nodes.map((node) => ({
      ...node,
      packVersionId: versionId,
      lifecycle: node.lifecycle === "ARCHIVED" ? "ARCHIVED" : lifecycle,
    })),
    requirementGroups: graph.requirementGroups.map((group) => ({
      ...group,
      packVersionId: versionId,
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      packVersionId: versionId,
    })),
  };
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
  if (error instanceof SpellPackCommandError)
    return fail(reply, error.status, error.code, error.details);
  if (error instanceof SpellPackStorageError) {
    switch (error.code) {
      case "SPELL_GRAPH_SCHEMA_INVALID":
      case "SPELL_GRAPH_SEMANTIC_INVALID":
      case "SPELL_PACK_INITIAL_VERSION_REQUIRED":
        return fail(reply, 422, error.code, error.details);
      case "SPELL_PACK_NOT_FOUND":
        return fail(reply, 404, error.code);
      case "SPELL_PACK_VERSION_CONFLICT":
      case "SPELL_PACK_VERSION_SEQUENCE_INVALID":
        return fail(reply, 409, error.code, error.details);
    }
  }
  if (isPostgresUniqueViolation(error))
    return fail(reply, 409, "SPELL_PACK_CONFLICT");
  throw error;
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

async function sendMutationOutcome<
  T extends {
    version: VersionRow & { graph: SpellProgressionGraph };
    warnings: SpellGraphValidationIssue[];
  },
>(
  reply: FastifyReply,
  db: Database,
  auth: AuthContext,
  metadata: ActionMetadata,
  outcome: MutationOutcome<T>,
) {
  if (outcome.kind === "CONFLICT")
    return fail(reply, 409, "ACTION_ID_CONFLICT");
  if (outcome.kind === "REPLAY") {
    const saved = await versionForReplay(
      db,
      auth.campaignId,
      metadata.packId,
      outcome.event,
    );
    return saved
      ? reply.code(200).send(versionDto(saved.row, saved.warnings))
      : fail(reply, 500, "SPELL_PACK_REPLAY_PROJECTION_FAILED");
  }
  return reply
    .code(201)
    .send(versionDto(outcome.value.version, outcome.value.warnings));
}

export function registerSpellPackRoutes(app: FastifyInstance, db: Database) {
  // The editor discovers only a small campaign-scoped window. Never expose
  // database rows directly: the list is a deliberately narrow summary DTO.
  app.get("/api/spell-packs", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const auth = await requireGm(request, reply, db);
    if (!auth) return;
    const packs = await db
      .select({ id: spellPacks.id, createdAt: spellPacks.createdAt })
      .from(spellPacks)
      .where(eq(spellPacks.campaignId, auth.campaignId))
      .orderBy(desc(spellPacks.createdAt))
      .limit(100);
    const summaries = await Promise.all(
      packs.map(async (pack) => {
        const [latest] = await db
          .select()
          .from(spellPackVersions)
          .where(
            and(
              eq(spellPackVersions.campaignId, auth.campaignId),
              eq(spellPackVersions.packId, pack.id),
            ),
          )
          .orderBy(desc(spellPackVersions.version))
          .limit(1);
        if (!latest) return null;
        const validated = validatedVersion(latest);
        return {
          id: pack.id,
          latestVersionId: latest.id,
          latestVersion: latest.version,
          lifecycle: latest.lifecycle,
          title: validated.row.graph.title,
          createdAt: pack.createdAt.toISOString(),
        };
      }),
    );
    return reply.send({ packs: summaries.filter((item) => item !== null) });
  });

  // Assignment discovers one immutable ACTIVE version at a time so an older
  // active version remains selectable even when a newer draft is latest.
  // The cursor advances by version identity; player-facing routes never use
  // this GM-only graph summary.
  app.get("/api/spell-assignable-schools", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const auth = await requireGm(request, reply, db);
    if (!auth) return;
    const query = z
      .object({ afterVersionId: z.string().uuid().optional() })
      .strict()
      .safeParse(request.query);
    if (!query.success) return fail(reply, 400, "INVALID_REQUEST");
    const conditions = [
      eq(spellPackVersions.campaignId, auth.campaignId),
      eq(spellPackVersions.lifecycle, "ACTIVE"),
    ];
    if (query.data.afterVersionId)
      conditions.push(gt(spellPackVersions.id, query.data.afterVersionId));
    const rows = await db
      .select()
      .from(spellPackVersions)
      .where(and(...conditions))
      .orderBy(asc(spellPackVersions.id))
      .limit(2);
    const row = rows[0];
    if (!row) return reply.send({ schools: [], nextCursor: null });
    const graph = validatedVersion(row).row.graph;
    const [pack] = await db
      .select({ id: spellPacks.id })
      .from(spellPacks)
      .where(
        and(
          eq(spellPacks.id, row.packId),
          eq(spellPacks.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!pack) return fail(reply, 404, "SPELL_PACK_VERSION_NOT_FOUND");
    return reply.send({
      schools: graph.schools
        .map((school) => ({
          packId: row.packId,
          packVersionId: row.id,
          packVersion: row.version,
          packTitle: graph.title,
          schoolId: school.id,
          schoolName: school.displayName,
          visibilityPolicy: school.visibilityPolicy,
        }))
        .sort(
          (left, right) =>
            left.schoolName.localeCompare(right.schoolName) ||
            left.schoolId.localeCompare(right.schoolId),
        ),
      nextCursor: rows.length > 1 ? row.id : null,
    });
  });

  app.get(
    "/api/spell-packs/:id/versions/:versionId",
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireGm(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ id: z.string().uuid(), versionId: z.string().uuid() })
        .strict()
        .safeParse(request.params);
      if (!params.success) return fail(reply, 400, "INVALID_REQUEST");
      const [row] = await db
        .select()
        .from(spellPackVersions)
        .where(
          and(
            eq(spellPackVersions.campaignId, auth.campaignId),
            eq(spellPackVersions.packId, params.data.id),
            eq(spellPackVersions.id, params.data.versionId),
          ),
        )
        .limit(1);
      if (!row) return fail(reply, 404, "SPELL_PACK_VERSION_NOT_FOUND");
      const validated = validatedVersion(row);
      return reply.send(versionDto(validated.row, validated.warnings));
    },
  );

  app.post(
    "/api/spell-packs/imports/reference/preview",
    { bodyLimit: SPELL_REFERENCE_IMPORT_MAX_SOURCE_CHARS * 4 },
    async (request, reply) => {
      const auth = await requireGm(request, reply, db);
      if (!auth) return;
      const parsed = previewSpellReferenceImportCommandSchema.safeParse(
        request.body,
      );
      if (!parsed.success) return fail(reply, 400, "INVALID_REQUEST");
      return reply
        .header("Cache-Control", "private, no-store")
        .send(previewSpellReferenceImport(parsed.data));
    },
  );

  app.post("/api/spell-packs/validate", async (request, reply) => {
    const auth = await requireGm(request, reply, db);
    if (!auth) return;
    const envelope = validateSpellPackGraphSchema.safeParse(request.body);
    if (!envelope.success) return fail(reply, 400, "INVALID_REQUEST");

    const parsed = spellProgressionGraphSchema.safeParse(envelope.data.graph);
    if (!parsed.success) {
      const response: SpellPackValidationResponse = {
        valid: false,
        errors: parsed.error.issues.map((issue) => ({
          code: "SCHEMA_INVALID",
          path: issue.path.map(String).join(".") || "$",
          message: issue.message,
        })),
        warnings: [],
      };
      return reply.send(response);
    }

    const validation = validateSpellProgressionGraph(parsed.data);
    const response: SpellPackValidationResponse = {
      valid: validation.errors.length === 0,
      errors: validation.errors,
      warnings: validation.warnings,
    };
    return reply.send(response);
  });

  app.post("/api/spell-packs", async (request, reply) => {
    const auth = await requireGm(request, reply, db);
    if (!auth) return;
    const parsed = createSpellPackCommandSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "INVALID_REQUEST");
    const body = parsed.data;
    if (
      body.graph.lifecycle !== "DRAFT" &&
      body.graph.lifecycle !== "REFERENCE"
    )
      return fail(reply, 422, "SPELL_PACK_INITIAL_LIFECYCLE_INVALID");

    const metadata: ActionMetadata = {
      type: "spell_pack.created",
      packId: body.graph.packId,
      targetVersionId: body.graph.versionId,
      targetVersion: body.graph.version,
      lifecycle: body.graph.lifecycle,
      expectedVersion: body.expectedVersion,
      commandHash: commandHash("spell_pack.created", body.graph.packId, body),
    };
    try {
      const outcome = await runMutation(
        db,
        auth,
        body.actionId,
        metadata,
        async (tx) => ({
          value: await createSpellPackInTransaction(tx, {
            campaignId: auth.campaignId,
            graph: body.graph,
          }),
        }),
      );
      return sendMutationOutcome(reply, db, auth, metadata, outcome);
    } catch (error) {
      return commandFailure(reply, error);
    }
  });

  app.post("/api/spell-packs/:id/versions", async (request, reply) => {
    const auth = await requireGm(request, reply, db);
    if (!auth) return;
    const params = idParamsSchema.safeParse(request.params);
    const parsed = appendSpellPackDraftVersionCommandSchema.safeParse(
      request.body,
    );
    if (!params.success || !parsed.success)
      return fail(reply, 400, "INVALID_REQUEST");
    const body = parsed.data;
    if (body.graph.packId !== params.data.id)
      return fail(reply, 400, "SPELL_PACK_ID_MISMATCH");
    if (body.graph.lifecycle !== "DRAFT")
      return fail(reply, 422, "SPELL_PACK_DRAFT_VERSION_REQUIRED");
    if (body.graph.version !== body.expectedVersion + 1)
      return fail(reply, 409, "SPELL_PACK_VERSION_SEQUENCE_INVALID", {
        expectedVersion: body.expectedVersion + 1,
        actualVersion: body.graph.version,
      });

    const metadata: ActionMetadata = {
      type: "spell_pack.version_created",
      packId: params.data.id,
      targetVersionId: body.graph.versionId,
      targetVersion: body.graph.version,
      lifecycle: body.graph.lifecycle,
      expectedVersion: body.expectedVersion,
      commandHash: commandHash(
        "spell_pack.version_created",
        params.data.id,
        body,
      ),
    };
    try {
      const outcome = await runMutation(
        db,
        auth,
        body.actionId,
        metadata,
        async (tx) => {
          const current = await lockedLatestVersion(
            tx,
            auth.campaignId,
            params.data.id,
          );
          requireExpectedVersion(current.row, body.expectedVersion);
          if (current.row.lifecycle === "ARCHIVED")
            throw new SpellPackCommandError(
              422,
              "SPELL_PACK_INVALID_LIFECYCLE_TRANSITION",
            );
          return {
            value: await appendSpellPackVersionInTransaction(tx, {
              campaignId: auth.campaignId,
              expectedVersion: body.expectedVersion,
              graph: body.graph,
            }),
            audit: {
              previousVersionId: current.row.id,
              previousLifecycle: current.row.lifecycle,
            },
          };
        },
      );
      return sendMutationOutcome(reply, db, auth, metadata, outcome);
    } catch (error) {
      return commandFailure(reply, error);
    }
  });

  app.post("/api/spell-packs/:id/lifecycle", async (request, reply) => {
    const auth = await requireGm(request, reply, db);
    if (!auth) return;
    const params = idParamsSchema.safeParse(request.params);
    const parsed = transitionSpellPackLifecycleCommandSchema.safeParse(
      request.body,
    );
    if (!params.success || !parsed.success)
      return fail(reply, 400, "INVALID_REQUEST");
    const body = parsed.data;
    const targetVersion = body.expectedVersion + 1;
    const metadata: ActionMetadata = {
      type: "spell_pack.lifecycle_changed",
      packId: params.data.id,
      targetVersionId: body.versionId,
      targetVersion,
      lifecycle: body.lifecycle,
      expectedVersion: body.expectedVersion,
      commandHash: commandHash(
        "spell_pack.lifecycle_changed",
        params.data.id,
        body,
      ),
    };
    try {
      const outcome = await runMutation(
        db,
        auth,
        body.actionId,
        metadata,
        async (tx) => {
          const current = await lockedLatestVersion(
            tx,
            auth.campaignId,
            params.data.id,
          );
          requireExpectedVersion(current.row, body.expectedVersion);
          if (
            !LIFECYCLE_TRANSITIONS[current.row.lifecycle].includes(
              body.lifecycle,
            )
          )
            throw new SpellPackCommandError(
              422,
              "SPELL_PACK_INVALID_LIFECYCLE_TRANSITION",
            );
          const graph = cloneGraphVersion(
            current.row.graph,
            body.versionId,
            targetVersion,
            body.lifecycle,
          );
          return {
            value: await appendSpellPackVersionInTransaction(tx, {
              campaignId: auth.campaignId,
              expectedVersion: body.expectedVersion,
              graph,
            }),
            audit: {
              previousVersionId: current.row.id,
              previousLifecycle: current.row.lifecycle,
            },
          };
        },
      );
      return sendMutationOutcome(reply, db, auth, metadata, outcome);
    } catch (error) {
      return commandFailure(reply, error);
    }
  });

  app.post("/api/spell-packs/:id/archive", async (request, reply) => {
    const auth = await requireGm(request, reply, db);
    if (!auth) return;
    const params = idParamsSchema.safeParse(request.params);
    const parsed = archiveSpellPackCommandSchema.safeParse(request.body);
    if (!params.success || !parsed.success)
      return fail(reply, 400, "INVALID_REQUEST");
    const body = parsed.data;
    const targetVersion = body.expectedVersion + 1;
    const metadata: ActionMetadata = {
      type: "spell_pack.archived",
      packId: params.data.id,
      targetVersionId: body.versionId,
      targetVersion,
      lifecycle: "ARCHIVED",
      expectedVersion: body.expectedVersion,
      commandHash: commandHash("spell_pack.archived", params.data.id, body),
    };
    try {
      const outcome = await runMutation(
        db,
        auth,
        body.actionId,
        metadata,
        async (tx) => {
          const current = await lockedLatestVersion(
            tx,
            auth.campaignId,
            params.data.id,
          );
          requireExpectedVersion(current.row, body.expectedVersion);
          if (current.row.lifecycle === "ARCHIVED")
            throw new SpellPackCommandError(
              422,
              "SPELL_PACK_INVALID_LIFECYCLE_TRANSITION",
            );
          const graph = cloneGraphVersion(
            current.row.graph,
            body.versionId,
            targetVersion,
            "ARCHIVED",
          );
          return {
            value: await appendSpellPackVersionInTransaction(tx, {
              campaignId: auth.campaignId,
              expectedVersion: body.expectedVersion,
              graph,
            }),
            audit: {
              previousVersionId: current.row.id,
              previousLifecycle: current.row.lifecycle,
            },
          };
        },
      );
      return sendMutationOutcome(reply, db, auth, metadata, outcome);
    } catch (error) {
      return commandFailure(reply, error);
    }
  });
}
