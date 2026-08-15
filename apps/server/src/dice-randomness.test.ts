import { afterEach, describe, expect, it, vi } from "vitest";
import { rollFormula, rollFormulaWithMode } from "./dice.js";

/**
 * Проверка генератора бросков.
 *
 * Поводом стала жалоба с игры: «слишком часто выпадает меньше половины». На
 * 286 реальных бросках перекоса не нашлось (хи-квадрат 21.1 при df=19), а
 * прогон на миллионе дал 49.986% значений в нижней половине. Здесь остаётся
 * то, что имеет смысл держать в наборе постоянно, — не статистика (она на
 * маленькой выборке шумит и делает тест мигающим), а **устройство**: чем
 * именно бросаются кубы.
 */
afterEach(() => vi.restoreAllMocks());

describe("генератор бросков", () => {
  it("не трогает Math.random, даже когда генератор не передан", () => {
    // Главная щель, ради которой тест и написан. Боевые маршруты передают
    // `randomInt` из `node:crypto` явно, но у параметра есть значение по
    // умолчанию: вызов, забывший аргумент, молча уехал бы на слабый
    // генератор, и никакой другой тест этого бы не увидел.
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random не должен участвовать в броске");
    });

    expect(() => rollFormula("2d20 + 3", {})).not.toThrow();
    expect(() => rollFormulaWithMode("1d20", {}, "ADVANTAGE")).not.toThrow();
    expect(random).not.toHaveBeenCalled();
  });

  it("выдаёт только грани, которые есть у кости", () => {
    // Смещение на единицу здесь — самая дешёвая из возможных поломок: она даёт
    // либо ноль вместо единицы, либо недостижимый максимум.
    const seen = new Set<number>();
    for (let attempt = 0; attempt < 2000; attempt++)
      seen.add(rollFormula("1d6", {}).terms[0]!.rolls[0]!);
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("берёт у преимущества больший бросок, у помехи — меньший", () => {
    // Перепутанные местами режимы прошли бы любую проверку равномерности:
    // распределение осталось бы законным, просто не тем.
    const pair = [7, 15];
    let index = 0;
    const scripted = () => pair[index++ % pair.length]! - 1;

    index = 0;
    expect(rollFormulaWithMode("1d20", {}, "ADVANTAGE", scripted).total).toBe(
      15,
    );
    index = 0;
    expect(
      rollFormulaWithMode("1d20", {}, "DISADVANTAGE", scripted).total,
    ).toBe(7);
  });

  it("покрывает обе крайние грани d20", () => {
    // Жалоба была именно про криты. Единица и двадцатка должны быть
    // достижимы — прогон на миллионе дал 49 624 и 50 110 при ожидании 50 000.
    const seen = new Set<number>();
    for (let attempt = 0; attempt < 20_000; attempt++)
      seen.add(rollFormula("1d20", {}).terms[0]!.rolls[0]!);
    expect(seen.has(1)).toBe(true);
    expect(seen.has(20)).toBe(true);
    expect(Math.min(...seen)).toBe(1);
    expect(Math.max(...seen)).toBe(20);
  });
});
