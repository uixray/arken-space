import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { characterCountersCommandSchema } from "@arken/contracts";
import { campaigns, characters, chatMessages, gameEvents } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { sameInspiration } from "./character-extras-routes.js";
import {
  canAccessCharacter,
  characterControllerIds,
  campaignDefaultStatLayout,
  sameResourceImages,
} from "./character-access.js";
import {
  characterDto,
  loadCharacterEntries,
  normalizeCharacterWallet,
} from "./character-dto.js";
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
import { normalizeLegacyStats } from "./entry-data.js";
import { resolveStatLayout } from "./snapshot.js";
import { rechargeCampaignCatalogEntries } from "./campaign-clock.js";
import { ensureStreamThread, chatMessageDto } from "./chat.js";
import { findAction } from "./action-lookup.js";
import { lockInventoryGraph } from "./inventory-assignment.js";
import { postgresErrorCode } from "./database-errors.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export class CharacterCountersError extends Error {
  constructor(
    readonly status: 400 | 403 | 409,
    readonly details: Record<string, unknown>,
  ) {
    super(String(details.error));
  }
  get statusCode() {
    return this.status;
  }
}
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
/** Shared atomic character counters/rest command. No transport may bypass
 * progression/inspiration ledgers, ownership, revision or authoritative clock. */
export async function updateCharacterCounters(
  database: Database,
  auth: AuthContext,
  characterId: string,
  input: unknown,
) {
  const id = z.string().uuid().parse(characterId),
    body = characterCountersCommandSchema.parse(input);
  const commandHash = createHash("sha256")
    .update(JSON.stringify(canonical({ id, ...body })))
    .digest("hex");
  try {
    return await database.transaction(async (transaction) => {
      const db = transaction as unknown as Database;
      await db.execute(
        sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`,
      );
      await lockInventoryGraph(transaction, auth.campaignId);
      await db.execute(
        sql`SELECT id FROM characters WHERE campaign_id=${auth.campaignId} AND id=${id} FOR UPDATE`,
      );
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
        const payload = action.payload as Record<string, unknown> | null;
        if (
          action.membershipId !== auth.membershipId ||
          action.type !== "character.counters" ||
          action.entityId !== id ||
          payload?.commandHash !== commandHash
        )
          throw new CharacterCountersError(409, {
            error: "ACTION_ID_CONFLICT",
          });
        const canonical = await loadCharacter();
        if (!(await canEditCharacter(canonical)))
          throw new CharacterCountersError(403, {
            error: "CHARACTER_FORBIDDEN",
          });
        return {
          duplicate: true as const,
          sequence: action.sequence,
          value: characterDto(
            canonical!,
            await loadCharacterEntries(db, id),
            await characterControllerIds(db, id),
            await campaignDefaultStatLayout(db, auth.campaignId),
          ),
        };
      };

      // Check the receipt before loading the entity. This ordering guarantees a
      // normal replay reads its character after the original transaction commit.
      const priorAction = await findAction(db, auth.campaignId, body.actionId);
      const character = await loadCharacter();
      if (!(await canEditCharacter(character)))
        throw new CharacterCountersError(403, { error: "CHARACTER_FORBIDDEN" });
      if (priorAction) return sendReplay(priorAction);
      if (character!.revision !== body.revision) {
        const racedAction = await findAction(
          db,
          auth.campaignId,
          body.actionId,
        );
        if (racedAction) return sendReplay(racedAction);
        throw new CharacterCountersError(409, {
          error: "CHARACTER_CONFLICT",
          revision: character!.revision,
        });
      }
      if (
        body.wallet &&
        body.wallet.sp !== normalizeCharacterWallet(character!.wallet).sp
      )
        throw new CharacterCountersError(409, {
          error: "USE_PROGRESSION_SP_LEDGER",
        });
      if (
        body.resources &&
        !sameInspiration(character!.resources, body.resources)
      )
        throw new CharacterCountersError(409, {
          error: "USE_INSPIRATION_ADJUSTMENT",
        });
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
        throw new CharacterCountersError(400, { error: "NO_COUNTER_CHANGES" });
      const changeDescription =
        changes || (body.rest === "SHORT" ? "короткий отдых" : "долгий отдых");
      const tableThread = await ensureStreamThread(
        db,
        auth.campaignId,
        "TABLE",
      );
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
                commandHash,
                wallet: body.wallet,
                resources: nextResources,
                rest: body.rest,
              },
            })
            .returning();
          if (!event || !message) throw new Error("EVENT_RECORD_FAILED");
          // An aggregated wallet line rewrites an existing message; there is
          // no point event for that, so it keeps the full broadcast.
          return {
            updated,
            message,
            event,
            aggregated: Boolean(aggregateData),
          };
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === "NO_COUNTER_CHANGES")
            return "NO_COUNTER_CHANGES" as const;
          throw error;
        });
      if (result === "NO_COUNTER_CHANGES")
        throw new CharacterCountersError(400, { error: "NO_COUNTER_CHANGES" });
      if (!result) {
        const racedAction = await findAction(
          db,
          auth.campaignId,
          body.actionId,
        );
        if (racedAction) return sendReplay(racedAction);
        throw new CharacterCountersError(409, { error: "CHARACTER_CONFLICT" });
      }
      const assignedEntries = await loadCharacterEntries(db, id),
        controllerIds = await characterControllerIds(db, id),
        statLayout = await campaignDefaultStatLayout(db, auth.campaignId);
      const value = characterDto(
        result.updated,
        assignedEntries,
        controllerIds,
        statLayout,
      );
      return {
        duplicate: false as const,
        value,
        sequence: result.event.sequence,
        notification: {
          full:
            result.aggregated ||
            !sameResourceImages(character!.resources, result.updated.resources),
          change: {
            character: result.updated,
            controllerIds,
            project: (visibleControllerIds: string[]) =>
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
          },
        },
      };
    });
  } catch (error) {
    if (["40001", "40P01"].includes(postgresErrorCode(error) ?? ""))
      throw new CharacterCountersError(409, { error: "CHARACTER_RETRY" });
    if (postgresErrorCode(error) === "23505")
      throw new CharacterCountersError(409, { error: "ACTION_ID_CONFLICT" });
    if (error instanceof Error && error.message === "ENTRY_CONFLICT")
      throw new CharacterCountersError(409, { error: "ENTRY_CONFLICT" });
    throw error;
  }
}
