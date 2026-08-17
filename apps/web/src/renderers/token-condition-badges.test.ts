import { describe, expect, it } from "vitest";
import {
  conditionBadgeLayout,
  conditionsHint,
  TOKEN_CONDITION_BADGE,
} from "./token-condition-badges";

/**
 * UIX-471 — как состояния выглядят на фигуре.
 *
 * Проверяется то, что от канваса не зависит: раскладка ряда и подпись. Сама
 * отрисовка — дело Konva, и её видно глазами.
 */
describe("значки состояний", () => {
  it("у каждого состояния свой цвет и своя буква", () => {
    // Две одинаковые буквы подряд неразличимы, а один цвет на двоих бесполезен
    // тому, кто цвета различает плохо.
    const badges = Object.values(TOKEN_CONDITION_BADGE);
    expect(new Set(badges.map((badge) => badge.color)).size).toBe(
      badges.length,
    );
    expect(new Set(badges.map((badge) => badge.short)).size).toBe(
      badges.length,
    );
  });

  it("ряд стоит по центру фигуры", () => {
    const layout = conditionBadgeLayout(2, 64);
    const row = 2 * layout.size + layout.gap;
    expect(layout.startX).toBeCloseTo((64 - row) / 2);
  });

  it("не закрывает саму фигуру", () => {
    // Портрет закрывать нельзя: по нему узнают, кто это.
    expect(conditionBadgeLayout(3, 64).y).toBeLessThan(0);
  });

  it("размер держится в разумных границах на любой фигуре", () => {
    // Токены бывают и 32, и 256: значок в четверть фигуры так же плох, как
    // незаметная точка.
    expect(conditionBadgeLayout(1, 24).size).toBeGreaterThanOrEqual(10);
    expect(conditionBadgeLayout(1, 512).size).toBeLessThanOrEqual(18);
  });

  it("подсказка называет состояния словами", () => {
    expect(conditionsHint(["POISONED", "PRONE"])).toBe("Отравлен, Распластан");
  });

  it("подсказка держит порядок набора, а не порядок нажатий", () => {
    expect(conditionsHint(["PRONE", "POISONED"])).toBe(
      conditionsHint(["POISONED", "PRONE"]),
    );
  });

  it("пустой набор не даёт пустой подписи с мусором", () => {
    expect(conditionsHint([])).toBe("");
  });
});
