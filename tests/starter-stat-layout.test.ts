import { describe, expect, it } from "vitest";
import { statLayoutSchema } from "../packages/contracts/src/index.js";
import { starterStatLayout } from "../packages/system/src/index.js";
import { rollFormula } from "../apps/server/src/dice";

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
