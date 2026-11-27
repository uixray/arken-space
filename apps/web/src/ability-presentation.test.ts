import { expect, it } from "vitest";
import type { CharacterCatalogEntryDto } from "@arken/contracts";
import { abilityDisplayName, abilityCost, groupAbilities } from "./ability-presentation";
const entry = (name:string) => ({id:name,name,data:{}} as CharacterCatalogEntryDto);
it("groups shared abilities without mutating the snapshot order", () => {
  const source=[entry("Школьные чары · Искра"),entry("Магический щит"),entry("Своя способность"),entry("Фокус")];
  const before=[...source];
  const groups=groupAbilities(source);
  expect(groups.map(g=>g.id)).toEqual(["unique","common","school"]);
  expect(groups.map(g=>g.entries.map(e=>e.name))).toEqual([["Своя способность"],["Фокус","Магический щит"],["Школьные чары · Искра"]]);
  expect(source).toEqual(before);
});
it("normalizes school labels and labels free abilities", () => {
  expect(abilityDisplayName("Школьные чары · Искра")).toBe("Искра (ШЧ)");
  expect(abilityDisplayName("Искра (ШЧ)")).toBe("Искра (ШЧ)");
  expect(abilityCost(entry("Фокус"))).toBe("0 маны");
});
