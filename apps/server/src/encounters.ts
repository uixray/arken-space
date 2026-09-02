import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import {
  startEncounterSchema,
  endEncounterSchema,
  encounterPreflightQuerySchema,
  type EncounterDto,
  type EncounterPreflightResponse,
} from "@arken/contracts";
import {
  campaigns,
  encounters,
  gameEvents,
  memberships,
  scenes,
  tokenControllers,
  tokenDefinitions,
  tokens,
  worldMapLocationScenes,
} from "@arken/db";
import type { AuthContext } from "./auth.js";
import { requireAuth } from "./auth.js";
import { recruitFromBattleZone } from "./battle-initiative.js";
import { rechargeCampaignCatalogEntries } from "./campaign-clock.js";
import { transferRelativePosition } from "./encounter-transform.js";

/**
 * UIX-311 Stage 1: encounter data model + atomic server commands.
 *
 * Mirrors the actionId/findAction idempotency + revision-CAS conventions of
 * ./player-requests.ts (commandHash-verified replay) and the scene
 * activation handler in ./routes.ts (POST /api/scenes/activate).
 *
 * No client UI in this stage — routes exist so the atomic transaction logic
 * is independently reachable/testable; Stage 4 wires a GM-facing UI to them.
 */

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type EncounterDb = Database | Transaction;
type EncounterRow = typeof encounters.$inferSelect;
/** Broadcasts one coherent game:snapshot to every connected campaign socket. */
type Broadcast = (campaignId: string) => Promise<void>;

function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    if (typeof candidate !== "object" || candidate === null) continue;
    if (
      !("code" in candidate) ||
      (candidate as { code?: unknown }).code !== "23505"
    )
      continue;
    const name =
      ("constraint_name" in candidate &&
        (candidate as { constraint_name?: unknown }).constraint_name) ||
      ("constraint" in candidate &&
        (candidate as { constraint?: unknown }).constraint);
    if (name === constraint) return true;
  }
  return false;
}

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};
const commandHash = (type: string, entityId: string | null, body: unknown) =>
  createHash("sha256")
    .update(canonicalJson({ type, entityId, body }))
    .digest("hex");

async function replay(
  db: EncounterDb,
  auth: AuthContext,
  actionId: string,
  type: string,
  entityId: string | null,
  hash: string,
) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, auth.campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  if (!event) return { kind: "MISS" as const };
  const payload = event.payload as { commandHash?: unknown } | null;
  if (
    event.membershipId !== auth.membershipId ||
    event.type !== type ||
    event.entityType !== "ENCOUNTER" ||
    (entityId !== null && event.entityId !== entityId) ||
    payload?.commandHash !== hash
  )
    return { kind: "CONFLICT" as const };
  return { kind: "MATCH" as const, entityId: event.entityId! };
}
async function record(
  tx: Transaction,
  auth: AuthContext,
  actionId: string,
  type: string,
  id: string,
  revision: number,
  hash: string,
  details: Record<string, unknown> = {},
) {
  const [event] = await tx
    .insert(gameEvents)
    .values({
      campaignId: auth.campaignId,
      membershipId: auth.membershipId,
      actionId,
      type,
      entityType: "ENCOUNTER",
      entityId: id,
      entityRevision: revision,
      payload: { commandHash: hash, ...details },
    })
    .returning();
  if (!event) throw new Error("EVENT_RECORD_FAILED");
  return event;
}

export function encounterDto(row: EncounterRow): EncounterDto {
  return {
    id: row.id,
    campaignId: row.campaignId,
    sequence: row.sequence,
    status: row.status,
    mode: row.mode,
    sourceSceneId: row.sourceSceneId,
    targetSceneId: row.targetSceneId,
    focusRegion: row.focusRegion,
    locationId: row.locationId,
    sourceSceneRevision: row.sourceSceneRevision,
    initiatorMembershipId: row.initiatorMembershipId,
    revision: row.revision,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    endedByMembershipId: row.endedByMembershipId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listEncounters(
  db: EncounterDb,
  campaignId: string,
): Promise<EncounterDto[]> {
  const rows = await db
    .select()
    .from(encounters)
    .where(eq(encounters.campaignId, campaignId))
    .orderBy(asc(encounters.sequence));
  return rows.map(encounterDto);
}

async function findActiveEncounter(db: EncounterDb, campaignId: string) {
  const [row] = await db
    .select()
    .from(encounters)
    .where(
      and(
        eq(encounters.campaignId, campaignId),
        eq(encounters.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findEncounterById(
  db: EncounterDb,
  campaignId: string,
  id: string,
) {
  const [row] = await db
    .select()
    .from(encounters)
    .where(and(eq(encounters.campaignId, campaignId), eq(encounters.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * UIX-311 Stage 3 preflight: which campaign party (PLAYER-role) members
 * currently lack a controlled PLAYER-layer token on `targetSceneId`.
 *
 * Reuses the same "who controls a token" join used to build TokenDto.
 * controllerMembershipIds elsewhere (see snapshot.ts's tokens/tokenControllers
 * join and realtime.ts's tokenDto) rather than inventing a new notion of
 * control — a membership "has a token" on the destination scene only if it
 * is listed in token_controllers for a token_definition backing a token
 * that's actually placed there. Only the PLAYER layer is considered because
 * that's the layer LINKED_SCENE auto-transfers (see the ENCOUNTER_STARTED
 * transaction above); MAP/GM-layer tokens are scenery/GM markers, not party
 * members, and never factor into "is the party accounted for".
 */
export async function computeMissingTokenMembers(
  db: EncounterDb,
  campaignId: string,
  targetSceneId: string,
): Promise<string[]> {
  const partyMembers = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.campaignId, campaignId),
        eq(memberships.role, "PLAYER"),
      ),
    );
  if (!partyMembers.length) return [];

  const controllerRows = await db
    .select({ membershipId: tokenControllers.membershipId })
    .from(tokenControllers)
    .innerJoin(
      tokenDefinitions,
      eq(tokenControllers.tokenDefinitionId, tokenDefinitions.id),
    )
    .innerJoin(tokens, eq(tokens.definitionId, tokenDefinitions.id))
    .where(and(eq(tokens.sceneId, targetSceneId), eq(tokens.layer, "PLAYER")));

  const controlledMembershipIds = new Set(
    controllerRows.map((row) => row.membershipId),
  );
  return partyMembers
    .map((member) => member.id)
    .filter((id) => !controlledMembershipIds.has(id));
}

export function registerEncounterRoutes(
  app: FastifyInstance,
  db: Database,
  broadcastSnapshots: Broadcast,
) {
  app.post("/api/encounters/start", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const parsed = startEncounterSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "INVALID_REQUEST");
    const body = parsed.data;
    const hash = commandHash("ENCOUNTER_STARTED", null, body);
    const prior = await replay(
      db,
      auth,
      body.actionId,
      "ENCOUNTER_STARTED",
      null,
      hash,
    );
    if (prior.kind === "CONFLICT")
      return fail(reply, 409, "ACTION_ID_CONFLICT");
    if (prior.kind === "MATCH") {
      const row = await findEncounterById(db, auth.campaignId, prior.entityId);
      return row
        ? reply.code(200).send(encounterDto(row))
        : fail(reply, 500, "ENCOUNTER_PROJECTION_FAILED");
    }

    if (await findActiveEncounter(db, auth.campaignId))
      return fail(reply, 409, "ENCOUNTER_ALREADY_ACTIVE");

    const [campaign] = await db
      .select({
        activeSceneId: campaigns.activeSceneId,
        battleActive: campaigns.battleActive,
        battleCounter: campaigns.battleCounter,
        battleZone: campaigns.battleZone,
        initiative: campaigns.initiative,
        revision: campaigns.revision,
      })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!campaign) return fail(reply, 404, "CAMPAIGN_NOT_FOUND");

    const [sourceScene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.campaignId, auth.campaignId),
          eq(scenes.id, body.sourceSceneId),
        ),
      )
      .limit(1);
    if (!sourceScene) return fail(reply, 404, "SOURCE_SCENE_NOT_FOUND");
    if (sourceScene.revision !== body.sourceSceneRevision)
      return fail(reply, 409, "SOURCE_SCENE_REVISION_CONFLICT");

    if (body.mode === "SCENE_REGION") {
      if (campaign.activeSceneId !== sourceScene.id)
        return fail(reply, 409, "SOURCE_SCENE_NOT_ACTIVE");
      const region = body.focusRegion!;
      const withinBounds =
        region.x >= 0 &&
        region.y >= 0 &&
        region.width > 0 &&
        region.height > 0 &&
        region.x + region.width <= sourceScene.width &&
        region.y + region.height <= sourceScene.height;
      if (!withinBounds) return fail(reply, 400, "REGION_OUT_OF_BOUNDS");
    }

    let targetScene = sourceScene;
    if (body.mode === "LINKED_SCENE") {
      const [destination] = await db
        .select()
        .from(scenes)
        .where(
          and(
            eq(scenes.campaignId, auth.campaignId),
            eq(scenes.id, body.targetSceneId!),
          ),
        )
        .limit(1);
      if (!destination) return fail(reply, 404, "TARGET_SCENE_NOT_FOUND");
      if (body.locationId) {
        const [link] = await db
          .select()
          .from(worldMapLocationScenes)
          .where(
            and(
              eq(worldMapLocationScenes.campaignId, auth.campaignId),
              eq(worldMapLocationScenes.locationId, body.locationId),
              eq(worldMapLocationScenes.sceneId, destination.id),
            ),
          )
          .limit(1);
        if (!link) return fail(reply, 404, "INVALID_LOCATION_SCENE_LINK");
      }
      targetScene = destination;
    }

    const startsBattle = !campaign.battleActive;
    const resetRoster = campaign.initiative.map((participant) => ({
      ...participant,
      initiative: null,
    }));
    const recruited =
      startsBattle && campaign.battleZone
        ? await recruitFromBattleZone(
            db,
            auth.campaignId,
            campaign.battleZone,
            resetRoster,
          )
        : null;
    if (startsBattle && campaign.battleZone && !recruited)
      return fail(reply, 409, "BATTLE_ZONE_SCENE_MISSING");
    const nextInitiative = startsBattle
      ? (recruited ?? resetRoster)
      : campaign.initiative;

    let created: EncounterRow;
    try {
      created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(encounters)
          .values({
            campaignId: auth.campaignId,
            status: "ACTIVE",
            mode: body.mode,
            sourceSceneId: sourceScene.id,
            targetSceneId: targetScene.id,
            focusRegion: body.mode === "SCENE_REGION" ? body.focusRegion : null,
            locationId:
              body.mode === "LINKED_SCENE" ? (body.locationId ?? null) : null,
            sourceSceneRevision: body.sourceSceneRevision,
            initiatorMembershipId: auth.membershipId,
          })
          .returning();
        if (!row) throw new Error("ENCOUNTER_CREATE_FAILED");

        const nextBattleCounter =
          campaign.battleCounter + (campaign.battleActive ? 0 : 1);
        const [updatedCampaign] = await tx
          .update(campaigns)
          .set({
            activeSceneId:
              body.mode === "LINKED_SCENE"
                ? targetScene.id
                : campaign.activeSceneId,
            battleActive: true,
            battleCounter: nextBattleCounter,
            initiative: nextInitiative,
            revision: campaign.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaigns.id, auth.campaignId),
              eq(campaigns.revision, campaign.revision),
            ),
          )
          .returning({ revision: campaigns.revision });
        if (!updatedCampaign) throw new Error("CAMPAIGN_CONFLICT");

        if (body.mode === "LINKED_SCENE") {
          // Only PLAYER-layer tokens (participants) auto-transfer; MAP/GM
          // layer tokens (scenery, GM markers) stay put on the source scene.
          const participantTokens = await tx
            .select()
            .from(tokens)
            .where(
              and(
                eq(tokens.sceneId, sourceScene.id),
                eq(tokens.layer, "PLAYER"),
              ),
            );
          for (const token of participantTokens) {
            const position = transferRelativePosition(
              { width: sourceScene.width, height: sourceScene.height },
              { width: targetScene.width, height: targetScene.height },
              { x: token.x, y: token.y },
            );
            const [moved] = await tx
              .update(tokens)
              .set({
                sceneId: targetScene.id,
                x: position.x,
                y: position.y,
                revision: token.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(tokens.id, token.id),
                  eq(tokens.revision, token.revision),
                ),
              )
              .returning({ id: tokens.id });
            if (!moved) throw new Error("TOKEN_TRANSFER_CONFLICT");
          }
        }

        await record(
          tx,
          auth,
          body.actionId,
          "ENCOUNTER_STARTED",
          row.id,
          row.revision,
          hash,
          {
            clockBefore: {
              battleActive: campaign.battleActive,
              battleCounter: campaign.battleCounter,
              revision: campaign.revision,
            },
            clockAfter: {
              battleActive: true,
              battleCounter: nextBattleCounter,
              revision: updatedCampaign.revision,
            },
            transitionApplied: !campaign.battleActive,
            recharged: 0,
            initiativeBefore: campaign.initiative.length,
            initiativeAfter: nextInitiative.length,
          },
        );
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error, "encounters_campaign_active_idx")) {
        const raced = await replay(
          db,
          auth,
          body.actionId,
          "ENCOUNTER_STARTED",
          null,
          hash,
        );
        if (raced.kind === "CONFLICT")
          return fail(reply, 409, "ACTION_ID_CONFLICT");
        if (raced.kind === "MATCH") {
          const row = await findEncounterById(
            db,
            auth.campaignId,
            raced.entityId,
          );
          return row
            ? reply.code(200).send(encounterDto(row))
            : fail(reply, 500, "ENCOUNTER_PROJECTION_FAILED");
        }
        return fail(reply, 409, "ENCOUNTER_ALREADY_ACTIVE");
      }
      if (
        error instanceof Error &&
        (error.message === "TOKEN_TRANSFER_CONFLICT" ||
          error.message === "CAMPAIGN_CONFLICT")
      )
        return fail(reply, 409, error.message);
      throw error;
    }

    await broadcastSnapshots(auth.campaignId);
    return reply.code(201).send(encounterDto(created));
  });

  app.post("/api/encounters/:id/end", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const id = (request.params as { id?: string }).id;
    if (!id) return fail(reply, 404, "NOT_FOUND");
    const parsed = endEncounterSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "INVALID_REQUEST");
    const body = parsed.data;
    const hash = commandHash("ENCOUNTER_ENDED", id, body);
    const prior = await replay(
      db,
      auth,
      body.actionId,
      "ENCOUNTER_ENDED",
      id,
      hash,
    );
    if (prior.kind === "CONFLICT")
      return fail(reply, 409, "ACTION_ID_CONFLICT");
    if (prior.kind === "MATCH") {
      const row = await findEncounterById(db, auth.campaignId, id);
      return row
        ? encounterDto(row)
        : fail(reply, 500, "ENCOUNTER_PROJECTION_FAILED");
    }

    const existing = await findEncounterById(db, auth.campaignId, id);
    if (!existing) return fail(reply, 404, "ENCOUNTER_NOT_FOUND");
    if (existing.status !== "ACTIVE")
      return fail(reply, 409, "ENCOUNTER_NOT_ACTIVE");
    if (existing.revision !== body.revision)
      return fail(reply, 409, "REVISION_CONFLICT");

    const [campaign] = await db
      .select({
        day: campaigns.day,
        battleActive: campaigns.battleActive,
        battleCounter: campaigns.battleCounter,
        initiative: campaigns.initiative,
        revision: campaigns.revision,
      })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!campaign) return fail(reply, 404, "CAMPAIGN_NOT_FOUND");

    // Camera/scene return remains client-driven. The durable encounter and
    // campaign clock, however, are one lifecycle and commit together.
    let result;
    try {
      result = await db.transaction(async (tx) => {
        const [updatedCampaign] = await tx
          .update(campaigns)
          .set({
            battleActive: false,
            initiative: [],
            revision: campaign.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaigns.id, auth.campaignId),
              eq(campaigns.revision, campaign.revision),
            ),
          )
          .returning({ revision: campaigns.revision });
        if (!updatedCampaign) throw new Error("CAMPAIGN_CONFLICT");

        const [row] = await tx
          .update(encounters)
          .set({
            status: "ENDED",
            endedAt: new Date(),
            endedByMembershipId: auth.membershipId,
            revision: existing.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(encounters.id, id),
              eq(encounters.campaignId, auth.campaignId),
              eq(encounters.revision, existing.revision),
            ),
          )
          .returning();
        if (!row) throw new Error("REVISION_CONFLICT");
        const recharged = campaign.battleActive
          ? await rechargeCampaignCatalogEntries(tx, auth.campaignId, {
              trigger: "END_BATTLE",
              day: campaign.day,
              battleCounter: campaign.battleCounter,
            })
          : 0;
        await record(
          tx,
          auth,
          body.actionId,
          "ENCOUNTER_ENDED",
          id,
          row.revision,
          hash,
          {
            clockBefore: {
              battleActive: campaign.battleActive,
              battleCounter: campaign.battleCounter,
              revision: campaign.revision,
            },
            clockAfter: {
              battleActive: false,
              battleCounter: campaign.battleCounter,
              revision: updatedCampaign.revision,
            },
            transitionApplied: campaign.battleActive,
            recharged,
            initiativeBefore: campaign.initiative.length,
            initiativeAfter: 0,
          },
        );
        return { row, recharged };
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "CAMPAIGN_CONFLICT" ||
          error.message === "REVISION_CONFLICT" ||
          error.message === "ENTRY_CONFLICT")
      )
        return fail(reply, 409, error.message);
      throw error;
    }

    await broadcastSnapshots(auth.campaignId);
    return reply.send(encounterDto(result.row));
  });

  app.get("/api/encounters", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    return reply.send(await listEncounters(db, auth.campaignId));
  });

  // UIX-311 Stage 3: LINKED_SCENE preflight — GM-only warning surface, no
  // state mutation. Re-validates campaign ownership of the candidate target
  // scene (and, if provided, the location-to-scene link) the same way
  // POST /api/encounters/start does, so a GM previewing a scene picker never
  // learns anything about a scene/location it can't actually target.
  app.get("/api/encounters/preflight", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const parsed = encounterPreflightQuerySchema.safeParse(request.query);
    if (!parsed.success) return fail(reply, 400, "INVALID_REQUEST");
    const { targetSceneId, locationId } = parsed.data;

    const [targetScene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(
        and(
          eq(scenes.campaignId, auth.campaignId),
          eq(scenes.id, targetSceneId),
        ),
      )
      .limit(1);
    if (!targetScene) return fail(reply, 404, "TARGET_SCENE_NOT_FOUND");

    if (locationId) {
      const [link] = await db
        .select()
        .from(worldMapLocationScenes)
        .where(
          and(
            eq(worldMapLocationScenes.campaignId, auth.campaignId),
            eq(worldMapLocationScenes.locationId, locationId),
            eq(worldMapLocationScenes.sceneId, targetSceneId),
          ),
        )
        .limit(1);
      if (!link) return fail(reply, 404, "INVALID_LOCATION_SCENE_LINK");
    }

    const missingTokenMembershipIds = await computeMissingTokenMembers(
      db,
      auth.campaignId,
      targetSceneId,
    );
    const response: EncounterPreflightResponse = {
      targetSceneId,
      missingTokenMembershipIds,
    };
    return reply.send(response);
  });
}
