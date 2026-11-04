import { postgresErrorCode } from "./database-errors.js";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  achievementCommandSchema,
  instanceBindingCommandSchema,
  type AchievementView,
  type InstanceBindingView,
} from "@arken/contracts";
import {
  assets,
  achievementDefinitions,
  achievementAwards,
  achievementHistory,
  gameEvents,
  memberships,
  characters,
  tokenDefinitions,
  worldContent,
  worldContentInstances,
  worldContentInstanceActions,
  worldInstanceBindings,
} from "@arken/db";
import { requireAuth, type AuthContext } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;
class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
  }
}
function ensure(
  condition: unknown,
  code: string,
  status = 409,
): asserts condition {
  if (!condition) throw new DomainError(code, status);
}
const paramsSchema = z.object({ id: z.string().uuid() });
async function lock(tx: Tx, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}
async function receipt(
  tx: Tx,
  auth: AuthContext,
  actionId: string,
  hash: string,
  type: string,
) {
  await lock(tx, auth.campaignId + ":" + actionId);
  const [prior] = await tx
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, auth.campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    );
  if (prior)
    ensure(
      prior.type === type &&
        prior.membershipId === auth.membershipId &&
        (prior.payload as { commandHash?: string })?.commandHash === hash,
      "ACTION_ID_CONFLICT",
    );
  if (!prior && type === "instance.bindings") {
    const [instanceAction] = await tx
      .select({ actionId: worldContentInstanceActions.actionId })
      .from(worldContentInstanceActions)
      .where(
        and(
          eq(worldContentInstanceActions.campaignId, auth.campaignId),
          eq(worldContentInstanceActions.actionId, actionId),
        ),
      )
      .limit(1);
    ensure(!instanceAction, "ACTION_ID_CONFLICT");
  }
  return Boolean(prior);
}
async function record(
  tx: Tx,
  auth: AuthContext,
  actionId: string,
  hash: string,
  type: string,
  id: string | null,
) {
  await tx.insert(gameEvents).values({
    campaignId: auth.campaignId,
    actionId,
    membershipId: auth.membershipId,
    type,
    entityType: type,
    entityId: id,
    payload: { commandHash: hash },
  });
}
const hashOf = (body: unknown) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex");

// Same predicate used by collection and asset projection. Private awards never
// grant image access to other players; archived/revoked grants grant none.
export async function visibleAchievementIconIds(db: Db, auth: AuthContext) {
  const rows = await db
    .select({ id: achievementDefinitions.iconAssetId })
    .from(achievementAwards)
    .innerJoin(
      achievementDefinitions,
      eq(achievementAwards.achievementId, achievementDefinitions.id),
    )
    .where(
      and(
        eq(achievementAwards.campaignId, auth.campaignId),
        eq(achievementDefinitions.archived, false),
        eq(achievementAwards.revoked, false),
        or(
          eq(achievementAwards.membershipId, auth.membershipId),
          eq(achievementAwards.public, true),
        ),
      ),
    );
  return rows.flatMap((row) => (row.id ? [row.id] : []));
}
async function achievementView(
  db: Db,
  auth: AuthContext,
): Promise<AchievementView> {
  const gm = auth.role === "GM";
  const rows = await db
    .select({
      award: achievementAwards,
      definition: achievementDefinitions,
      name: memberships.displayName,
    })
    .from(achievementAwards)
    .innerJoin(
      achievementDefinitions,
      eq(achievementAwards.achievementId, achievementDefinitions.id),
    )
    .innerJoin(memberships, eq(achievementAwards.membershipId, memberships.id))
    .where(
      and(
        eq(achievementAwards.campaignId, auth.campaignId),
        gm
          ? undefined
          : and(
              eq(achievementDefinitions.archived, false),
              eq(achievementAwards.revoked, false),
              or(
                eq(achievementAwards.membershipId, auth.membershipId),
                eq(achievementAwards.public, true),
              ),
            ),
      ),
    );
  const definitions = gm
    ? await db
        .select()
        .from(achievementDefinitions)
        .where(eq(achievementDefinitions.campaignId, auth.campaignId))
    : [...new Map(rows.map((r) => [r.definition.id, r.definition])).values()];
  const history = gm
    ? await db
        .select({
          id: achievementHistory.id,
          operation: achievementHistory.operation,
          actor: memberships.displayName,
          reason: achievementHistory.reason,
          details: achievementHistory.payload,
          createdAt: achievementHistory.createdAt,
        })
        .from(achievementHistory)
        .innerJoin(
          memberships,
          eq(achievementHistory.actorMembershipId, memberships.id),
        )
        .where(eq(achievementHistory.campaignId, auth.campaignId))
        .orderBy(desc(achievementHistory.createdAt))
        .limit(100)
    : [];
  return {
    definitions: definitions.map(({ campaignId: _campaign, ...d }) => d),
    awards: rows.map((r) => ({
      id: r.award.id,
      achievementId: r.award.achievementId,
      membershipId: r.award.membershipId,
      displayName: r.name,
      public: r.award.public,
      revoked: r.award.revoked,
      revision: r.award.revision,
    })),
    history: history.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
async function instance(db: Db, campaignId: string, id: string) {
  const [row] = await db
    .select({ instance: worldContentInstances, type: worldContent.type })
    .from(worldContentInstances)
    .innerJoin(
      worldContent,
      eq(worldContentInstances.worldContentId, worldContent.id),
    )
    .where(
      and(
        eq(worldContentInstances.campaignId, campaignId),
        eq(worldContentInstances.id, id),
      ),
    );
  ensure(row, "INSTANCE_NOT_FOUND", 404);
  return row;
}

export function registerAwardsBindingsRoutes(
  app: FastifyInstance,
  db: Database,
  broadcast: (campaignId: string) => Promise<void>,
) {
  app.get("/api/achievements", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    reply.header("Cache-Control", "private, no-store");
    return achievementView(db, auth);
  });
  app.post("/api/achievements/commands", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const parsed = achievementCommandSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    const body = parsed.data,
      hash = hashOf(body);
    try {
      await db.transaction(async (tx) => {
        if (await receipt(tx, auth, body.actionId, hash, "achievement.command"))
          return;
        await lock(tx, auth.campaignId + ":achievements");
        let before: unknown = null;
        let after: unknown;
        let entityId: string;
        if ("fields" in body && body.fields.iconAssetId) {
          const [asset] = await tx
            .select()
            .from(assets)
            .where(
              and(
                eq(assets.id, body.fields.iconAssetId),
                eq(assets.campaignId, auth.campaignId),
              ),
            )
            .for("share");
          ensure(
            asset &&
              ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
                asset.mimeType,
              ) &&
              asset.kind !== "DICE_FRAME",
            "INVALID_ACHIEVEMENT_ICON",
            400,
          );
          // Explicit GM selection is approval to show this image to award audience.
        }
        if (body.operation === "create") {
          const [created] = await tx
            .insert(achievementDefinitions)
            .values({ campaignId: auth.campaignId, ...body.fields })
            .returning();
          ensure(created, "CREATE_FAILED");
          after = created;
          entityId = created.id;
        } else if (body.operation === "award-state") {
          const [award] = await tx
            .select()
            .from(achievementAwards)
            .where(
              and(
                eq(achievementAwards.id, body.id),
                eq(achievementAwards.campaignId, auth.campaignId),
              ),
            )
            .for("update");
          ensure(award, "AWARD_NOT_FOUND", 404);
          ensure(award.revision === body.revision, "REVISION_CONFLICT");
          ensure(!award.revoked || body.revoked, "USE_AWARD_TO_REGRANT");
          before = award;
          entityId = award.id;
          [after] = await tx
            .update(achievementAwards)
            .set({
              public: body.public,
              revoked: body.revoked,
              revision: award.revision + 1,
            })
            .where(eq(achievementAwards.id, award.id))
            .returning();
        } else {
          const [definition] = await tx
            .select()
            .from(achievementDefinitions)
            .where(
              and(
                eq(achievementDefinitions.id, body.id),
                eq(achievementDefinitions.campaignId, auth.campaignId),
              ),
            )
            .for("update");
          ensure(definition, "ACHIEVEMENT_NOT_FOUND", 404);
          ensure(definition.revision === body.revision, "REVISION_CONFLICT");
          entityId = definition.id;
          before = definition;
          if (body.operation === "edit" || body.operation === "archive") {
            [after] = await tx
              .update(achievementDefinitions)
              .set({
                ...(body.operation === "edit"
                  ? body.fields
                  : { archived: body.archived }),
                revision: definition.revision + 1,
              })
              .where(eq(achievementDefinitions.id, definition.id))
              .returning();
          } else {
            ensure(!definition.archived, "ACHIEVEMENT_ARCHIVED");
            const recipients = [...new Set(body.membershipIds)];
            const members = await tx
              .select({ id: memberships.id })
              .from(memberships)
              .where(
                and(
                  eq(memberships.campaignId, auth.campaignId),
                  eq(memberships.role, "PLAYER"),
                  inArray(memberships.id, recipients),
                ),
              );
            ensure(
              members.length === recipients.length,
              "INVALID_RECIPIENT",
              400,
            );
            const awards = [];
            for (const membershipId of recipients) {
              const [old] = await tx
                .select()
                .from(achievementAwards)
                .where(
                  and(
                    eq(achievementAwards.achievementId, definition.id),
                    eq(achievementAwards.membershipId, membershipId),
                  ),
                );
              ensure(!old || old.revoked, "ALREADY_AWARDED");
              const [award] = old
                ? await tx
                    .update(achievementAwards)
                    .set({
                      revoked: false,
                      public: body.public,
                      revision: old.revision + 1,
                    })
                    .where(eq(achievementAwards.id, old.id))
                    .returning()
                : await tx
                    .insert(achievementAwards)
                    .values({
                      campaignId: auth.campaignId,
                      achievementId: definition.id,
                      membershipId,
                      public: body.public,
                    })
                    .returning();
              awards.push({ before: old ?? null, after: award });
            }
            after = awards;
          }
        }
        await tx.insert(achievementHistory).values({
          campaignId: auth.campaignId,
          actorMembershipId: auth.membershipId,
          operation: body.operation,
          reason:
            "reason" in body ? body.reason : "Изменение определения достижения",
          payload: { actionId: body.actionId, entityId, before, after },
        });
        await record(
          tx,
          auth,
          body.actionId,
          hash,
          "achievement.command",
          entityId,
        );
      });
      await broadcast(auth.campaignId);
      return achievementView(db, auth);
    } catch (error) {
      if (error instanceof DomainError)
        return reply.code(error.status).send({ error: error.code });
      if (postgresErrorCode(error) === "23503")
        return reply.code(409).send({ error: "RELATED_RECORD_CHANGED" });
      throw error;
    }
  });
  app.get(
    "/api/world-content-instances/:id/bindings",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      reply.header("Cache-Control", "private, no-store");
      const params = paramsSchema.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      try {
        const row = await instance(db, auth.campaignId, params.data.id);
        const [binding] = await db
          .select()
          .from(worldInstanceBindings)
          .where(eq(worldInstanceBindings.instanceId, params.data.id));
        const tokens = await db
          .select({
            id: tokenDefinitions.id,
            name: tokenDefinitions.name,
            characterName: characters.name,
          })
          .from(tokenDefinitions)
          .leftJoin(characters, eq(tokenDefinitions.characterId, characters.id))
          .where(eq(tokenDefinitions.campaignId, auth.campaignId));
        const containers = await db
          .select({
            id: worldContentInstances.id,
            name: worldContentInstances.displayNameOverride,
            canonicalName: worldContent.name,
          })
          .from(worldContentInstances)
          .innerJoin(
            worldContent,
            eq(worldContentInstances.worldContentId, worldContent.id),
          )
          .where(
            and(
              eq(worldContentInstances.campaignId, auth.campaignId),
              eq(worldContent.type, "ITEM"),
            ),
          );
        const view: InstanceBindingView = {
          revision: binding?.revision ?? 0,
          tokenDefinitionId: binding?.tokenDefinitionId ?? null,
          containerInstanceId: binding?.containerInstanceId ?? null,
          type: row.type,
          tokens: tokens.map((t) => ({
            id: t.id,
            name: t.name ?? t.characterName ?? "Токен",
          })),
          containers: containers
            .filter((c) => c.id !== params.data.id)
            .map((c) => ({ id: c.id, name: c.name ?? c.canonicalName })),
        };
        return view;
      } catch (error) {
        if (error instanceof DomainError)
          return reply.code(error.status).send({ error: error.code });
        if (postgresErrorCode(error) === "23503")
          return reply.code(409).send({ error: "RELATED_RECORD_CHANGED" });
        throw error;
      }
    },
  );
  app.put(
    "/api/world-content-instances/:id/bindings",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      const params = paramsSchema.safeParse(request.params),
        parsed = instanceBindingCommandSchema.safeParse(request.body);
      if (!params.success || !parsed.success)
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      const body = parsed.data,
        id = params.data.id,
        hash = hashOf({ id, body });
      try {
        await db.transaction(async (tx) => {
          if (await receipt(tx, auth, body.actionId, hash, "instance.bindings"))
            return;
          // Serialize the whole containment graph: opposing A->B / B->A cannot race.
          await lock(tx, auth.campaignId + ":instance-bindings");
          const row = await instance(tx, auth.campaignId, id);
          await tx
            .select({ id: worldContentInstances.id })
            .from(worldContentInstances)
            .where(eq(worldContentInstances.id, id))
            .for("update");
          const [old] = await tx
            .select()
            .from(worldInstanceBindings)
            .where(eq(worldInstanceBindings.instanceId, id));
          ensure((old?.revision ?? 0) === body.revision, "REVISION_CONFLICT");
          ensure(
            !body.tokenDefinitionId || ["PERSON", "MONSTER"].includes(row.type),
            "TOKEN_REQUIRES_NPC",
            400,
          );
          ensure(
            !body.containerInstanceId || row.type === "ITEM",
            "CONTAINER_REQUIRES_ITEM",
            400,
          );
          if (body.tokenDefinitionId) {
            const [token] = await tx
              .select()
              .from(tokenDefinitions)
              .where(
                and(
                  eq(tokenDefinitions.campaignId, auth.campaignId),
                  eq(tokenDefinitions.id, body.tokenDefinitionId),
                ),
              )
              .for("share");
            ensure(token, "TOKEN_NOT_FOUND", 404);
          }
          if (body.containerInstanceId) {
            ensure(
              !row.instance.inventoryCharacterId,
              "INVENTORY_DETACH_BEFORE_CONTAINER",
              409,
            );
            const container = await instance(
              tx,
              auth.campaignId,
              body.containerInstanceId,
            );
            ensure(container.type === "ITEM", "CONTAINER_REQUIRES_ITEM", 400);
            ensure(
              !container.instance.inventoryCharacterId,
              "INVENTORY_DETACH_BEFORE_CONTAINER",
              409,
            );
            const seen = new Set([id]);
            let parent: string | null = body.containerInstanceId;
            while (parent) {
              ensure(!seen.has(parent), "CONTAINER_CYCLE", 400);
              seen.add(parent);
              const [link] = await tx
                .select()
                .from(worldInstanceBindings)
                .where(eq(worldInstanceBindings.instanceId, parent));
              parent = link?.containerInstanceId ?? null;
            }
          }
          const values = {
            campaignId: auth.campaignId,
            tokenDefinitionId: body.tokenDefinitionId,
            containerInstanceId: body.containerInstanceId,
            revision: body.revision + 1,
          };
          if (old)
            await tx
              .update(worldInstanceBindings)
              .set(values)
              .where(eq(worldInstanceBindings.instanceId, id));
          else
            await tx
              .insert(worldInstanceBindings)
              .values({ instanceId: id, ...values });
          // Binding audit belongs to the existing GM-only instance ledger.
          await tx.insert(worldContentInstanceActions).values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            type: "world_content_instance.bindings",
            entityType: "world_content_instance",
            entityId: id,
            entityRevision: values.revision,
            actorMembershipId: auth.membershipId,
            payload: { before: old ?? null, after: values },
          });
          await record(tx, auth, body.actionId, hash, "instance.bindings", id);
        });
        const [saved] = await db
          .select()
          .from(worldInstanceBindings)
          .where(
            and(
              eq(worldInstanceBindings.instanceId, id),
              eq(worldInstanceBindings.campaignId, auth.campaignId),
            ),
          );
        ensure(saved, "INSTANCE_NOT_FOUND", 404);
        return {
          revision: saved.revision,
          tokenDefinitionId: saved.tokenDefinitionId,
          containerInstanceId: saved.containerInstanceId,
        };
      } catch (error) {
        if (error instanceof DomainError)
          return reply.code(error.status).send({ error: error.code });
        if (postgresErrorCode(error) === "23503")
          return reply.code(409).send({ error: "RELATED_RECORD_CHANGED" });
        throw error;
      }
    },
  );
}
