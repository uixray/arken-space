import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  campaigns,
  characters,
  characterCatalogEntries,
  chatMessages,
  gameEvents,
} from "@arken/db";
import { entryDataSchema, rechargeEntryCommandSchema } from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { canAccessCharacter } from "./character-access.js";
import { lockInventoryGraph } from "./inventory-assignment.js";
import { lockBoundCreationEntry } from "./creation-runtime-state.js";
import { normalizeLegacyEntryData } from "./entry-data.js";
import { ensureStreamThread } from "./chat.js";
import { findAction } from "./action-lookup.js";
import { z } from "zod";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export class EntryRechargeError extends Error {
  get statusCode(){return this.status;}
  constructor(
    readonly status: 400 | 403 | 409,
    code: string,
    readonly revision?: number,
  ) {
    super(code);
  }
}
/** One command for HTTP and peer. Authorization and state are reread under the
 * same campaign/graph/entry fence as the receipt and write, never before it. */
export async function rechargeCharacterEntry(
  db: Database,
  auth: AuthContext,
  characterId: string,
  entryId: string,
  input: unknown,
) {
  const ids = z
    .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
    .parse({ characterId, entryId });
  const body = rechargeEntryCommandSchema.strict().parse(input);
  const commandHash = createHash("sha256")
    .update(JSON.stringify({ ...ids, ...body }))
    .digest("hex");
  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(
      sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`,
    );
    await lockInventoryGraph(transaction, auth.campaignId);
    const [row] = await tx
      .select({ character: characters, entry: characterCatalogEntries })
      .from(characterCatalogEntries)
      .innerJoin(
        characters,
        eq(characterCatalogEntries.characterId, characters.id),
      )
      .where(
        and(
          eq(characters.id, characterId),
          eq(characterCatalogEntries.id, entryId),
          eq(characters.campaignId, auth.campaignId),
        ),
      )
      .for("update")
      .limit(1);
    if (!row || !(await canAccessCharacter(tx, auth, row.character)))
      throw new EntryRechargeError(403, "CHARACTER_ENTRY_FORBIDDEN");
    const existing = await findAction(tx, auth.campaignId, body.actionId);
    if (existing) {
      const payload = existing.payload as Record<string, unknown> | null;
      if (
        existing.membershipId !== auth.membershipId ||
        existing.type !== "entry.recharged" ||
        existing.entityId !== entryId ||
        payload?.commandHash !== commandHash
      )
        throw new EntryRechargeError(409, "ACTION_ID_CONFLICT");
      return { duplicate: true as const };
    }
    if (row.entry.revision !== body.revision)
      throw new EntryRechargeError(409, "ENTRY_CONFLICT", row.entry.revision);
    const parsed = entryDataSchema.safeParse(
      normalizeLegacyEntryData(row.entry.data),
    );
    if (!parsed.success || !parsed.data.uses)
      throw new EntryRechargeError(400, "ENTRY_HAS_NO_USES");
    const bound = await lockBoundCreationEntry(transaction, auth, entryId);
    if (bound && auth.role !== "GM")
      throw new EntryRechargeError(409, "CREATION_RECHARGE_REQUIRES_GM");
    const [clock] = await tx
      .select({ day: campaigns.day, battleCounter: campaigns.battleCounter })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!clock) throw Error("CAMPAIGN_NOT_FOUND");
    const uses = {
      ...parsed.data.uses,
      current: parsed.data.uses.max,
      ...(["DAY", "WEEK"].includes(parsed.data.uses.recharge)
        ? { lastRechargeDay: clock.day }
        : {}),
      ...(parsed.data.uses.recharge === "BATTLE"
        ? { lastBattleCounter: clock.battleCounter }
        : {}),
    };
    const [updated] = await tx
      .update(characterCatalogEntries)
      .set({
        data: { ...parsed.data, uses },
        revision: row.entry.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(characterCatalogEntries.id, entryId),
          eq(characterCatalogEntries.revision, body.revision),
        ),
      )
      .returning();
    if (!updated) throw new EntryRechargeError(409, "ENTRY_CONFLICT");
    const thread = await ensureStreamThread(tx, auth.campaignId, "TABLE");
    await tx
      .insert(chatMessages)
      .values({
        campaignId: auth.campaignId,
        membershipId: auth.membershipId,
        characterId,
        kind: "SYSTEM",
        threadId: thread.id,
        visibility: "PUBLIC",
        body: `${auth.displayName}: ${row.entry.name} перезаряжена (${uses.max}/${uses.max})`,
      });
    await tx
      .insert(gameEvents)
      .values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "entry.recharged",
        entityType: "character_catalog_entry",
        entityId: entryId,
        entityRevision: updated.revision,
        payload: { commandHash },
      });
    return { updated, duplicate: false as const };
  });
}
