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

// Starter contract. Replace labels and formulas with the final custom rules without
// changing the database or character-sheet renderer.
export const arkenSystem: SystemDefinition = {
  id: "arken-core",
  version: 1,
  name: "Arken Core",
  stats: [
    {
      key: "might",
      label: "Сила",
      shortLabel: "СИЛ",
      min: -5,
      max: 20,
      defaultValue: 1,
    },
    {
      key: "agility",
      label: "Ловкость",
      shortLabel: "ЛОВ",
      min: -5,
      max: 20,
      defaultValue: 1,
    },
    {
      key: "mind",
      label: "Разум",
      shortLabel: "РАЗ",
      min: -5,
      max: 20,
      defaultValue: 1,
    },
    {
      key: "spirit",
      label: "Дух",
      shortLabel: "ДУХ",
      min: -5,
      max: 20,
      defaultValue: 1,
    },
    {
      key: "presence",
      label: "Влияние",
      shortLabel: "ВЛЯ",
      min: -5,
      max: 20,
      defaultValue: 1,
    },
    {
      key: "health",
      label: "Здоровье",
      shortLabel: "ЗДР",
      min: 0,
      max: 999,
      defaultValue: 10,
    },
    {
      key: "focus",
      label: "Фокус",
      shortLabel: "ФОК",
      min: 0,
      max: 999,
      defaultValue: 6,
    },
  ],
  starterSkills: [
    { key: "observe", name: "Наблюдение", rank: 0, formula: "2d6 + mind" },
    { key: "move", name: "Манёвр", rank: 0, formula: "2d6 + agility" },
    { key: "endure", name: "Стойкость", rank: 0, formula: "2d6 + spirit" },
  ],
  starterSpells: [],
  quickRolls: [
    { key: "might", label: "Проверка силы", formula: "2d6 + might" },
    { key: "agility", label: "Проверка ловкости", formula: "2d6 + agility" },
    { key: "mind", label: "Проверка разума", formula: "2d6 + mind" },
  ],
};

export function createStarterCharacter() {
  return {
    stats: Object.fromEntries(
      arkenSystem.stats.map((stat) => [stat.key, stat.defaultValue]),
    ),
    skills: arkenSystem.starterSkills.map((skill) => ({ ...skill })),
    spells: arkenSystem.starterSpells.map((spell) => ({ ...spell })),
  };
}
