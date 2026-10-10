import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CharacterCatalogEntryDto } from "@arken/contracts";
import {
  CharacterActionCard,
  parseSkillCard,
  SkillChatCard,
  type SkillCard,
} from "./SkillCards";
import { CampaignStatLabelsProvider } from "./campaign-stat-labels-context";

function renderCard(card: SkillCard) {
  return renderToStaticMarkup(
    createElement(CampaignStatLabelsProvider, {
      layout: [
        {
          id: "characteristics",
          label: "Характеристики",
          rows: [
            { key: "agility", label: "Ловкость", source: "STAT" },
            { key: "strength", label: "Сила", source: "STAT" },
          ],
        },
      ],
      children: createElement(SkillChatCard, { card }),
    }),
  );
}

const dice = {
  total: 17,
  skillCard: {
    version: 1,
    execution: "EXECUTED",
    actor: { characterName: "Aria" },
    entry: {
      id: "entry-1",
      name: "Flame Lash",
      kind: "ABILITY",
      description: "A controlled burst.",
      revision: 4,
    },
    action: {
      id: "lash",
      label: "Attack",
      kind: "HIT",
      dice: "1d20",
      consumeUse: true,
    },
    formula: "1d20 + agility",
    result: { total: 17, resolvedFormula: "1d20 + 3" },
    uses: { before: 2, after: 1, max: 2, recharge: "DAY" },
  },
};

describe("parseSkillCard", () => {
  it("keeps a versioned immutable action snapshot", () => {
    expect(parseSkillCard(dice)).toMatchObject({
      mode: "EXECUTE",
      characterName: "Aria",
      entry: { name: "Flame Lash", revision: 4 },
      action: { id: "lash", formula: "1d20 + agility" },
      result: { total: 17 },
      uses: { before: 2, after: 1, max: 2 },
    });
  });

  it("identifies passive shares without an action or resource mutation", () => {
    expect(
      parseSkillCard({
        skillCard: {
          version: 1,
          execution: "SHARED",
          entry: { id: "entry-2", name: "Lore", kind: "SKILL" },
        },
      }),
    ).toMatchObject({ mode: "SHARE", action: null, uses: null });
  });

  it("accepts and renders an executed no-roll ability with its explicit resource receipt", () => {
    const card = parseSkillCard({
      skillCard: {
        version: 1,
        execution: "EXECUTED",
        entry: { id: "ward", name: "Ward", kind: "ABILITY", description: "Protect allies." },
        action: null,
        formula: null,
        result: null,
        uses: { before: 2, after: 1, max: 2, recharge: "DAY" },
        activationCost: { type: "physical", amount: 2, before: 5, after: 3 },
      },
    });
    expect(card).toMatchObject({ mode: "EXECUTE", action: null, result: null, activationCost: { before: 5, after: 3 } });
    const html = renderCard(card!);
    expect(html).toContain("Активировано без броска");
    expect(html).toContain("5 → 3");
    expect(html).not.toContain("Итог броска");
  });

  it("falls back for legacy, malformed, and unknown card versions", () => {
    expect(parseSkillCard({ total: 12 })).toBeNull();
    expect(parseSkillCard({ skillCard: { version: 2 } })).toBeNull();
    expect(
      parseSkillCard({
        skillCard: { version: 1, mode: "EXECUTE", entry: { id: "x" } },
      }),
    ).toBeNull();
  });

  it("retains a removed-source marker entirely from the event snapshot", () => {
    expect(
      parseSkillCard({
        ...dice,
        skillCard: {
          ...dice.skillCard,
          entry: { ...dice.skillCard.entry, sourceRemoved: true },
        },
      })?.entry.sourceRemoved,
    ).toBe(true);
  });

  it("parses the separate DTO skillCard projection", () => {
    expect(parseSkillCard({ skillCard: dice.skillCard })).toMatchObject({
      mode: "EXECUTE",
      entry: { name: "Flame Lash" },
      result: { total: 17 },
    });
  });
});

describe("SkillChatCard (UIX-389 formula humanization)", () => {
  const baseCard: SkillCard = {
    version: 1,
    mode: "EXECUTE",
    characterName: "Aria",
    entry: {
      id: "entry-1",
      name: "Flame Lash",
      kind: "ABILITY",
      description: "A controlled burst.",
      revision: 4,
      sourceCatalogEntryId: null,
      sourceRemoved: false,
    },
    action: {
      id: "lash",
      label: "Attack",
      kind: "HIT",
      formula: "1d20 + agility",
      modifiers: [],
    },
    result: { total: 17, breakdown: "1d20 + 3" },
    uses: null,
    activationCost: null,
  };

  it("never renders the raw stat key from the formula", () => {
    const html = renderCard(baseCard);
    expect(html).toContain("Ловкость");
    expect(html).not.toContain("agility");
  });

  it("humanizes every stat token for a multi-stat formula", () => {
    const html = renderCard({
      ...baseCard,
      action: { ...baseCard.action!, formula: "1d20 + strength + agility" },
    });
    expect(html).toContain("Сила");
    expect(html).toContain("Ловкость");
    expect(html).not.toContain("strength");
    expect(html).not.toContain("agility");
  });

  it("shows the resolved value instead of an internal modifier placeholder", () => {
    const html = renderCard({
      ...baseCard,
      action: { ...baseCard.action!, formula: "2d6 + modifier_0" },
      result: { total: 20, breakdown: "2d6 +17" },
    });
    expect(html).toContain("2d6 +17");
    expect(html).not.toContain("modifier_0");
  });

  it("uses a human-readable fallback when an old result has no breakdown", () => {
    const html = renderCard({
      ...baseCard,
      action: { ...baseCard.action!, formula: "2d6 + modifier_0" },
      result: { total: 20, breakdown: "" },
    });
    expect(html).toContain("2d6 + модификатор");
    expect(html).not.toContain("modifier_0");
  });

  it("renders an empty formula without throwing when there is no action", () => {
    const html = renderToStaticMarkup(
      createElement(SkillChatCard, {
        card: { ...baseCard, mode: "SHARE", action: null },
      }),
    );
    expect(html).toContain("Flame Lash");
  });
});

it("localizes a character ability formula without changing its stored action", () => {
  const entry = {
    id: "ability-1",
    kind: "ABILITY",
    name: "Огненная стрела",
    description: "",
    revision: 1,
    data: {
      rollActions: [
        {
          id: "damage",
          label: "Урон огнем",
          dice: "2d6 + agility",
        },
      ],
    },
  } as unknown as CharacterCatalogEntryDto;
  const html = renderToStaticMarkup(
    createElement(CampaignStatLabelsProvider, {
      layout: [
        {
          id: "characteristics",
          label: "Характеристики",
          rows: [{ key: "agility", label: "Ловкость", source: "STAT" }],
        },
      ],
      children: createElement(CharacterActionCard, {
        entry,
        disabled: false,
        onAction: async () => undefined,
      }),
    }),
  );
  expect(html).toContain("2d6 + Ловкость");
  expect(html).not.toContain("2d6 + agility");
  expect(entry.data.rollActions?.[0]?.dice).toBe("2d6 + agility");
});

it("keeps ability activation and passive share visible without a Details expander", () => {
  const entry = {
    id: "ability-2",
    kind: "ABILITY",
    name: "Защитная стойка",
    description: "На один раунд повышает защиту.",
    revision: 2,
    data: {
      uses: { current: 1, max: 1, recharge: "BATTLE" },
      rollActions: [
        {
          id: "stance",
          label: "Активировать стойку",
          kind: "CUSTOM",
          dice: "1d20",
          modifiers: [],
          advantage: false,
          consumeUse: true,
          cost: { type: "physical", amount: 2 },
          order: 0,
        },
      ],
    },
  } as unknown as CharacterCatalogEntryDto;
  const html = renderToStaticMarkup(
    createElement(CharacterActionCard, {
      entry,
      disabled: false,
      onAction: async () => undefined,
    }),
  );
  expect(html).toContain("Активировать стойку");
  expect(html).toContain("Выполнить · 1 использование");
  expect(html).toContain("Показать без выполнения");
  expect(html).not.toContain("Подробнее");
  expect(html).not.toContain(entry.description);
});
