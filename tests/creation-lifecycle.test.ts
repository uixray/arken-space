import { describe, expect, it } from "vitest";
import { creationOperationQuoteSchema, creationRecipeGraphHasCycle, creationRecipeSourceSchema,
  creationRefund, mergeCreationPaidBasis, type CreationRecipeSource } from "../packages/contracts/src/creation-lifecycle.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const point = (n: number, level = 1) => ({ versionId: id(n), level, stage: "CRAFTED" as const });
const base = { format: 1 as const, name: "Synthetic", reason: "QA", kind: "SKILL" as const,
  cost: { copper: 0, sp: 0, materials: [] }, refund: null };
const upgrade = (from: number, to: number): CreationRecipeSource =>
  ({ ...base, operation: "UPGRADE", inputs: [point(from)], output: point(to) });

describe("creation lifecycle conservation contracts", () => {
  it("rejects cycles across separately authored upgrade and merge recipes", () => {
    const merge: CreationRecipeSource = { ...base, operation: "MERGE", inputs: [point(2),point(3)], output: point(4) };
    expect(creationRecipeGraphHasCycle([upgrade(1,2),merge,upgrade(4,5)])).toBe(false);
    expect(creationRecipeGraphHasCycle([upgrade(1,2),merge,upgrade(4,1)])).toBe(true);
    expect(creationRecipeGraphHasCycle([upgrade(1,1)])).toBe(true);
  });
  it("never allows a material or object instance to be supplied twice", () => {
    const request = { characterId:id(1), recipeVersionId:id(2), inputObjectIds:[id(3)], materialPicks:[{instanceId:id(4),quantity:1}] };
    expect(creationOperationQuoteSchema.safeParse(request).success).toBe(true);
    expect(creationOperationQuoteSchema.safeParse({...request,inputObjectIds:[id(3),id(3)]}).success).toBe(false);
    expect(creationOperationQuoteSchema.safeParse({...request,materialPicks:[...request.materialPicks,...request.materialPicks]}).success).toBe(false);
  });
  it("limits refunds to a rounded-down fraction of the actual paid basis", () => {
    const input = mergeCreationPaidBasis([{copper:17,sp:3,materials:[{worldContentId:id(10),quantity:2}]},
      {copper:8,sp:2,materials:[{worldContentId:id(10),quantity:3},{worldContentId:id(11),quantity:1}]}]);
    expect(input).toEqual({copper:25,sp:5,materials:[{worldContentId:id(10),quantity:5},{worldContentId:id(11),quantity:1}]});
    expect(creationRefund(input,{copperBasisPoints:5000,spBasisPoints:5000,materialsBasisPoints:5000}))
      .toEqual({copper:12,sp:2,materials:[{worldContentId:id(10),quantity:2}]});
    for (const rate of [0,1,5000,9999]) for (let value=1;value<=100;value++) {
      const result=creationRefund({copper:value,sp:value,materials:[{worldContentId:id(10),quantity:value}]},
        {copperBasisPoints:rate,spBasisPoints:rate,materialsBasisPoints:rate});
      expect(result.copper).toBeLessThan(value);
      expect(result.sp).toBeLessThan(value);
      expect(result.materials[0]?.quantity ?? 0).toBeLessThan(value);
    }
  });
  it("rejects full refunds, malformed lifecycle operations and overflowing basis", () => {
    const source={...base,operation:"DISASSEMBLE",inputs:[point(1)],output:null,
      refund:{copperBasisPoints:10000,spBasisPoints:0,materialsBasisPoints:0}};
    expect(creationRecipeSourceSchema.safeParse(source).success).toBe(false);
    expect(creationRecipeSourceSchema.safeParse({...base,operation:"MERGE",inputs:[point(1)],output:point(2)}).success).toBe(false);
    expect(()=>mergeCreationPaidBasis([{copper:1_000_000_000_000,sp:0,materials:[]},{copper:1,sp:0,materials:[]}]))
      .toThrow("CREATION_BASIS_LIMIT");
  });
});
