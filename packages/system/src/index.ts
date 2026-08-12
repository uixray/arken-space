export interface StatDefinition {
  key: string;
  label: string;
  shortLabel: string;
  min: number;
  max: number;
  defaultValue: number;
}
export interface SystemDefinition {
  id: string;
  version: number;
  name: string;
  stats: StatDefinition[];
  starterSkills: Array<{
    key: string;
    name: string;
    rank: number;
    formula: string;
  }>;
  starterSpells: Array<{
    key: string;
    name: string;
    description: string;
    formula?: string;
  }>;
  quickRolls: Array<{ key: string; label: string; formula: string }>;
}

const fixedStats = [
  ["strength", "Сила", "СИЛ"],
  ["agility", "Ловкость", "ЛОВ"],
  ["endurance", "Выносливость", "ВЫН"],
  ["vitality", "Живучесть", "ЖИВ"],
  ["knowledge", "Знания", "ЗНА"],
  ["intelligence", "Интеллект", "ИНТ"],
  ["willpower", "Сила воли", "ВОЛ"],
  ["charisma", "Харизма", "ХАР"],
  [
    "reaction",
    "\u0420\u0435\u0430\u043a\u0446\u0438\u044f",
    "\u0420\u0415\u0410",
  ],
  [
    "attention",
    "\u0412\u043d\u0438\u043c\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c",
    "\u0412\u041d\u041c",
  ],

  [
    "magicPower",
    "\u0421\u0438\u043b\u0430 \u043c\u0430\u0433\u0438\u0438",
    "\u041c\u0410\u0413",
  ],
] as const;

/**
 * UIX-424 — стартовая раскладка характеристик новой кампании.
 *
 * Две группы, а не четыре: здесь описано только то, что хранится в
 * `characters.stats`. Навыки лежат своим массивом у персонажа, таланты — это
 * записи каталога; их группы в карточке наполняются из другого места.
 *
 * Отличия от прежнего набора из одиннадцати характеристик — решения мастера:
 *  - «Выносливость» и «Знания» перестали быть тем, что бросают. Выносливость
 *    стала ресурсом, который тратят каждый ход, знания убраны совсем;
 *  - «Сила магии» заменена навыком «Магия» — он и есть модификатор бросков;
 *  - добавлена «Удача».
 *
 * Строки `RESOURCE` показывают пул из `characters.resources`, а не число из
 * `stats`. Ключи ресурсов остались прежними (`physicalPower`, `magicPower`):
 * переименование — это подписи, а менять ключи значило бы мигрировать и записи
 * ресурсов, и все `cost.type` в способностях ради имени, которого никто не
 * видит.
 */
export interface StarterStatRow {
  key: string;
  label: string;
  source: "STAT" | "RESOURCE";
}
export interface StarterStatGroup {
  id: "characteristics" | "combat" | "skills" | "talents";
  label: string;
  rows: StarterStatRow[];
}

export const starterStatLayout: StarterStatGroup[] = [
  {
    id: "characteristics",
    label: "Характеристики",
    rows: [
      { key: "strength", label: "Сила", source: "STAT" },
      { key: "agility", label: "Ловкость", source: "STAT" },
      { key: "vitality", label: "Живучесть", source: "STAT" },
      { key: "intelligence", label: "Интеллект", source: "STAT" },
      { key: "charisma", label: "Харизма", source: "STAT" },
      { key: "willpower", label: "Сила воли", source: "STAT" },
      { key: "luck", label: "Удача", source: "STAT" },
    ],
  },
  {
    id: "combat",
    label: "Боевые характеристики",
    rows: [
      { key: "initiative", label: "Инициатива", source: "STAT" },
      { key: "reaction", label: "Реакция", source: "STAT" },
      { key: "physicalPower", label: "Выносливость", source: "RESOURCE" },
      { key: "magicPower", label: "Мана", source: "RESOURCE" },
      { key: "melee", label: "Ближний бой", source: "STAT" },
      { key: "ranged", label: "Дальний бой", source: "STAT" },
      { key: "enduranceRegen", label: "Реген Выносливости", source: "STAT" },
      { key: "manaRegen", label: "Реген Маны", source: "STAT" },
    ],
  },
];

export const arkenSystem: SystemDefinition = {
  id: "arken-core",
  version: 2,
  name: "Arken Core",
  stats: fixedStats.map(([key, label, shortLabel]) => ({
    key,
    label,
    shortLabel,
    min: -20,
    max: 20,
    defaultValue: 0,
  })),
  starterSkills: [
    {
      key: "melee-strike",
      name: "\u0423\u0434\u0430\u0440 \u0431\u043b\u0438\u0436\u043d\u0438\u043c \u043e\u0440\u0443\u0436\u0438\u0435\u043c",
      rank: 0,
      formula: "1d20 + strength",
    },
    {
      key: "ranged-strike",
      name: "\u0423\u0434\u0430\u0440 \u0434\u0430\u043b\u044c\u043d\u0438\u043c \u043e\u0440\u0443\u0436\u0438\u0435\u043c",
      rank: 0,
      formula: "1d20 + agility",
    },
  ],
  starterSpells: [],
  quickRolls: fixedStats.map(([key, label]) => ({
    key,
    label,
    formula: `1d20 + ${key}`,
  })),
};

export function createStarterCharacter() {
  return {
    stats: Object.fromEntries(
      arkenSystem.stats.map((stat) => [stat.key, stat.defaultValue]),
    ),
    skills: arkenSystem.starterSkills,
    spells: [],
    resources: {
      physicalPower: { current: 10, maximum: 10 },
      magicPower: { current: 10, maximum: 10 },
    },
  };
}
