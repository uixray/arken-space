import { describe, expect, it } from "vitest";
import {
  initiativeRollFormula,
  initiativeRollLabel,
} from "../apps/web/src/initiative-roll.js";

/**
 * UIX-466 — формула броска на инициативу.
 *
 * Проверяется отдельно от компонента: она едет в ленту, где её читают глазами,
 * и «1d20 + -2» там выглядит поломкой, даже если сервер такое разберёт.
 */
describe("формула броска на инициативу", () => {
  it("прибавляет положительный бонус", () => {
    expect(initiativeRollFormula(3)).toBe("1d20 + 3");
  });

  it("вычитает отрицательный, а не прибавляет минус", () => {
    expect(initiativeRollFormula(-2)).toBe("1d20 - 2");
  });

  it("не пишет нулевой бонус вовсе", () => {
    // «1d20 + 0» разбирается, но в ленте это мусор.
    expect(initiativeRollFormula(0)).toBe("1d20");
  });

  it("не ломается на нечисле", () => {
    expect(initiativeRollFormula(Number.NaN)).toBe("1d20");
  });

  it("называет в подписи, чей ход считают", () => {
    expect(initiativeRollLabel("Ллойд")).toBe("Инициатива: Ллойд");
  });
});
