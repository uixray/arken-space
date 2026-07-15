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
] as const;

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
  starterSkills: [],
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
    skills: [],
    spells: [],
  };
}
