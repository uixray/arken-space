import { describe, expect, it } from "vitest";
import type { CharacterDto } from "@arken/contracts";
import {
  characterWorkspaceReducer,
  createCharacterWorkspaceState,
  extractCharacterTemplateFields,
  MAX_OPEN_CHARACTER_SHEETS,
  uniqueCharacterIds,
} from "./character-workspace-state";

function makeCharacter(overrides: Partial<CharacterDto> = {}): CharacterDto {
  return {
    id: "source-1",
    name: "Тестовый персонаж",
    ownerMembershipId: "member-1",
    controllerMembershipIds: ["member-1"],
    portraitAssetId: "asset-1",
    stats: { strength: 3, agility: 2 },
    skills: [
      { key: "stealth", name: "Скрытность", rank: 1, formula: "1d20 + agility" },
    ],
    spells: [
      {
        key: "spark",
        name: "Искра",
        description: "Малая искра",
        formula: "1d4",
      },
    ],
    notes: "Личные заметки, не должны копироваться",
    backstory: "Личная предыстория, не должна копироваться",
    inventory: ["Верёвка", "Фонарь"],
    resources: {
      physicalPower: { current: 8, maximum: 10 },
      magicPower: { current: 4, maximum: 6, description: "Мана" },
    },
    wallet: { gold: 42, silver: 0, copper: 0, sp: 0 },
    entries: [],
    revision: 3,
    ...overrides,
  };
}

describe("character workspace state", () => {
  it("opens, focuses and restores a collapsed sheet", () => {
    let state = createCharacterWorkspaceState(["one", "two"]);
    state = characterWorkspaceReducer(state, { type: "OPEN", id: "two" });
    state = characterWorkspaceReducer(state, { type: "COLLAPSE", id: "two" });
    expect(state).toMatchObject({ activeId: "one", collapsedIds: ["two"] });

    state = characterWorkspaceReducer(state, { type: "RESTORE", id: "two" });
    expect(state).toMatchObject({ activeId: "two", collapsedIds: [] });
  });

  it("opens a token-linked character exclusively without changing deliberate multi-card behavior", () => {
    let state = createCharacterWorkspaceState(["one", "two", "three"]);
    state = characterWorkspaceReducer(state, { type: "OPEN", id: "two" });
    state = characterWorkspaceReducer(state, {
      type: "OPEN_EXCLUSIVE",
      id: "three",
    });
    expect(state).toEqual({
      openIds: ["three"],
      activeId: "three",
      collapsedIds: [],
    });
  });

  it("keeps the deck bounded and does not silently replace an open sheet", () => {
    let state = createCharacterWorkspaceState(["one"]);
    for (const id of ["two", "three", "four"]) {
      state = characterWorkspaceReducer(state, { type: "OPEN", id });
    }

    expect(state.openIds).toEqual(["one", "two", "three"]);
    expect(state.openIds).toHaveLength(MAX_OPEN_CHARACTER_SHEETS);
  });

  it("moves focus when the active sheet is collapsed or closed", () => {
    let state = createCharacterWorkspaceState(["one", "two"]);
    state = characterWorkspaceReducer(state, { type: "OPEN", id: "two" });
    state = characterWorkspaceReducer(state, { type: "COLLAPSE", id: "two" });
    expect(state.activeId).toBe("one");

    state = characterWorkspaceReducer(state, { type: "CLOSE", id: "one" });
    expect(state).toEqual({
      openIds: ["two"],
      activeId: "two",
      collapsedIds: ["two"],
    });
  });

  it("removes sheets that are no longer supplied by the server", () => {
    let state = createCharacterWorkspaceState(["one", "two"]);
    state = characterWorkspaceReducer(state, { type: "OPEN", id: "two" });
    state = characterWorkspaceReducer(state, { type: "SYNC", ids: ["one"] });
    expect(state).toEqual({
      openIds: ["one"],
      activeId: "one",
      collapsedIds: [],
    });
  });
});

describe("character rail identity", () => {
  it("deduplicates the same character delivered by HTTP and realtime", () => {
    expect(uniqueCharacterIds(["one", "two", "one"])).toEqual(["one", "two"]);
  });
});

describe("character template fields", () => {
  it("pre-fills structural fields from the source character only", () => {
    const source = makeCharacter();
    const template = extractCharacterTemplateFields(source);

    expect(template).toEqual({
      stats: { strength: 3, agility: 2 },
      skills: [
        {
          key: "stealth",
          name: "Скрытность",
          rank: 1,
          formula: "1d20 + agility",
        },
      ],
      spells: [
        {
          key: "spark",
          name: "Искра",
          description: "Малая искра",
          formula: "1d4",
        },
      ],
      inventory: ["Верёвка", "Фонарь"],
      resources: {
        physicalPower: { current: 8, maximum: 10 },
        magicPower: { current: 4, maximum: 6, description: "Мана" },
      },
    });
    // Identity, narrative and wallet fields must never be carried over by a template.
    expect(template).not.toHaveProperty("name");
    expect(template).not.toHaveProperty("portraitAssetId");
    expect(template).not.toHaveProperty("ownerMembershipId");
    expect(template).not.toHaveProperty("notes");
    expect(template).not.toHaveProperty("backstory");
    expect(template).not.toHaveProperty("wallet");
  });

  it("produces a deep-cloned preset independent of the source character", () => {
    const source = makeCharacter();
    const template = extractCharacterTemplateFields(source);

    // Mutating the source after extraction must never affect the derived preset.
    source.stats.strength = 99;
    source.skills.push({
      key: "new-skill",
      name: "Новый навык",
      rank: 5,
      formula: "1d20",
    });
    source.inventory.push("Новый предмет");
    source.resources.physicalPower!.current = 0;

    expect(template.stats.strength).toBe(3);
    expect(template.skills).toHaveLength(1);
    expect(template.inventory).toEqual(["Верёвка", "Фонарь"]);
    expect(template.resources.physicalPower?.current).toBe(8);

    // Mutating the derived preset must never affect the source character either.
    template.stats.strength = -1;
    template.inventory.push("Только в шаблоне");
    expect(source.stats.strength).toBe(99); // already mutated above, unaffected by this line
    expect(source.inventory).not.toContain("Только в шаблоне");
  });
});
