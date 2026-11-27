import { CharacterCountersError } from "./character-counters-command.js";
import { EntryRollError } from "./entry-roll-command.js";
import { EntryRechargeError } from "./entry-recharge-command.js";
import { LocalPeerRejection } from "./local-ability-command.js";

const publicCodes = new Set([
  "ACTION_ID_CONFLICT", "CHARACTER_FORBIDDEN", "CHARACTER_ENTRY_FORBIDDEN",
  "CHARACTER_CONFLICT", "CHARACTER_RETRY", "ENTRY_CONFLICT", "ENTRY_CONFLICT_TX", "ENTRY_RETRY",
  "USE_PROGRESSION_SP_LEDGER", "USE_INSPIRATION_ADJUSTMENT", "NO_COUNTER_CHANGES",
  "GM_ONLY_VISIBILITY_FORBIDDEN", "INVALID_ENTRY_DATA", "AREA_EFFECT_REQUIRES_TARGETED_EXECUTION",
  "EXECUTE_ALL_REQUIRES_ABILITY", "ENTRY_ROLL_NOT_CONFIGURED", "ROLL_ACTION_NOT_FOUND",
  "NO_ABILITY_USES", "INSUFFICIENT_CHARACTER_RESOURCE", "ABILITY_ACTION_COST_MISMATCH",
  "INVALID_FORMULA", "INVALID_MODIFIER_FORMULA", "MISSING_MODIFIER_SOURCE", "SKILL_VALUE_NOT_CONFIGURED",
  "CREATION_CONSUMPTION_UNAVAILABLE", "CREATION_RECHARGE_REQUIRES_GM", "ENTRY_HAS_NO_USES",
]);

/** Only typed, allowlisted domain failures cross the boundary. In particular,
 * revision/details may contain private entity data and are never forwarded. */
export async function localCharacterCommand<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if ((error instanceof CharacterCountersError || error instanceof EntryRollError || error instanceof EntryRechargeError)
      && publicCodes.has(error.message)) {
      throw new LocalPeerRejection({status: error.status, code: error.message});
    }
    throw error;
  }
}
