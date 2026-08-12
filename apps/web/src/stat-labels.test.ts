import { describe, expect, it } from "vitest";
import { statLabelsFromLayout } from "./stat-keys";
import { starterStatLayout } from "@arken/system";

/**
 * UIX-424, шаг 3: один источник подписей вместо пяти копий.
 *
 * Копий было именно пять, и одна из них — восемь литералов в контракте
 * (`modifierSourceSchema`) — не просто отстала, а **ограничивала поведение**:
 * мастер не мог привязать способность к реакции, внимательности и силе магии,
 * хотя система их определяла. Форма показывала восемь не по недосмотру, а
 * потому что больше ей не позволял контракт.
 */
describe("подписи характеристик из раскладки", () => {
  it("отдаёт каждую строку-число из всех групп", () => {
    const labels = statLabelsFromLayout(starterStatLayout);
    expect(labels.strength).toBe("Сила");
    expect(labels.luck).toBe("Удача");
    // Из боевой группы — тоже: раньше формула способности не могла сослаться на
    // реакцию вовсе.
    expect(labels.reaction).toBe("Реакция");
    expect(labels.manaRegen).toBe("Реген Маны");
  });

  it("не отдаёт строки-ресурсы", () => {
    // Выносливость и мана — пулы с текущим и максимумом. В формуле броска им
    // не место, и предлагать их как модификатор значило бы обещать бросок,
    // который возьмёт не то число.
    const labels = statLabelsFromLayout(starterStatLayout);
    expect(labels.physicalPower).toBeUndefined();
    expect(labels.magicPower).toBeUndefined();
  });

  it("отдаёт ровно столько подписей, сколько нересурсных строк в раскладке", () => {
    const rows = starterStatLayout
      .flatMap((group) => group.rows)
      .filter((row) => row.source !== "RESOURCE");
    expect(Object.keys(statLabelsFromLayout(starterStatLayout))).toHaveLength(
      rows.length,
    );
  });

  it("пустая раскладка даёт пустой список, а не умолчания", () => {
    // Молчаливая подстановка старого списка вернула бы ровно ту проблему,
    // ради которой всё это делается.
    expect(statLabelsFromLayout([])).toEqual({});
  });
});
