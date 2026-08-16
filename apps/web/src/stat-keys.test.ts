import { describe, expect, it } from "vitest";
import {
  formulasReferencingKey,
  moveStatRow,
  resourceCostLabels,
  rollableStatRows,
  statKeyFromLabel,
  statRowsFromLayout,
  uniqueStatKey,
} from "./stat-keys";

/**
 * Пригодность ключа для формул проверяется настоящим движком бросков, а не
 * копией его регулярки здесь: см. `tests/stat-keys-formula.test.ts`. Копия
 * разошлась бы с оригиналом ровно тогда, когда это важнее всего.
 */

describe("statKeyFromLabel", () => {
  it("строит ключ, пригодный для формулы, из русской подписи", () => {
    expect(statKeyFromLabel("Ловкость")).toBe("lovkost");
    expect(statKeyFromLabel("Ближний бой")).toBe("blizhniiBoi");
    expect(statKeyFromLabel("Реген Маны")).toBe("regenMany");
  });

  it("не склеивает разные подписи в один ключ", () => {
    // Пробел — граница слова, а не пустое место: иначе эти две совпали бы.
    expect(statKeyFromLabel("Ближний бой")).not.toBe(
      statKeyFromLabel("Ближнийбой"),
    );
  });

  it("не даёт ключу начаться с цифры", () => {
    expect(statKeyFromLabel("2-я рука")).toMatch(/^_/);
  });

  it("возвращает пустую строку, когда переводить нечего", () => {
    // Вызывающий код обязан это заметить и попросить другую подпись, а не
    // записать характеристику с пустым ключом.
    expect(statKeyFromLabel("—")).toBe("");
    expect(statKeyFromLabel("   ")).toBe("");
  });
});

describe("uniqueStatKey", () => {
  it("оставляет ключ как есть, если он свободен", () => {
    expect(uniqueStatKey("sila", ["lovkost"])).toBe("sila");
  });

  it("разводит полное совпадение суффиксом", () => {
    // «Ближний бой» и «Ближний Бой» дают один и тот же ключ — без суффикса
    // второй молча затёр бы значение первого.
    const first = statKeyFromLabel("Ближний бой");
    const second = statKeyFromLabel("Ближний Бой");
    expect(second).toBe(first);
    expect(uniqueStatKey(second, [first])).toBe(`${first}2`);
  });

  it("ищет дальше, пока не найдёт свободный", () => {
    expect(uniqueStatKey("sila", ["sila", "sila2", "sila3"])).toBe("sila4");
  });

  it("«Сила» и «Сила воли» и так не конфликтуют", () => {
    expect(statKeyFromLabel("Сила воли")).not.toBe(statKeyFromLabel("Сила"));
  });
});

describe("formulasReferencingKey", () => {
  const skills = [
    { name: "Меч", formula: "1d20 + sila" },
    { name: "Магия", formula: "1d20 + silaVoli + 2" },
    { name: "Торговля", formula: "1d20 + harizma" },
    { name: "Без формулы", formula: undefined },
  ];

  it("находит навыки, которые сломаются от удаления", () => {
    expect(formulasReferencingKey(skills, "sila").map((s) => s.name)).toEqual([
      "Меч",
    ]);
  });

  it("не считает ссылкой ключ, который лишь входит в другой", () => {
    // Главная ловушка: `sila` встречается внутри `silaVoli`, но ссылкой не
    // является. Иначе мастер не смог бы удалить характеристику из-за связи,
    // которой нет.
    const found = formulasReferencingKey(skills, "sila");
    expect(found.map((s) => s.name)).not.toContain("Магия");
  });

  it("находит ключ в начале, в конце и в середине формулы", () => {
    const entries = [
      { formula: "sila" },
      { formula: "sila + 1d6" },
      { formula: "1d20+sila" },
      { formula: "1d20 + sila + 2" },
    ];
    expect(formulasReferencingKey(entries, "sila")).toHaveLength(4);
  });

  it("возвращает пусто на пустом ключе, а не всё подряд", () => {
    expect(formulasReferencingKey(skills, "")).toEqual([]);
  });
});

describe("statRowsFromLayout", () => {
  const layout = [
    {
      id: "characteristics",
      rows: [
        { key: "sila", label: "Сила", source: "STAT" },
        { key: "udacha", label: "Удача", source: "STAT" },
      ],
    },
    {
      id: "combat",
      rows: [
        { key: "mana", label: "Мана", source: "RESOURCE" },
        { key: "melee", label: "Ближний бой", source: "STAT" },
      ],
    },
  ];

  it("собирает строки всех групп по порядку", () => {
    // Панель быстрых бросков строилась из стартовой раскладки, и строка,
    // добавленная мастером, кнопки не получала: карточка её показывала,
    // панель — нет.
    expect(statRowsFromLayout(layout).map((row) => row.key)).toEqual([
      "sila",
      "udacha",
      "melee",
    ]);
  });

  it("не даёт кнопку броска на пул ресурса", () => {
    // У «Маны» нет одного числа: бросок по ней взял бы не то значение.
    expect(statRowsFromLayout(layout).map((row) => row.key)).not.toContain(
      "mana",
    );
  });
});

describe("moveStatRow", () => {
  const layout = () => [
    {
      id: "characteristics",
      rows: [
        { key: "sila", label: "Сила", source: "STAT" },
        { key: "lovkost", label: "Ловкость", source: "STAT" },
        { key: "udacha", label: "Удача", source: "STAT" },
      ],
    },
    {
      id: "combat",
      rows: [
        { key: "iniciativa", label: "Инициатива", source: "STAT" },
        { key: "mana", label: "Мана", source: "RESOURCE" },
        { key: "melee", label: "Ближний бой", source: "STAT" },
      ],
    },
  ];
  const keys = (groups: ReturnType<typeof layout>, index: number) =>
    groups[index]!.rows.map((row) => row.key);

  it("меняет строку местами с соседней", () => {
    const moved = moveStatRow(layout(), "lovkost", "up")!;
    expect(keys(moved, 0)).toEqual(["lovkost", "sila", "udacha"]);
  });

  it("перешагивает строку, которой мастер не видит", () => {
    // Главная ловушка шага: между «Инициативой» и «Ближним боем» стоит «Мана»,
    // а карточка ресурсы не показывает. Обмен с невидимой строкой выглядел бы
    // как «кнопка нажалась, ничего не изменилось».
    const moved = moveStatRow(
      layout(),
      "melee",
      "up",
      (row) => row.source !== "RESOURCE",
    )!;
    expect(keys(moved, 1)).toEqual(["melee", "mana", "iniciativa"]);
  });

  it("не трогает соседнюю группу", () => {
    const moved = moveStatRow(layout(), "sila", "down")!;
    expect(keys(moved, 1)).toEqual(keys(layout(), 1));
  });

  it("возвращает null у края и на неизвестном ключе", () => {
    // Пустая правка иначе ушла бы на сервер, подняла ревизию кампании и
    // разошлась всем клиентам, ничего не изменив.
    expect(moveStatRow(layout(), "sila", "up")).toBeNull();
    expect(moveStatRow(layout(), "udacha", "down")).toBeNull();
    expect(moveStatRow(layout(), "нет-такого", "up")).toBeNull();
  });

  it("возвращает null, когда за краем только невидимые строки", () => {
    const single = [
      {
        id: "combat",
        rows: [
          { key: "mana", label: "Мана", source: "RESOURCE" },
          { key: "melee", label: "Ближний бой", source: "STAT" },
        ],
      },
    ];
    expect(
      moveStatRow(single, "melee", "up", (row) => row.source !== "RESOURCE"),
    ).toBeNull();
  });

  it("не меняет исходную раскладку", () => {
    // Раскладка приходит из снапшота: правка на месте испортила бы состояние,
    // которое React считает неизменным.
    const original = layout();
    moveStatRow(original, "lovkost", "up");
    expect(keys(original, 0)).toEqual(["sila", "lovkost", "udacha"]);
  });
});

describe("resourceCostLabels", () => {
  const layout = (rows: { key: string; label: string; source: string }[]) => [
    { id: "combat", rows },
  ];

  it("берёт имена ресурсов из раскладки, а не из кода", () => {
    // В форме способности стояли «Physical Power» и «Magic Power»: английские
    // строки в русском интерфейсе, да ещё и прежние имена ресурсов.
    expect(
      resourceCostLabels(
        layout([
          { key: "physicalPower", label: "Выносливость", source: "RESOURCE" },
          { key: "magicPower", label: "Мана", source: "RESOURCE" },
        ]),
      ),
    ).toEqual({ physical: "Выносливость", magic: "Мана" });
  });

  it("сопоставляет по ключу, а не по порядку строк", () => {
    // Мастер может переставить строки местами — стоимость обязана остаться на
    // своём ресурсе, иначе способность начнёт списывать не то.
    expect(
      resourceCostLabels(
        layout([
          { key: "magicPower", label: "Мана", source: "RESOURCE" },
          { key: "physicalPower", label: "Выносливость", source: "RESOURCE" },
        ]),
      ),
    ).toEqual({ physical: "Выносливость", magic: "Мана" });
  });

  it("подставляет имя по умолчанию, когда строки в раскладке нет", () => {
    // Мастер может убрать строку-ресурс из раскладки, но ключ стоимости
    // остаётся у уже созданных способностей: пустая подпись в списке была бы
    // хуже имени по умолчанию.
    expect(resourceCostLabels(layout([]))).toEqual({
      physical: "Выносливость",
      magic: "Мана",
    });
  });
});

/**
 * UIX-468. «Реген Маны» получил кнопку броска не по замыслу: UIX-424 сделала
 * набор производным от раскладки, а раскладка не различает, что бросают, а что
 * применяют.
 */
describe("строки, по которым имеет смысл бросать", () => {
  const rows = [
    { key: "agility", label: "Ловкость" },
    { key: "enduranceRegen", label: "Реген Выносливости" },
    { key: "manaRegen", label: "Реген Маны" },
    { key: "luck", label: "Удача" },
  ];

  it("убирает строки регена из набора кнопок", () => {
    expect(rollableStatRows(rows).map((row) => row.key)).toEqual([
      "agility",
      "luck",
    ]);
  });

  it("сохраняет порядок остальных строк", () => {
    // Порядок кнопок — часть раскладки: мастер расставляет их так, как ему
    // удобно тянуться на игре.
    expect(rollableStatRows(rows)[0]?.label).toBe("Ловкость");
    expect(rollableStatRows(rows).at(-1)?.label).toBe("Удача");
  });

  it("не трогает набор, в котором регена нет", () => {
    const plain = [{ key: "luck", label: "Удача" }];
    expect(rollableStatRows(plain)).toEqual(plain);
  });
});
