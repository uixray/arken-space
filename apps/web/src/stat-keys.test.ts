import { describe, expect, it } from "vitest";
import {
  formulasReferencingKey,
  statKeyFromLabel,
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
