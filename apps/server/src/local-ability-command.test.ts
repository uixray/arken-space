import {describe,it,expect} from "vitest";
import {z} from "zod";
import {localAbilityCommand} from "./local-ability-command.js";
describe("safe peer ability errors",()=>{
 it("distinguishes authoritative rejection from uncertain/conflicting results",async()=>{
  await expect(localAbilityCommand("AREA_APPLY",async()=>{throw Error("AREA_FORBIDDEN");})).rejects.toMatchObject({failure:{status:403,code:"AREA_FORBIDDEN"}});
  const conflict=await localAbilityCommand("AREA_APPLY",async()=>{throw Error("ACTION_CONFLICT");}).catch((error:unknown)=>error);expect(conflict).toMatchObject({failure:{status:409,code:"ACTION_CONFLICT"}});expect((conflict as any).failure).not.toHaveProperty("notApplied");
  await expect(localAbilityCommand("AREA_APPLY",async()=>{throw Object.assign(Error("private SQL"),{code:"40001"});})).rejects.toMatchObject({failure:{status:409,code:"AREA_RETRY"}});
 });
 it("never puts raw validation, SQL or private exception details in public error fields",async()=>{
  const failure=await localAbilityCommand("AREA_APPLY",async()=>z.number().parse("PRIVATE-DATA")).catch((error:unknown)=>error);expect((failure as any).failure).toEqual({status:400,code:"AREA_CONFIGURATION_INVALID",notApplied:true});expect(JSON.stringify((failure as any).failure)).not.toContain("PRIVATE-DATA");
  for(const name of ["constructor","toString","__proto__"]){const unknown=Error(name);await expect(localAbilityCommand("AREA_APPLY",async()=>{throw unknown;})).rejects.toBe(unknown);}
  const unknown=Error("PRIVATE SQL credential");await expect(localAbilityCommand("AREA_APPLY",async()=>{throw unknown;})).rejects.toBe(unknown);
 });
});
