import { describe, expect, it } from "vitest";
import {
  findStatKeyReferences,
  rejectDestructiveLayoutChange,
  removedStatKeys,
  type StatReferenceSources,
} from "./stat-layout.js";
import { statLayoutSchema } from "@arken/contracts";

/**
 * UIX-424, шаг 6. Проверка ссылок — единственное, что стоит между мастером и
 * броском, который откажет посреди игры. Поэтому здесь проверяются оба вида
 * ссылок и обе стороны ошибки: не найти существующую и найти несуществующую.
 */
const layout = (keys: string[], source: "STAT" | "RESOURCE" = "STAT") =>
  statLayoutSchema.parse([
    {
      id: "characteristics",
      label: "Характеристики",
      rows: keys.map((key) => ({ key, label: key, source })),
    },
  ]);

const empty: StatReferenceSources = { characters: [], catalogEntries: [] };

const withSkill = (formula: string): StatReferenceSources => ({
  characters: [
    {
      name: "Ллойд",
      skills: [{ name: "Меч", formula }],
      spells: [],
      entries: [],
    },
  ],
  catalogEntries: [],
});

const withModifier = (key: string): StatReferenceSources => ({
  characters: [],
  catalogEntries: [
    {
      name: "Лучезарный",
      data: {
        rollActions: [
          {
            id: "hit",
            modifiers: [{ type: "CHARACTERISTIC", key }],
          },
        ],
      },
    },
  ],
});

describe("поиск ссылок на характеристику", () => {
  it("находит ссылку в формуле навыка", () => {
    expect(findStatKeyReferences("sila", withSkill("1d20 + sila"))).toEqual([
      { kind: "SKILL", name: "Меч", owner: "Ллойд" },
    ]);
  });

  it("находит ссылку в модификаторе способности", () => {
    // Второй вид ссылки: способность указывает характеристику полем, а не
    // текстом. Проверив только формулы, сервер разрешил бы удалить
    // характеристику, на которой держится половина каталога.
    expect(findStatKeyReferences("sila", withModifier("sila"))).toEqual([
      { kind: "CATALOG_ENTRY", name: "Лучезарный" },
    ]);
  });

  it("не считает ссылкой ключ, который лишь входит в другой", () => {
    // Главная ловушка: `sila` встречается внутри `silaVoli`. Иначе мастер не
    // смог бы удалить характеристику из-за связи, которой нет.
    expect(findStatKeyReferences("sila", withSkill("1d20 + silaVoli"))).toEqual(
      [],
    );
  });

  it("не считает ссылкой совпадение ключа модификатора по префиксу", () => {
    expect(findStatKeyReferences("sila", withModifier("silaVoli"))).toEqual([]);
  });

  it("не спотыкается о запись, сохранённую в неизвестном виде", () => {
    // Данные записи читаются без разбора схемой намеренно: `parse` на записи
    // от старой версии означал бы «не разобрали — значит ссылок нет», а это
    // худший ответ для проверки, которая защищает игру.
    const broken: StatReferenceSources = {
      characters: [],
      catalogEntries: [
        { name: "Мусор", data: null },
        { name: "Строка", data: "не объект" },
        { name: "Без действий", data: { rollActions: "нет" } },
        { name: "С дырой", data: { rollActions: [null, { modifiers: null }] } },
      ],
    };
    expect(() => findStatKeyReferences("sila", broken)).not.toThrow();
    expect(findStatKeyReferences("sila", broken)).toEqual([]);
  });

  it("находит ссылки во всех местах сразу, а не в первом попавшемся", () => {
    // Мастеру нужен полный список: починив один навык, он не должен получить
    // тот же отказ ещё трижды.
    const sources: StatReferenceSources = {
      characters: [
        {
          name: "Ллойд",
          skills: [{ name: "Меч", formula: "1d20 + sila" }],
          spells: [{ name: "Огонь", formula: "2d6 + sila" }],
          entries: [
            {
              name: "Рывок",
              data: {
                rollActions: [
                  { modifiers: [{ type: "CHARACTERISTIC", key: "sila" }] },
                ],
              },
            },
          ],
        },
      ],
      catalogEntries: withModifier("sila").catalogEntries,
    };
    expect(findStatKeyReferences("sila", sources).map((r) => r.kind)).toEqual([
      "SKILL",
      "SPELL",
      "CHARACTER_ENTRY",
      "CATALOG_ENTRY",
    ]);
  });
});

describe("что раскладке позволено", () => {
  it("считает удалённым только то, чего нет нигде", () => {
    // Перенос строки между группами — не удаление, и требовать за него
    // проверки ссылок значило бы запретить перестановку.
    const current = statLayoutSchema.parse([
      {
        id: "characteristics",
        label: "A",
        rows: [{ key: "sila", label: "С" }],
      },
      { id: "combat", label: "B", rows: [] },
    ]);
    const moved = statLayoutSchema.parse([
      { id: "characteristics", label: "A", rows: [] },
      { id: "combat", label: "B", rows: [{ key: "sila", label: "С" }] },
    ]);
    expect(removedStatKeys(current, moved)).toEqual([]);
    expect(rejectDestructiveLayoutChange(current, moved, empty)).toBeNull();
  });

  it("разрешает удалить строку, на которую никто не ссылается", () => {
    expect(
      rejectDestructiveLayoutChange(
        layout(["sila", "lovkost"]),
        layout(["sila"]),
        withSkill("1d20 + sila"),
      ),
    ).toBeNull();
  });

  it("отказывает со списком, когда на строку ссылаются", () => {
    expect(
      rejectDestructiveLayoutChange(
        layout(["sila"]),
        layout([]),
        withSkill("1d20 + sila"),
      ),
    ).toEqual({
      error: "STAT_ROW_REFERENCED",
      key: "sila",
      references: [{ kind: "SKILL", name: "Меч", owner: "Ллойд" }],
    });
  });

  it("запрещает смену источника даже без ссылок", () => {
    // `STAT` берёт число из `stats`, `RESOURCE` — пул из `resources`.
    expect(
      rejectDestructiveLayoutChange(
        layout(["mana"], "RESOURCE"),
        layout(["mana"], "STAT"),
        empty,
      ),
    ).toEqual({ error: "STAT_SOURCE_CHANGED", key: "mana" });
  });
});
