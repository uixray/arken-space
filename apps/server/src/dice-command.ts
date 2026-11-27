import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  characters,
  characterControllers,
  chatMessages,
  gameEvents,
} from "@arken/db";
import { diceRequestSchema } from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { rollFormulaWithMode } from "./dice.js";
import { selectDiceFrame } from "./dice-frame-selection.js";
import { characterRollStats } from "./character-dto.js";
import {
  campaignDefaultStatLayout,
  canAccessCharacter,
} from "./character-access.js";
import { normalizeLegacyFormula, normalizeLegacyStats } from "./entry-data.js";
import { ensureStreamThread, chatMessageDto } from "./chat.js";
import { findAction } from "./action-lookup.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export class DiceCommandError extends Error {
  constructor(
    readonly status: 403 | 409,
    code: string,
  ) {
    super(code);
  }
}
/** Shared HTTP/peer RNG + persistence. Retries never generate another result. */
export async function submitDiceRoll(
  db: Database,
  auth: AuthContext,
  input: unknown,
) {
  const body = diceRequestSchema.parse(input);
  const commandHash = createHash("sha256")
    .update(
      JSON.stringify({
        kind: "DICE_ROLL",
        formula: body.formula,
        rollMode: body.rollMode,
        visibility: body.visibility,
        characterId: body.characterId ?? null,
        label: body.label ?? null,
      }),
    )
    .digest("hex");
  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(
      sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`,
    );
    const duplicate = await findAction(tx, auth.campaignId, body.actionId);
    if (duplicate) {
      const payload = duplicate.payload as Record<string, unknown>;
      if (
        duplicate.type !== "dice.created" ||
        duplicate.membershipId !== auth.membershipId ||
        payload.serverCommandHash !== commandHash
      )
        throw new DiceCommandError(409, "ACTION_ID_CONFLICT");
      return { duplicate: true as const };
    }
    const rollsThread = await ensureStreamThread(tx, auth.campaignId, "ROLLS");
    let character = null;
    if (body.characterId) {
      [character] = await tx
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character || !(await canAccessCharacter(tx, auth, character)))
        throw new DiceCommandError(403, "CHARACTER_FORBIDDEN");
    } else if (auth.role === "PLAYER") {
      [character] = await tx
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
    if (character) {
      const [locked] = await tx
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, character.id),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .for("update");
      if (!locked || !(await canAccessCharacter(tx, auth, locked)))
        throw new DiceCommandError(403, "CHARACTER_FORBIDDEN");
      character = locked;
    }
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
              await campaignDefaultStatLayout(tx, auth.campaignId),
            )
          : normalizeLegacyStats(undefined),
        body.rollMode ?? "NORMAL",
        randomInt,
        rollLabel,
      ),
      // UIX-457: у чистого броска нет навыка — только рамка игрока.
      styleFrame: await selectDiceFrame(tx, {
        campaignId: auth.campaignId,
        membershipId: auth.membershipId,
      }),
    };
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
        payload: { ...dto, serverCommandHash: commandHash },
      })
      .returning();
    if (!event) throw new Error("EVENT_RECORD_FAILED");
    return { duplicate: false as const, row, dto, event };
  });
}
