import { describe, expect, it } from "vitest";
import { localCharacterCommand } from "./local-character-command.js";
import { CharacterCountersError } from "./character-counters-command.js";
import { EntryRollError } from "./entry-roll-command.js";
import { EntryRechargeError } from "./entry-recharge-command.js";
describe("safe peer character rejections", () => {
  it("forwards typed public codes without entity details or a fabricated notApplied", async () => {
    for (const error of [new CharacterCountersError(409, {error:"CHARACTER_CONFLICT",revision:99,private:"secret"}),
      new EntryRollError(404, {error:"ROLL_ACTION_NOT_FOUND",private:"secret"}),
      new EntryRechargeError(403,"CHARACTER_ENTRY_FORBIDDEN",99)]) {
      const result = await localCharacterCommand(async () => {throw error;}).catch(e => e);
      expect(result.failure).toEqual({status:error.status,code:error.message});
      expect(JSON.stringify(result.failure)).not.toContain("secret");
      expect(result.failure).not.toHaveProperty("notApplied");
    }
  });
  it("keeps unknown typed codes, plain errors and database failures masked", async () => {
    for (const error of [new EntryRollError(400,{error:"PRIVATE_SQL"}), Error("ENTRY_CONFLICT"), Object.assign(Error("private"),{code:"EPIPE"})])
      await expect(localCharacterCommand(async()=>{throw error;})).rejects.toBe(error);
  });
});
