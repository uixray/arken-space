import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import type {
  CharacterDto,
  ChatMessageDto,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";
import { randomInt } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  diceRequestSchema,
  entryDataSchema,
  entryRollRequestSchema,
  characterCountersCommandSchema,
  rechargeEntryCommandSchema,
} from "@arken/contracts";
import {
  characterCatalogEntries,
  characterControllers,
  campaigns,
  characters,
  chatMessages,
  gameEvents,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { DiceFormulaError, rollFormulaWithMode } from "./dice.js";
import { selectDiceFrame } from "./dice-frame-selection.js";
import { resolveStatLayout } from "./snapshot.js";
import {
  characterDto,
  characterRollStats,
  normalizeCharacterResources,
  normalizeCharacterWallet,
} from "./character-dto.js";
import { findAction } from "./action-lookup.js";
import {
  type Resources,
  type WalletAuditSystemData,
  WALLET_AUDIT_BURST_MS,
  applyCharacterRest,
  formatResourceChanges,
  formatWalletChanges,
  isWalletAuditSystemData,
  resourceLabelsFromLayout,
} from "./character-rules.js";
import { campaignRoom, gmRoom, memberRoom } from "./rooms.js";
import {
  canAccessCharacter,
  campaignDefaultStatLayout,
  characterControllerIds,
  sameResourceImages,
} from "./character-access.js";
import { rechargeCampaignCatalogEntries } from "./campaign-clock.js";
import {
  chatBroadcastAudience,
  chatMessageDto,
  ensureStreamThread,
} from "./chat.js";
import {
  normalizeLegacyEntryData,
  normalizeLegacyFormula,
  normalizeLegacyStats,
} from "./entry-data.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * Character play: counters (HP, resources, wallet, rests), ability recharge
 * and rolls, free dice. Moved out of routes.ts unchanged (legacy cleanup
 * after the 15.10 audit).
 */
export function registerCharacterPlayRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
  {
    broadcast,
    publishCharacter,
  }: {
    broadcast: (campaignId: string) => Promise<void>;
    /** UIX-412: a character change as a point event to those who see it. */
    publishCharacter: (
      campaignId: string,
      change: {
        character: { ownerMembershipId: string | null };
        controllerIds: string[];
        project: (visibleControllerIds: string[]) => CharacterDto;
        message: ChatMessageDto | null;
        envelope: { sequence: number; actionId: string; emittedAt: string };
      },
    ) => Promise<void>;
  },
) {
  app.patch("/api/characters/:id/counters", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = characterCountersCommandSchema.parse(request.body);
    const loadCharacter = async () => {
      const [row] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, id),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      return row;
    };
    const canEditCharacter = (
      character: typeof characters.$inferSelect | undefined,
    ) => canAccessCharacter(db, auth, character);
    const sendReplay = async (
      action: NonNullable<Awaited<ReturnType<typeof findAction>>>,
    ) => {
      if (action.type !== "character.counters" || action.entityId !== id)
        return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
      // The action may have committed after this request read the character.
      // Reload after observing the receipt so replay always returns the
      // canonical post-commit revision/wallet, never that stale pre-read row.
      const canonical = await loadCharacter();
      if (!(await canEditCharacter(canonical)))
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
      const assignedEntries = await db
        .select()
        .from(characterCatalogEntries)
        .where(eq(characterCatalogEntries.characterId, id));
      return reply
        .code(200)
        .send(
          characterDto(
            canonical!,
            assignedEntries,
            await characterControllerIds(db, id),
            await campaignDefaultStatLayout(db, auth.campaignId),
          ),
        );
    };

    // Check the receipt before loading the entity. This ordering guarantees a
    // normal replay reads its character after the original transaction commit.
    const priorAction = await findAction(db, auth.campaignId, body.actionId);
    const character = await loadCharacter();
    if (!(await canEditCharacter(character)))
      return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    if (priorAction) return sendReplay(priorAction);
    if (character!.revision !== body.revision) {
      const racedAction = await findAction(db, auth.campaignId, body.actionId);
      if (racedAction) return sendReplay(racedAction);
      return reply
        .code(409)
        .send({ error: "CHARACTER_CONFLICT", revision: character!.revision });
    }
    const nextResources = body.rest
      ? applyCharacterRest(
          (character!.resources ?? {}) as Resources,
          body.rest,
          normalizeLegacyStats(character!.stats),
        )
      : body.resources;
    let resourceLabels: ReadonlyMap<string, string> = new Map();
    if (nextResources) {
      const [campaign] = await db
        .select({ statLayout: campaigns.statLayout })
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      resourceLabels = resourceLabelsFromLayout(
        resolveStatLayout(campaign?.statLayout),
      );
    }
    const changes = [
      body.wallet
        ? formatWalletChanges(
            normalizeCharacterWallet(character!.wallet),
            body.wallet,
          )
        : "",
      nextResources
        ? formatResourceChanges(
            (character!.resources ?? {}) as Resources,
            nextResources,
            resourceLabels,
          )
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    if (!changes && !body.rest)
      return reply.code(400).send({ error: "NO_COUNTER_CHANGES" });
    const changeDescription =
      changes || (body.rest === "SHORT" ? "короткий отдых" : "долгий отдых");
    const tableThread = await ensureStreamThread(db, auth.campaignId, "TABLE");
    const walletOnly = Boolean(body.wallet) && !nextResources && !body.rest;
    const walletBefore = normalizeCharacterWallet(character!.wallet);
    const result = await db
      .transaction(async (tx) => {
        const [updated] = await tx
          .update(characters)
          .set({
            ...(body.wallet ? { wallet: body.wallet } : {}),
            ...(nextResources ? { resources: nextResources } : {}),
            revision: character!.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characters.id, id),
              eq(characters.revision, character!.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        if (body.rest) {
          const [clock] = await tx
            .select({
              day: campaigns.day,
              battleCounter: campaigns.battleCounter,
            })
            .from(campaigns)
            .where(eq(campaigns.id, auth.campaignId))
            .limit(1);
          if (!clock) throw new Error("CAMPAIGN_NOT_FOUND");
          const recharged = await rechargeCampaignCatalogEntries(
            tx,
            auth.campaignId,
            {
              trigger: body.rest === "SHORT" ? "SHORT_REST" : "LONG_REST",
              day: clock.day,
              battleCounter: clock.battleCounter,
              characterId: id,
            },
          );
          // A rest with neither resource recovery nor a recharged ability is a
          // no-op. Abort the transaction so it cannot bump revision or journal it.
          if (!changes && recharged === 0)
            throw new Error("NO_COUNTER_CHANGES");
        }
        const now = new Date();
        const walletData: WalletAuditSystemData | null =
          walletOnly && body.wallet
            ? {
                type: "WALLET_AUDIT",
                before: walletBefore,
                after: body.wallet,
                lastAt: now.toISOString(),
                operationCount: 1,
              }
            : null;
        const [latestMessage] = walletData
          ? await tx
              .select()
              .from(chatMessages)
              .where(eq(chatMessages.threadId, tableThread.id))
              .orderBy(desc(chatMessages.sequence))
              .limit(1)
              .for("update")
          : [];
        const latestWalletData = latestMessage?.systemData;
        const lastAt = isWalletAuditSystemData(latestWalletData)
          ? Date.parse(latestWalletData.lastAt)
          : Number.NaN;
        const elapsed = now.getTime() - lastAt;
        const canAggregate =
          latestMessage?.kind === "SYSTEM" &&
          latestMessage.visibility === "PUBLIC" &&
          latestMessage.membershipId === auth.membershipId &&
          latestMessage.characterId === id &&
          isWalletAuditSystemData(latestWalletData) &&
          elapsed >= 0 &&
          elapsed <= WALLET_AUDIT_BURST_MS;
        const aggregateData: WalletAuditSystemData | null =
          canAggregate && body.wallet
            ? {
                ...latestWalletData,
                after: body.wallet,
                lastAt: now.toISOString(),
                operationCount: latestWalletData.operationCount + 1,
              }
            : null;
        const [message] =
          aggregateData && latestMessage
            ? await tx
                .update(chatMessages)
                .set({
                  body: `${character!.name} \u2014 ${formatWalletChanges(
                    aggregateData.before,
                    aggregateData.after,
                  )}`,
                  systemData: aggregateData,
                })
                .where(eq(chatMessages.id, latestMessage.id))
                .returning()
            : await tx
                .insert(chatMessages)
                .values({
                  campaignId: auth.campaignId,
                  membershipId: auth.membershipId,
                  characterId: id,
                  kind: "SYSTEM",
                  threadId: tableThread.id,
                  visibility: "PUBLIC",
                  body: `${character!.name} \u2014 ${changeDescription}`,
                  systemData: walletData,
                })
                .returning();
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: "character.counters",
            entityType: "character",
            entityId: id,
            entityRevision: updated.revision,
            payload: {
              wallet: body.wallet,
              resources: nextResources,
              rest: body.rest,
            },
          })
          .returning();
        if (!event || !message) throw new Error("EVENT_RECORD_FAILED");
        // An aggregated wallet line rewrites an existing message; there is
        // no point event for that, so it keeps the full broadcast.
        return { updated, message, event, aggregated: Boolean(aggregateData) };
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === "NO_COUNTER_CHANGES")
          return "NO_COUNTER_CHANGES" as const;
        throw error;
      });
    if (result === "NO_COUNTER_CHANGES")
      return reply.code(400).send({ error: "NO_COUNTER_CHANGES" });
    if (!result) {
      const racedAction = await findAction(db, auth.campaignId, body.actionId);
      if (racedAction) return sendReplay(racedAction);
      return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    }
    const assignedEntries = await db
      .select()
      .from(characterCatalogEntries)
      .where(eq(characterCatalogEntries.characterId, id));
    const controllerIds = await characterControllerIds(db, id);
    const statLayout = await campaignDefaultStatLayout(db, auth.campaignId);
    // A changed resource image must enter snapshot.assets: full broadcast.
    if (
      result.aggregated ||
      !sameResourceImages(character!.resources, result.updated.resources)
    )
      await broadcast(auth.campaignId);
    else
      await publishCharacter(auth.campaignId, {
        character: result.updated,
        controllerIds,
        project: (visibleControllerIds) =>
          characterDto(
            result.updated,
            assignedEntries,
            visibleControllerIds,
            statLayout,
          ),
        message: chatMessageDto(
          result.message,
          auth.displayName,
          tableThread.stream,
        ),
        envelope: {
          sequence: Number(result.event.sequence),
          actionId: body.actionId,
          emittedAt: result.event.createdAt.toISOString(),
        },
      });
    return characterDto(
      result.updated,
      assignedEntries,
      controllerIds,
      statLayout,
    );
  });

  app.post(
    "/api/characters/:characterId/catalog/:entryId/recharge",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
        .parse(request.params);
      const body = rechargeEntryCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const [row] = await db
        .select({ character: characters, entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characters.id, params.characterId),
            eq(characterCatalogEntries.id, params.entryId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!row || !(await canAccessCharacter(db, auth, row.character)))
        return reply.code(403).send({ error: "CHARACTER_ENTRY_FORBIDDEN" });
      if (row.entry.revision !== body.revision)
        return reply
          .code(409)
          .send({ error: "ENTRY_CONFLICT", revision: row.entry.revision });
      const parsed = entryDataSchema.safeParse(
        normalizeLegacyEntryData(row.entry.data),
      );
      if (!parsed.success || !parsed.data.uses)
        return reply.code(400).send({ error: "ENTRY_HAS_NO_USES" });
      const tableThread = await ensureStreamThread(
        db,
        auth.campaignId,
        "TABLE",
      );
      const result = await db.transaction(async (tx) => {
        const [clock] = await tx
          .select({
            day: campaigns.day,
            battleCounter: campaigns.battleCounter,
          })
          .from(campaigns)
          .where(eq(campaigns.id, auth.campaignId))
          .limit(1);
        if (!clock) throw new Error("CAMPAIGN_NOT_FOUND");
        const anchoredUses = {
          ...parsed.data.uses!,
          current: parsed.data.uses!.max,
          ...(parsed.data.uses!.recharge === "DAY" ||
          parsed.data.uses!.recharge === "WEEK"
            ? { lastRechargeDay: clock.day }
            : {}),
          ...(parsed.data.uses!.recharge === "BATTLE"
            ? { lastBattleCounter: clock.battleCounter }
            : {}),
        };
        const [updated] = await tx
          .update(characterCatalogEntries)
          .set({
            data: {
              ...parsed.data,
              uses: anchoredUses,
            },
            revision: row.entry.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characterCatalogEntries.id, row.entry.id),
              eq(characterCatalogEntries.revision, row.entry.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        const [message] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: row.character.id,
            kind: "SYSTEM",
            threadId: tableThread.id,
            visibility: "PUBLIC",
            body: `${auth.displayName}: ${row.entry.name} перезаряжена (${parsed.data.uses!.max}/${parsed.data.uses!.max})`,
          })
          .returning();
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "entry.recharged",
          entityType: "character_catalog_entry",
          entityId: row.entry.id,
          entityRevision: updated.revision,
        });
        return { updated, message };
      });
      if (!result) return reply.code(409).send({ error: "ENTRY_CONFLICT" });
      await broadcast(auth.campaignId);
      return result.updated;
    },
  );

  app.post(
    "/api/characters/:characterId/catalog/:entryId/roll",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
        .parse(request.params);
      const body = entryRollRequestSchema.parse(request.body);
      const mode = body.mode ?? "EXECUTE";
      const replay = await findAction(db, auth.campaignId, body.actionId);
      if (replay) return reply.code(200).send({ duplicate: true });
      if (auth.role !== "GM" && body.visibility === "GM_ONLY")
        return reply.code(403).send({ error: "GM_ONLY_VISIBILITY_FORBIDDEN" });
      const [row] = await db
        .select({ character: characters, entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characters.id, params.characterId),
            eq(characterCatalogEntries.id, params.entryId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!row || !(await canAccessCharacter(db, auth, row.character)))
        return reply.code(403).send({ error: "CHARACTER_ENTRY_FORBIDDEN" });
      if (
        body.entryRevision !== undefined &&
        body.entryRevision !== row.entry.revision
      )
        return reply
          .code(409)
          .send({ error: "ENTRY_CONFLICT", revision: row.entry.revision });
      const parsedData = entryDataSchema.safeParse(
        normalizeLegacyEntryData(row.entry.data),
      );
      if (!parsedData.success)
        return reply.code(400).send({ error: "INVALID_ENTRY_DATA" });
      const rollsThread = await ensureStreamThread(
        db,
        auth.campaignId,
        "ROLLS",
      );
      let action:
        NonNullable<typeof parsedData.data.rollActions>[number] | undefined;
      const noRollActivation = mode === "EXECUTE" && !body.rollActionId;
      const activationConfig = parsedData.data.activation ?? {
        // Existing use counters are an explicit structured limit. Legacy
        // abilities without one remain free activations (never parse prose).
        consumeUse: Boolean(parsedData.data.uses),
      };
      let formula: string | null = null;
      let result: ReturnType<typeof rollFormulaWithMode> | null = null;
      if (mode === "EXECUTE") {
        if (noRollActivation) {
          if (row.entry.kind !== "ABILITY")
            return reply
              .code(400)
              .send({ error: "ABILITY_ACTIVATION_NOT_CONFIGURED" });
        } else {
          action = parsedData.data.rollActions?.find(
            (candidate) => candidate.id === body.rollActionId,
          );
          if (!action)
            return reply.code(404).send({ error: "ROLL_ACTION_NOT_FOUND" });
        }
        if (
          noRollActivation &&
          activationConfig.consumeUse &&
          (!parsedData.data.uses || parsedData.data.uses.current < 1)
        )
          return reply.code(409).send({ error: "NO_ABILITY_USES" });
        if (!action) {
          // A configured no-roll activation has no dice/formula by design.
        } else {
          const values: Record<string, number> = {};
          const formulaParts = [action.dice];
          const characterStats = action.modifiers.some(
            (source) => source.type === "CHARACTERISTIC",
          )
            ? characterRollStats(
                row.character,
                await campaignDefaultStatLayout(db, auth.campaignId),
              )
            : {};
          for (const [index, source] of action.modifiers.entries()) {
            if (source.type === "CONSTANT") {
              formulaParts.push(String(source.value));
              continue;
            }
            if (source.type === "FORMULA") {
              const terms = source.formula.match(/[+-]?\d+/g);
              if (!terms)
                return reply
                  .code(400)
                  .send({ error: "INVALID_MODIFIER_FORMULA" });
              formulaParts.push(
                String(terms.reduce((sum, term) => sum + Number(term), 0)),
              );
              continue;
            }
            const key = `modifier_${index}`;
            const value =
              source.type === "CHARACTERISTIC"
                ? characterStats[source.key]
                : parsedData.data.values?.[source.key];
            if (value === undefined || !Number.isFinite(value))
              return reply
                .code(400)
                .send({ error: "MISSING_MODIFIER_SOURCE", source });
            values[key] = value;
            formulaParts.push(key);
          }
          formula = formulaParts.join(" + ");
          result = {
            ...rollFormulaWithMode(
              formula,
              values,
              body.rollMode ?? (action.advantage ? "ADVANTAGE" : "NORMAL"),
              randomInt,
              action.label,
            ),
            styleFrame: await selectDiceFrame(db, {
              campaignId: auth.campaignId,
              membershipId: auth.membershipId,
              sourceCatalogEntryId: row.entry.sourceCatalogEntryId,
            }),
          };
          if (
            action.consumeUse &&
            (!parsedData.data.uses || parsedData.data.uses.current < 1)
          )
            return reply.code(409).send({ error: "NO_ABILITY_USES" });
        }
      }
      const cost =
        mode === "EXECUTE"
          ? noRollActivation
            ? activationConfig.cost
            : action?.cost
          : undefined;
      const resourceKey =
        cost?.type === "physical"
          ? "physicalPower"
          : cost?.type === "magic"
            ? "magicPower"
            : null;
      const resources = normalizeCharacterResources(row.character.resources);
      const resourceBefore = resourceKey
        ? (resources[resourceKey]?.current ?? 0)
        : null;
      if (cost && resourceBefore !== null && resourceBefore < cost.amount)
        return reply.code(409).send({
          error: "INSUFFICIENT_CHARACTER_RESOURCE",
          resource: cost.type,
          required: cost.amount,
          available: resourceBefore,
        });
      const afterResources =
        cost && resourceKey && resourceBefore !== null
          ? {
              ...resources,
              [resourceKey]: {
                ...resources[resourceKey],
                current: resourceBefore - cost.amount,
              },
            }
          : resources;
      const uses = parsedData.data.uses;
      const consumeUse =
        mode === "EXECUTE" &&
        (noRollActivation ? activationConfig.consumeUse : action?.consumeUse);
      const afterUses =
        consumeUse && uses ? { ...uses, current: uses.current - 1 } : uses;
      const skillCard = {
        version: 1 as const,
        execution:
          mode === "EXECUTE" ? ("EXECUTED" as const) : ("SHARED" as const),
        entry: {
          id: row.entry.id,
          revision: row.entry.revision,
          sourceCatalogEntryId: row.entry.sourceCatalogEntryId,
          kind: row.entry.kind,
          name: row.entry.name,
          description: row.entry.description,
          notes: parsedData.data.notes ?? null,
        },
        actor: {
          membershipId: auth.membershipId,
          displayName: auth.displayName,
          characterId: row.character.id,
          characterName: row.character.name,
        },
        action: action
          ? {
              id: action.id,
              kind: action.kind,
              label: action.label,
              dice: action.dice,
              advantage: action.advantage,
              consumeUse: action.consumeUse,
              cost: action.cost,
            }
          : null,
        formula,
        result,
        uses: uses
          ? {
              before: uses.current,
              after: afterUses!.current,
              max: uses.max,
              recharge: uses.recharge,
            }
          : null,
        activationCost:
          cost && resourceKey && resourceBefore !== null
            ? {
                type: cost.type,
                amount: cost.amount,
                before: resourceBefore,
                after: resourceBefore - cost.amount,
              }
            : null,
        visibility: body.visibility,
      };
      let saved: {
        message: typeof chatMessages.$inferSelect;
        event: typeof gameEvents.$inferSelect;
      } | null;
      try {
        saved = await db.transaction(async (tx) => {
          if (cost && resourceKey) {
            const [resourceUpdated] = await tx
              .update(characters)
              .set({
                resources: afterResources,
                revision: row.character.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(characters.id, row.character.id),
                  eq(characters.revision, row.character.revision),
                ),
              )
              .returning({ id: characters.id });
            if (!resourceUpdated) throw new Error("ENTRY_CONFLICT_TX");
          }
          if (consumeUse && uses) {
            const [updated] = await tx
              .update(characterCatalogEntries)
              .set({
                data: { ...parsedData.data, uses: afterUses! },
                revision: row.entry.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(characterCatalogEntries.id, row.entry.id),
                  eq(characterCatalogEntries.revision, row.entry.revision),
                ),
              )
              .returning({ id: characterCatalogEntries.id });
            if (!updated) throw new Error("ENTRY_CONFLICT_TX");
          }
          if (mode === "EXECUTE" && cost && resourceKey && !consumeUse) {
            const [updated] = await tx
              .update(characterCatalogEntries)
              .set({ revision: row.entry.revision + 1, updatedAt: new Date() })
              .where(
                and(
                  eq(characterCatalogEntries.id, row.entry.id),
                  eq(characterCatalogEntries.revision, row.entry.revision),
                ),
              )
              .returning({ id: characterCatalogEntries.id });
            if (!updated) throw new Error("ENTRY_CONFLICT_TX");
          }
          const [message] = await tx
            .insert(chatMessages)
            .values({
              campaignId: auth.campaignId,
              membershipId: auth.membershipId,
              characterId: row.character.id,
              kind: "DICE",
              threadId: rollsThread.id,
              visibility: body.visibility,
              body: [
                action?.label ?? row.entry.name,
                row.entry.description,
                parsedData.data.notes,
              ]
                .filter(Boolean)
                .join(" - "),
              dice: result ? { ...result, skillCard } : { skillCard },
            })
            .returning();
          if (!message) throw new Error("ROLL_SAVE_FAILED");
          const [event] = await tx
            .insert(gameEvents)
            .values({
              campaignId: auth.campaignId,
              actionId: body.actionId,
              membershipId: auth.membershipId,
              type: mode === "EXECUTE" ? "entry.roll" : "entry.shared",
              entityType: "chat",
              entityId: message.id,
              entityRevision:
                mode === "EXECUTE" && (consumeUse || (cost && resourceKey))
                  ? row.entry.revision + 1
                  : row.entry.revision,
              payload: {
                skillCard,
                messageId: message.id,
                resourceCost: cost
                  ? {
                      type: cost.type,
                      amount: cost.amount,
                      before: resourceBefore,
                      after: resourceBefore! - cost.amount,
                    }
                  : null,
              },
            })
            .returning();
          if (!event) throw new Error("EVENT_RECORD_FAILED");
          return { message, event };
        });
      } catch (error) {
        // A concurrent retry may lose only at the unique action receipt. The
        // transaction rolls back its message/resource changes, then replay it.
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505" &&
          (await findAction(db, auth.campaignId, body.actionId))
        )
          return reply.code(200).send({ duplicate: true });
        if (error instanceof Error && error.message === "ENTRY_CONFLICT_TX")
          return reply.code(409).send({ error: "ENTRY_CONFLICT" });
        throw error;
      }
      if (!saved) {
        // A concurrent request with this same action can commit between our
        // preflight receipt lookup and the entry CAS. Its receipt is the
        // authoritative idempotent result; only a different stale action is
        // an optimistic-concurrency conflict.
        if (await findAction(db, auth.campaignId, body.actionId))
          return reply.code(200).send({ duplicate: true });
        return reply.code(409).send({ error: "ENTRY_CONFLICT" });
      }
      const dto = chatMessageDto(
        saved.message,
        auth.displayName,
        rollsThread.stream,
      );
      const envelope = {
        sequence: Number(saved.event.sequence),
        actionId: body.actionId,
        emittedAt: saved.event.createdAt.toISOString(),
        data: dto,
      };
      if (chatBroadcastAudience(saved.message.visibility) === "CAMPAIGN")
        io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      else {
        io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
        io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
      }
      await broadcast(auth.campaignId);
      return reply
        .code(201)
        .send({ ...(result ?? {}), skillCard, messageId: saved.message.id });
    },
  );

  app.post("/api/dice", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = diceRequestSchema.parse(request.body);
    const rollsThread = await ensureStreamThread(db, auth.campaignId, "ROLLS");
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    let character = null;
    if (body.characterId) {
      [character] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character || !(await canAccessCharacter(db, auth, character)))
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    } else if (auth.role === "PLAYER") {
      [character] = await db
        .select({ character: characters })
        .from(characters)
        .leftJoin(
          characterControllers,
          eq(characterControllers.characterId, characters.id),
        )
        .where(
          and(
            eq(characters.campaignId, auth.campaignId),
            or(
              eq(characters.ownerMembershipId, auth.membershipId),
              eq(characterControllers.membershipId, auth.membershipId),
            ),
          ),
        )
        .orderBy(
          desc(sql`${characters.ownerMembershipId} = ${auth.membershipId}`),
        )
        .limit(1)
        .then((rows) => rows.map((row) => row.character));
    }
    try {
      const normalizedFormula = normalizeLegacyFormula(body.formula);
      const modeLabel =
        body.rollMode === "ADVANTAGE"
          ? "преимущество"
          : body.rollMode === "DISADVANTAGE"
            ? "помеха"
            : null;
      const rollLabel = `${body.label ?? body.formula}${modeLabel ? ` · ${modeLabel}` : ""}`;
      const result = {
        ...rollFormulaWithMode(
          normalizedFormula,
          character
            ? characterRollStats(
                character,
                await campaignDefaultStatLayout(db, auth.campaignId),
              )
            : normalizeLegacyStats(undefined),
          body.rollMode ?? "NORMAL",
          randomInt,
          rollLabel,
        ),
        // UIX-457: у чистого броска нет навыка — только рамка игрока.
        styleFrame: await selectDiceFrame(db, {
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
        }),
      };
      const saved = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: character?.id ?? null,
            kind: "DICE",
            threadId: rollsThread.id,
            visibility: body.visibility,
            body: rollLabel,
            dice: result,
          })
          .returning();
        if (!row) throw new Error("ROLL_SAVE_FAILED");
        const dto = chatMessageDto(row, auth.displayName, rollsThread.stream);
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: "dice.created",
            entityType: "chat",
            entityId: row.id,
            payload: dto,
          })
          .returning();
        if (!event) throw new Error("EVENT_RECORD_FAILED");
        return { row, dto, event };
      });
      const { row, dto, event } = saved;
      const envelope = {
        sequence: Number(event.sequence),
        actionId: body.actionId,
        emittedAt: event.createdAt.toISOString(),
        data: dto,
      };
      if (chatBroadcastAudience(row.visibility) === "CAMPAIGN")
        io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      else {
        io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
        io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
      }
      return reply.code(201).send(dto);
    } catch (error) {
      if (error instanceof DiceFormulaError)
        return reply
          .code(400)
          .send({ error: "INVALID_DICE_FORMULA", message: error.message });
      throw error;
    }
  });
}
