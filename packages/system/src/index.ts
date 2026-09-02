export interface StatDefinition {
  key: string;
  label: string;
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

/**
 * Числовые строки стартовой раскладки — те, что лежат в `characters.stats`.
 *
 * Строки `RESOURCE` сюда не попадают: их значение — пул с текущим и максимумом,
 * а не число, которое можно подставить в формулу. Кнопка быстрого броска на
 * такой строке дала бы бросок не по тому числу.
 */
const layoutStats = starterStatLayout.flatMap((group) =>
  group.rows.filter((row) => row.source === "STAT"),
);

/**
 * Границы числовой характеристики. Одни для всех строк: раскладка задаёт, какие
 * строки есть, но не их допустимый разброс.
 */
export const STAT_VALUE_RANGE = { min: -20, max: 20, defaultValue: 0 };

/**
 * UIX-425 — какая характеристика задаёт скорость восстановления ресурса.
 *
 * Отдых восстанавливает не «до максимума», а на величину регена из карточки
 * персонажа. Связь ресурса с его строкой регена не выводится из имени
 * (`physicalPower` против `enduranceRegen`), поэтому она записана явно.
 *
 * Ресурс, которого здесь нет, отдыхом не восстанавливается: правило системы
 * говорит «на величину регена», а у неизвестного ресурса регена нет. Мастер,
 * заведший свой ресурс, восстанавливает его вручную — счётчиками рядом с
 * бросками.
 */
export const RESOURCE_REGEN_STAT: Readonly<Record<string, string>> = {
  physicalPower: "enduranceRegen",
  magicPower: "manaRegen",
};

/**
 * Системные характеристики, от которых зависит восстановление ресурсов.
 *
 * Набор выводится из `RESOURCE_REGEN_STAT`, чтобы защита редактора раскладки и
 * формула отдыха не разошлись при добавлении нового системного ресурса.
 * Проверка идёт только по точному ключу: подпись мастер может менять свободно.
 */
export const SYSTEM_REGEN_STAT_KEYS: ReadonlySet<string> = new Set(
  Object.values(RESOURCE_REGEN_STAT),
);

export function isSystemRegenStatKey(key: string): boolean {
  return SYSTEM_REGEN_STAT_KEYS.has(key);
}

export const arkenSystem: SystemDefinition = {
  id: "arken-core",
  version: 2,
  name: "Arken Core",
  /**
   * Набор берётся из раскладки, а не из своего списка рядом. До UIX-424 список
   * здесь был отдельным, и удаление характеристики из одного места оставляло
   * кнопку быстрого броска в другом — она нажималась и отвечала «стат не
   * найден» посреди игры.
   */
  stats: layoutStats.map(({ key, label }) => ({
    key,
    label,
    ...STAT_VALUE_RANGE,
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
  quickRolls: layoutStats.map(({ key, label }) => ({
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
