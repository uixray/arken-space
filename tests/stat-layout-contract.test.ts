import { describe, expect, it } from "vitest";
import {
  statLayoutSchema,
  STAT_KEY_PATTERN,
} from "../packages/contracts/src/index.js";
import { rollFormula } from "../apps/server/src/dice";
import { statKeyFromLabel } from "../apps/web/src/stat-keys";

/**
 * UIX-424, шаг 2: раскладка описывает, как показывается плоская запись
 * `characters.stats`. Отсюда два инварианта, которые ниже и проверяются, —
 * оба про то, что расхождение будет молчаливым.
 */
const group = (id: "characteristics" | "combat", rows: unknown[]) => ({
  id,
  label: "Группа",
  rows,
});

describe("раскладка характеристик", () => {
  it("принимает обычную строку и строку-ресурс", () => {
    const parsed = statLayoutSchema.parse([
      group("characteristics", [{ key: "sila", label: "Сила" }]),
      group("combat", [
        { key: "iniciativa", label: "Инициатива" },
        { key: "mana", label: "Мана", source: "RESOURCE" },
      ]),
    ]);
    // Источник по умолчанию — обычное число: строк-ресурсов всего две, и
    // объявлять их явно дешевле, чем каждую строку.
    expect(parsed[0]!.rows[0]!.source).toBe("STAT");
    expect(parsed[1]!.rows[1]!.source).toBe("RESOURCE");
  });

  it("отвергает один ключ в двух группах", () => {
    // Две строки, редактирующие одно число: значения разойдутся, и заметит это
    // только тот, кто откроет обе группы одновременно.
    const result = statLayoutSchema.safeParse([
      group("characteristics", [{ key: "sila", label: "Сила" }]),
      group("combat", [{ key: "sila", label: "Сила удара" }]),
    ]);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("sila");
  });

  it("отвергает дважды объявленную группу", () => {
    expect(
      statLayoutSchema.safeParse([
        group("combat", [{ key: "a", label: "A" }]),
        group("combat", [{ key: "b", label: "B" }]),
      ]).success,
    ).toBe(false);
  });

  it("отвергает ключ, который не примет движок формул", () => {
    for (const key of ["Сила", "ближний бой", "2hand", ""])
      expect(
        statLayoutSchema.safeParse([
          group("characteristics", [{ key, label: "X" }]),
        ]).success,
        key,
      ).toBe(false);
  });

  it("отвергает пустую подпись", () => {
    expect(
      statLayoutSchema.safeParse([
        group("characteristics", [{ key: "sila", label: "  " }]),
      ]).success,
    ).toBe(false);
  });
});

/**
 * Форма ключа объявлена в контракте, а разбирает его серверный парсер. Это две
 * копии одного правила, и проверять их согласованность рассуждением
 * бессмысленно — здесь она проверяется прогоном через настоящий `rollFormula`.
 */
describe("ключ раскладки и движок формул согласованы", () => {
  it("всё, что принял контракт, принимает и парсер", () => {
    for (const label of [
      "Сила",
      "Ловкость",
      "Живучесть",
      "Интеллект",
      "Харизма",
      "Сила воли",
      "Удача",
      "Инициатива",
      "Реакция",
      "Ближний бой",
      "Дальний бой",
      "Реген Маны",
    ]) {
      const key = statKeyFromLabel(label);
      expect(key, label).toMatch(STAT_KEY_PATTERN);
      expect(
        statLayoutSchema.safeParse([group("characteristics", [{ key, label }])])
          .success,
        label,
      ).toBe(true);
      expect(rollFormula(`1d2+${key}`, { [key]: 1 }, () => 0).total).toBe(2);
    }
  });
});
