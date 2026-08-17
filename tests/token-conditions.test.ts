import { describe, expect, it } from "vitest";
import {
  TOKEN_CONDITION_LABEL,
  tokenConditionsSchema,
} from "../packages/contracts/src/index.js";
import { normalizeTokenConditions } from "../apps/server/src/token-conditions.js";

/**
 * UIX-471 — состояния фигуры на карте.
 *
 * Набор закрытый, поэтому главное здесь — что через него не проедет чужое
 * значение: колонка `jsonb` принимает что угодно, а нарисованный на фигуре
 * значок несуществующего состояния объяснить будет некому.
 */
describe("набор состояний", () => {
  it("нормализует порядок по объявлению, а не по нажатиям", () => {
    // Две одинаковые по смыслу фигуры не должны отличаться порядком значков.
    expect(tokenConditionsSchema.parse(["PRONE", "POISONED"])).toEqual([
      "POISONED",
      "PRONE",
    ]);
  });

  it("снимает повторы", () => {
    expect(
      tokenConditionsSchema.parse(["POISONED", "POISONED", "POISONED"]),
    ).toEqual(["POISONED"]);
  });

  it("держит несколько состояний сразу", () => {
    // Отравлен и обездвижен одновременно — обычное дело; выбор «одного
    // текущего» заставил бы мастера решать, какое правило сейчас важнее.
    expect(
      tokenConditionsSchema.parse(["RESTRAINED", "POISONED"]),
    ).toHaveLength(2);
  });

  it("у каждого состояния есть подпись", () => {
    // По ним строится подсказка при наведении: значок без имени бесполезен.
    for (const condition of tokenConditionsSchema.parse([
      "POISONED",
      "UNCONSCIOUS",
      "RESTRAINED",
      "PRONE",
    ]))
      expect(TOKEN_CONDITION_LABEL[condition]).toBeTruthy();
  });
});

describe("чтение состояний из базы", () => {
  it("пропускает годный набор", () => {
    expect(normalizeTokenConditions(["POISONED"])).toEqual(["POISONED"]);
  });

  it("выбрасывает неизвестное состояние, сохраняя остальные", () => {
    // Одно негодное значение не должно стоить фигуре всех остальных значков.
    expect(normalizeTokenConditions(["POISONED", "CURSED"])).toEqual([
      "POISONED",
    ]);
  });

  it("переживает мусор вместо массива", () => {
    // Колонку могли поправить руками или записать прошлой версией.
    expect(normalizeTokenConditions(null)).toEqual([]);
    expect(normalizeTokenConditions("POISONED")).toEqual([]);
    expect(normalizeTokenConditions({ POISONED: true })).toEqual([]);
    expect(normalizeTokenConditions([1, 2, 3])).toEqual([]);
  });
});
