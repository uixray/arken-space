import { describe, expect, it } from "vitest";
import {
  characterUpdateSchema,
  statLayoutSchema,
} from "../packages/contracts/src/index.js";
import {
  arkenSystem,
  starterStatLayout,
} from "../packages/system/src/index.js";
import { rollFormula } from "../apps/server/src/dice";
import { normalizeLegacyStats } from "../apps/server/src/entry-data";

/**
 * UIX-424, шаг 2b: стартовая раскладка — это то, что получит каждая новая
 * кампания. Ошибка в ней не всплывёт в разработке: контракт проверяет данные
 * при записи, а стартовое значение попадает в кампанию мимо этой проверки.
 * Поэтому оно проверяется здесь.
 */
describe("стартовая раскладка", () => {
  it("проходит контракт раскладки", () => {
    const result = statLayoutSchema.safeParse(starterStatLayout);
    expect(
      result.success ? null : JSON.stringify(result.error.issues),
    ).toBeNull();
  });

  it("состоит из семи характеристик и восьми боевых", () => {
    const parsed = statLayoutSchema.parse(starterStatLayout);
    const byId = new Map(parsed.map((group) => [group.id, group]));
    expect(byId.get("characteristics")!.rows).toHaveLength(7);
    expect(byId.get("combat")!.rows).toHaveLength(8);
  });

  it("не содержит того, что мастер убрал из бросков", () => {
    const keys = starterStatLayout.flatMap((group) =>
      group.rows.map((row) => row.key),
    );
    // «Выносливость» осталась, но ресурсом; характеристики с такими ключами
    // больше нет. «Знания» и «Сила магии» убраны совсем.
    expect(keys).not.toContain("endurance");
    expect(keys).not.toContain("knowledge");
    expect(keys.filter((key) => key === "magicPower")).toHaveLength(1);
  });

  it("помечает ресурсами ровно выносливость и ману", () => {
    const resources = starterStatLayout
      .flatMap((group) => group.rows)
      .filter((row) => "source" in row && row.source === "RESOURCE")
      .map((row) => row.key);
    expect(resources).toEqual(["physicalPower", "magicPower"]);
  });

  it("все ключи годятся для формул", () => {
    // Каждая строка рано или поздно окажется в формуле навыка или в
    // сгенерированной кнопке быстрого броска.
    for (const row of starterStatLayout.flatMap((group) => group.rows))
      expect(
        rollFormula(`1d2+${row.key}`, { [row.key]: 1 }, () => 0).total,
        row.label,
      ).toBe(2);
  });
});

/**
 * UIX-424, шаг 4: набор характеристик перестал быть закрытым, и это первое
 * изменение, которое видит пользователь. Проверяется не то, что список стал
 * другим, а два конкретных отказа, ради которых он менялся.
 */
describe("шаг 4: набор характеристик открыт", () => {
  it("принимает ключ, которого нет в стартовой раскладке", () => {
    // Мастер добавил свою строку — патч персонажа обязан её принять. Прежний
    // объект из одиннадцати полей отвергал такой патч, и добавить строку было
    // невозможно в принципе.
    const parsed = characterUpdateSchema.parse({
      stats: { blizhniiBoi: 3 },
    });
    expect(parsed.stats).toEqual({ blizhniiBoi: 3 });
  });

  it("не принимает ключ, который потом сломает формулу", () => {
    // Кириллица и пробел в ключе прошли бы в базу и упали бы при первом же
    // броске: движок формул принимает только латинский идентификатор.
    for (const key of ["Сила", "ближний бой", "2hand"])
      expect(
        characterUpdateSchema.safeParse({ stats: { [key]: 1 } }).success,
        key,
      ).toBe(false);
  });

  it("не оставляет быстрых бросков на удалённые характеристики", () => {
    // Ровно тот отказ, ради которого шаг 4 трогает и раскладку, и систему:
    // кнопка, пережившая свою характеристику, нажимается и отвечает «стат не
    // найден» посреди игры.
    const rolls = arkenSystem.quickRolls.map((roll) => roll.key);
    expect(rolls).not.toContain("endurance");
    expect(rolls).not.toContain("knowledge");
    expect(rolls).toContain("luck");
  });

  it("не делает быстрый бросок на пул ресурса", () => {
    // У «Маны» нет одного числа: бросок по ней взял бы не то значение либо не
    // нашёл бы стат вовсе.
    expect(arkenSystem.stats.map((stat) => stat.key)).not.toContain(
      "physicalPower",
    );
    expect(arkenSystem.quickRolls.map((roll) => roll.key)).not.toContain(
      "magicPower",
    );
  });

  it("выдаёт персонажу все строки раскладки, а не только старые", () => {
    // Персонаж из прежней кампании не имеет `luck` и `initiative` вовсе, а
    // движок формул ищет ключ прямым поиском. Без добора кнопка «Удача» у него
    // упала бы, хотя в раскладке строка есть.
    const legacy = normalizeLegacyStats({ strength: 4, endurance: 2 });
    for (const stat of arkenSystem.stats)
      expect(Number.isFinite(legacy[stat.key]), stat.key).toBe(true);
    expect(legacy.strength).toBe(4);
    // Значение снятой характеристики остаётся: по нему мастер чинит формулы.
    expect(legacy.endurance).toBe(2);
  });
});
