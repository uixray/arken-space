import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { entryDataSchema, entryRollRequestSchema } from "@arken/contracts";
import {
  characterCatalogEntries,
  catalogEntries,
  characters,
  chatMessages,
  gameEvents,
} from "@arken/db";
import type { AuthContext } from "./auth.js";
import {
  assertCreationEntryUsable,
  lockBoundCreationEntry,
} from "./creation-runtime-state.js";
import { requireCreationMember } from "./creation-state.js";
import { lockInventoryGraph } from "./inventory-assignment.js";
import { consumeCreationApplication } from "./creation-consumption.js";
import { entryApplicationHash,entryApplicationReceipt,EntryApplicationStateError,lockEntryApplication } from "./entry-application-state.js";
import { DiceFormulaError, rollFormulaWithMode } from "./dice.js";
import { selectDiceFrame } from "./dice-frame-selection.js";
import {
  characterRollStats,
  normalizeCharacterResources,
} from "./character-dto.js";
import {
  canAccessCharacter,
  campaignDefaultStatLayout,
} from "./character-access.js";
import { ensureStreamThread, chatMessageDto } from "./chat.js";
import { findAction } from "./action-lookup.js";
import { normalizeLegacyEntryData } from "./entry-data.js";
import { postgresErrorCode } from "./database-errors.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export class EntryRollError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly details: Record<string, unknown>,
  ) {
    super(String(details.error));
  }
  get statusCode() {
    return this.status;
  }
}
function numericSkillValue(data: unknown): number | undefined {
  if (!data || typeof data !== "object" || !("skillValue" in data))
    return undefined;
  const value = data.skillValue;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -1000 &&
    value <= 1000
    ? value
    : undefined;
}

/** Shared HTTP/peer execution. Lock the current actor/entry and receipt before
 * reading costs or drawing randomness. No transport owns an independent RNG path. */
export async function executeCharacterEntry(
  database: Database,
  auth: AuthContext,
  characterId: string,
  entryId: string,
  input: unknown,
) {
  const params = z
    .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
    .parse({ characterId, entryId });
  const body = entryRollRequestSchema.parse(input);
  const commandHash = entryApplicationHash(params.characterId,params.entryId,body);
  try {
    return await database.transaction(async (transaction) => {
      const db = transaction as unknown as Database;
      await db.execute(
        sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`,
      );
      await lockEntryApplication(transaction, auth.campaignId, body.actionId);
      await lockInventoryGraph(transaction, auth.campaignId);
      await db.execute(
        sql`SELECT id FROM characters WHERE campaign_id=${auth.campaignId} AND id=${params.characterId} FOR UPDATE`,
      );
      await db.execute(
        sql`SELECT e.id FROM character_catalog_entries e JOIN characters c ON c.id=e.character_id WHERE c.campaign_id=${auth.campaignId} AND e.character_id=${params.characterId} AND e.id=${params.entryId} FOR UPDATE OF e`,
      );
      const mode = body.mode ?? "EXECUTE";
      if (auth.role !== "GM" && body.visibility === "GM_ONLY")
        throw new EntryRollError(403, {
          error: "GM_ONLY_VISIBILITY_FORBIDDEN",
        });
      await requireCreationMember(transaction,auth);
      const [currentCharacter]=await db.select().from(characters).where(and(eq(characters.id,params.characterId),eq(characters.campaignId,auth.campaignId))).limit(1);
      if(!currentCharacter||!(await canAccessCharacter(db,auth,currentCharacter)))throw new EntryRollError(403,{error:"CHARACTER_ENTRY_FORBIDDEN"});
      const replay = await findAction(db, auth.campaignId, body.actionId);
      if (replay) {
        return {duplicate:true as const,receipt:entryApplicationReceipt(replay,auth.membershipId,commandHash,mode)};
      }
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
      if (!row)
        throw new EntryRollError(403, { error: "CHARACTER_ENTRY_FORBIDDEN" });


      if (
        body.entryRevision !== undefined &&
        body.entryRevision !== row.entry.revision
      )
        throw new EntryRollError(409, {
          error: "ENTRY_CONFLICT",
          revision: row.entry.revision,
        });
      const parsedData = entryDataSchema.safeParse(
        normalizeLegacyEntryData(row.entry.data),
      );
      if (!parsedData.success)
        throw new EntryRollError(400, { error: "INVALID_ENTRY_DATA" });
      // Area effects must never fall through to the legacy single-character
      // execution path (which would spend a use without applying the area).
      if (mode === "EXECUTE" && parsedData.data.areaEffect)
        throw new EntryRollError(409, {
          error: "AREA_EFFECT_REQUIRES_TARGETED_EXECUTION",
        });
      const rollsThread = await ensureStreamThread(
        db,
        auth.campaignId,
        "ROLLS",
      );
      let action:
        NonNullable<typeof parsedData.data.rollActions>[number] | undefined;
      const executeAll = mode === "EXECUTE" && body.executeAll === true;
      const orderedActions = executeAll
        ? (parsedData.data.rollActions ?? [])
            .map((candidate, index) => ({ candidate, index }))
            .sort(
              (a, b) =>
                a.candidate.order - b.candidate.order || a.index - b.index,
            )
            .map(({ candidate }) => candidate)
        : [];
      if (executeAll && row.entry.kind !== "ABILITY")
        throw new EntryRollError(400, {
          error: "EXECUTE_ALL_REQUIRES_ABILITY",
        });
      const noRollRequest =
        mode === "EXECUTE" && !body.rollActionId && !executeAll;
      const noRollActivation =
        mode === "EXECUTE" &&
        row.entry.kind === "ABILITY" &&
        (noRollRequest || (executeAll && orderedActions.length === 0));
      const activationConfig = parsedData.data.activation ?? {
        // Existing use counters are an explicit structured limit. Legacy
        // abilities without one remain free activations (never parse prose).
        consumeUse: Boolean(parsedData.data.uses),
      };
      let formula: string | null = null;
      let result: ReturnType<typeof rollFormulaWithMode> | null = null;
      const referencedEntries = new Map<
        string,
        typeof characterCatalogEntries.$inferSelect
      >();
      const rolledActions: Array<{
        action: NonNullable<typeof parsedData.data.rollActions>[number];
        formula: string;
        result: ReturnType<typeof rollFormulaWithMode>;
      }> = [];
      if (mode === "EXECUTE") {
        if (noRollActivation) {
          // No-roll ability activation remains a distinct path.
        } else if (noRollRequest && row.entry.kind === "SKILL") {
          const value = parsedData.data.skillValue;
          if (typeof value !== "number" || !Number.isFinite(value))
            throw new EntryRollError(400, {
              error: "SKILL_VALUE_NOT_CONFIGURED",
            });
          action = {
            id: "simple-skill-roll",
            kind: "CUSTOM",
            label: row.entry.name,
            dice: "1d20",
            modifiers: [{ type: "CONSTANT", value }],
            order: 0,
            advantage: false,
            consumeUse: false,
          };
        } else if (noRollRequest) {
          throw new EntryRollError(400, { error: "ENTRY_ROLL_NOT_CONFIGURED" });
        } else if (!executeAll) {
          action = parsedData.data.rollActions?.find(
            (candidate) => candidate.id === body.rollActionId,
          );
          if (!action)
            throw new EntryRollError(404, { error: "ROLL_ACTION_NOT_FOUND" });
        }
        const consumesUse = noRollActivation
          ? activationConfig.consumeUse
          : executeAll
            ? orderedActions.some((candidate) => candidate.consumeUse)
            : Boolean(action?.consumeUse);
        if (
          consumesUse &&
          (!parsedData.data.uses || parsedData.data.uses.current < 1)
        )
          throw new EntryRollError(409, { error: "NO_ABILITY_USES" });

        const actionsToRoll = executeAll
          ? orderedActions
          : action
            ? [action]
            : [];
        for (const currentAction of actionsToRoll) {
          const values: Record<string, number> = {};
          const formulaParts = [currentAction.dice];
          const characterStats = currentAction.modifiers.some(
            (source) => source.type === "CHARACTERISTIC",
          )
            ? characterRollStats(
                row.character,
                await campaignDefaultStatLayout(db, auth.campaignId),
              )
            : {};
          for (const [index, source] of currentAction.modifiers.entries()) {
            if (source.type === "CONSTANT") {
              formulaParts.push(String(source.value));
              continue;
            }
            if (source.type === "FORMULA") {
              const terms = source.formula.match(/[+-]?\d+/g);
              if (!terms)
                throw new EntryRollError(400, {
                  error: "INVALID_MODIFIER_FORMULA",
                });
              formulaParts.push(
                String(terms.reduce((sum, term) => sum + Number(term), 0)),
              );
              continue;
            }
            const key = `modifier_${index}`;
            let value: number | undefined;
            if (source.type === "CHARACTERISTIC") {
              value = characterStats[source.key];
            } else if (source.type === "ENTRY_VALUE") {
              value = parsedData.data.values?.[source.key];
            } else if (source.type === "SKILL") {
              if (source.scope === "LEGACY") {
                const legacySkills = Array.isArray(row.character.skills)
                  ? row.character.skills.filter((candidate): boolean => {
                      if (!candidate || typeof candidate !== "object")
                        return false;
                      const skill = candidate as Record<string, unknown>;
                      return (
                        skill.key === source.key &&
                        typeof skill.rank === "number" &&
                        Number.isFinite(skill.rank)
                      );
                    })
                  : [];
                if (legacySkills.length === 1) value = legacySkills[0]!.rank;
              } else if (source.scope === "CHARACTER_ENTRY") {
                const [referenced] = await db
                  .select({ entry: characterCatalogEntries })
                  .from(characterCatalogEntries)
                  .where(
                    and(
                      eq(characterCatalogEntries.id, source.key),
                      eq(characterCatalogEntries.characterId, row.character.id),
                      eq(characterCatalogEntries.kind, "SKILL"),
                    ),
                  )
                  .limit(1);
                if (referenced) {
                  const previous = referencedEntries.get(referenced.entry.id);
                  if (
                    previous &&
                    previous.revision !== referenced.entry.revision
                  )
                    throw new EntryRollError(409, { error: "ENTRY_CONFLICT" });
                  referencedEntries.set(referenced.entry.id, referenced.entry);
                }
                value = numericSkillValue(referenced?.entry.data);
              } else {
                const [assigned] = await db
                  .select({ entry: characterCatalogEntries })
                  .from(characterCatalogEntries)
                  .innerJoin(
                    catalogEntries,
                    eq(
                      characterCatalogEntries.sourceCatalogEntryId,
                      catalogEntries.id,
                    ),
                  )
                  .where(
                    and(
                      eq(characterCatalogEntries.characterId, row.character.id),
                      eq(
                        characterCatalogEntries.sourceCatalogEntryId,
                        source.key,
                      ),
                      eq(characterCatalogEntries.kind, "SKILL"),
                      eq(catalogEntries.kind, "SKILL"),
                      eq(catalogEntries.campaignId, auth.campaignId),
                    ),
                  )
                  .limit(1);
                if (assigned) {
                  const previous = referencedEntries.get(assigned.entry.id);
                  if (previous && previous.revision !== assigned.entry.revision)
                    throw new EntryRollError(409, { error: "ENTRY_CONFLICT" });
                  referencedEntries.set(assigned.entry.id, assigned.entry);
                }
                value = numericSkillValue(assigned?.entry.data);
              }
            }
            if (value === undefined || !Number.isFinite(value))
              throw new EntryRollError(400, {
                error: "MISSING_MODIFIER_SOURCE",
                source,
              });
            values[key] = value;
            formulaParts.push(key);
          }
          const currentFormula = formulaParts.join(" + ");
          const currentResult = {
            ...rollFormulaWithMode(
              currentFormula,
              values,
              body.rollMode ??
                (currentAction.advantage ? "ADVANTAGE" : "NORMAL"),
              randomInt,
              currentAction.label,
            ),
            styleFrame: await selectDiceFrame(db, {
              campaignId: auth.campaignId,
              membershipId: auth.membershipId,
              sourceCatalogEntryId: row.entry.sourceCatalogEntryId,
            }),
          };
          rolledActions.push({
            action: currentAction,
            formula: currentFormula,
            result: currentResult,
          });
        }
        if (!executeAll && rolledActions[0]) {
          formula = rolledActions[0].formula;
          result = rolledActions[0].result;
        }
      }
      const entryUsageCost =
        row.entry.kind === "ABILITY" ? parsedData.data.usageCost : undefined;
      let cost = undefined as
        NonNullable<typeof parsedData.data.usageCost> | undefined;
      if (mode === "EXECUTE") {
        if (entryUsageCost !== undefined) {
          cost = entryUsageCost ?? undefined;
        } else if (noRollActivation) {
          cost = activationConfig.cost;
        } else if (executeAll) {
          const actionCosts: Array<
            NonNullable<(typeof orderedActions)[number]["cost"]>
          > = orderedActions.flatMap((candidate) =>
            candidate.cost ? [candidate.cost] : [],
          );
          const distinctCosts = actionCosts.filter(
            (candidate, index) =>
              actionCosts.findIndex(
                (other) =>
                  other.type === candidate.type &&
                  other.amount === candidate.amount,
              ) === index,
          );
          if (distinctCosts.length > 1)
            throw new EntryRollError(400, {
              error: "ABILITY_ACTION_COST_MISMATCH",
              message: "Укажите общую стоимость способности",
            });
          cost = distinctCosts[0];
        } else {
          cost = action?.cost;
        }
      }
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
        throw new EntryRollError(409, {
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
        (noRollActivation
          ? activationConfig.consumeUse
          : executeAll
            ? orderedActions.some((candidate) => candidate.consumeUse)
            : Boolean(action?.consumeUse));
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
        ...(executeAll && rolledActions.length > 0
          ? {
              rolls: rolledActions.map(
                ({ action: rolledAction, formula, result }) => ({
                  action: {
                    id: rolledAction.id,
                    kind: rolledAction.kind,
                    label: rolledAction.label,
                    dice: rolledAction.dice,
                    advantage: rolledAction.advantage,
                    consumeUse: rolledAction.consumeUse,
                  },
                  formula,
                  result,
                }),
              ),
            }
          : {}),
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
      const saved = await db.transaction(async (tx) => {
        await lockEntryApplication(tx, auth.campaignId, body.actionId);
        if (mode === "EXECUTE" && referencedEntries.size) {
          await lockInventoryGraph(tx, auth.campaignId);
          await requireCreationMember(tx, auth);
        }
        const bound =
          mode === "EXECUTE" &&
          (await lockBoundCreationEntry(tx, auth, row.entry.id));
        let consumesCreation = false;
        {
          // Serialize all public dice with inspiration spending.
          // Keep the shared lock order consistent with existing rolls:
          // character resources first, then the catalog entry.
          await tx
            .select({ id: characters.id })
            .from(characters)
            .where(eq(characters.id, row.character.id))
            .for("update")
            .limit(1);
        }
        if (mode === "EXECUTE" && (bound || referencedEntries.size)) {
          const expected = new Map(referencedEntries);
          expected.set(row.entry.id, row.entry);
          const entries = await tx
            .select()
            .from(characterCatalogEntries)
            .where(inArray(characterCatalogEntries.id, [...expected.keys()]))
            .orderBy(asc(characterCatalogEntries.id))
            .for("update");
          if (
            entries.length !== expected.size ||
            entries.some(
              (entry) =>
                entry.characterId !== row.character.id ||
                entry.revision !== expected.get(entry.id)!.revision,
            )
          )
            throw new Error("ENTRY_CONFLICT_TX");
          for (const entry of entries) {
            const created = await assertCreationEntryUsable(
              tx,
              auth,
              entry,
              row.character,
            );
            if (
              created?.snapshot.entryData.creationConsumption ===
              "BOUND_ITEM_ON_APPLICATION"
            ) {
              if (entry.id !== row.entry.id)
                throw new Error("CREATION_CONSUMPTION_UNAVAILABLE");
              consumesCreation = true;
            }
          }
        }
        if (executeAll) {
          const [currentEntry] = await tx
            .select({ revision: characterCatalogEntries.revision })
            .from(characterCatalogEntries)
            .where(eq(characterCatalogEntries.id, row.entry.id))
            .for("update")
            .limit(1);
          if (!currentEntry || currentEntry.revision !== row.entry.revision)
            throw new Error("ENTRY_CONFLICT_TX");
        }
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
        const consumption = consumesCreation
          ? await consumeCreationApplication(
              tx,
              auth,
              row.entry,
              row.character,
              new Date(),
            )
          : undefined;
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
            dice: result
              ? {
                  ...result,
                  skillCard,
                  applicationUndo:
                    mode === "EXECUTE" ? { cancelled: false } : undefined,
                }
              : {
                  skillCard,
                  applicationUndo:
                    mode === "EXECUTE" ? { cancelled: false } : undefined,
                },
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
              commandHash,
              skillCard,
              messageId: message.id,
              undoReceipt:
                mode === "EXECUTE"
                  ? {
                      version: 1,
                      entry:
                        !consumption && (consumeUse || (cost && resourceKey))
                          ? {
                              id: row.entry.id,
                              beforeData: row.entry.data,
                              afterRevision: row.entry.revision + 1,
                            }
                          : null,
                      consumption,
                      characters:
                        cost && resourceKey
                          ? [
                              {
                                id: row.character.id,
                                beforeResources: row.character.resources,
                                afterRevision: row.character.revision + 1,
                              },
                            ]
                          : [],
                    }
                  : null,
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
      const dto = chatMessageDto(
        saved.message,
        auth.displayName,
        rollsThread.stream,
      );
      return {
        duplicate: false as const,
        dto,
        event: saved.event,
        receipt: {actionId:saved.event.actionId,messageId:saved.message.id},
        value: { ...(result ?? {}), skillCard, messageId: saved.message.id },
      };
    });
  } catch (error) {
    if(error instanceof EntryApplicationStateError)throw new EntryRollError(error.status,{error:error.code});
    if (error instanceof Error && error.message.startsWith("CREATION_"))
      throw new EntryRollError(409, { error: error.message });
    if (error instanceof Error && error.message === "ENTRY_CONFLICT_TX")
      throw new EntryRollError(409, { error: "ENTRY_CONFLICT" });
    if (error instanceof DiceFormulaError)
      throw new EntryRollError(400, { error: "INVALID_FORMULA" });
    if (["40001", "40P01"].includes(postgresErrorCode(error) ?? ""))
      throw new EntryRollError(409, { error: "ENTRY_RETRY" });
    if (postgresErrorCode(error) === "23505")
      throw new EntryRollError(409, { error: "ACTION_ID_CONFLICT" });
    throw error;
  }
}
