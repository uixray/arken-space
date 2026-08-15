import { describe, expect, it } from "vitest";
import {
  largestFields,
  measureSnapshot,
  sumByField,
} from "./snapshot-metrics.js";

/**
 * UIX-408/409, этап 0. Оснастка должна давать числа, на которые можно
 * опереться, — предыдущий замер уже ошибся, и на этом плане чуть не построили
 * приёмку.
 */
describe("измерение снапшота", () => {
  it("считает байты, а не символы", () => {
    // На кириллице разница двукратная: `JSON.stringify().length` дал бы длину
    // строки, а по сети идут байты. Ровно на этом ошибся замер в разборе —
    // размер персонажей был завышен более чем вдвое.
    const cyrillic = measureSnapshot({ name: "Ллеанна" });
    expect(cyrillic.byField.name).toBe(
      Buffer.byteLength(JSON.stringify("Ллеанна"), "utf8"),
    );
    expect(cyrillic.byField.name).toBeGreaterThan(
      JSON.stringify("Ллеанна").length,
    );
  });

  it("раскладывает размер по полям верхнего уровня", () => {
    const { byField } = measureSnapshot({
      messages: [1, 2, 3],
      campaign: { id: "x" },
    });
    expect(Object.keys(byField).sort()).toEqual(["campaign", "messages"]);
  });

  it("складывает отчёты нескольких сокетов", () => {
    expect(sumByField([{ messages: 10 }, { messages: 5, assets: 3 }])).toEqual({
      messages: 15,
      assets: 3,
    });
  });

  it("показывает крупнейшие поля первыми", () => {
    expect(
      largestFields({ a: 1, b: 100, c: 50 }, 2).map((item) => item.field),
    ).toEqual(["b", "c"]);
  });

  it("не спотыкается о значение, которого нельзя сериализовать", () => {
    // Оснастка не должна ронять рассылку: измерение существует ради удобства,
    // а игра — ради игры.
    expect(() => measureSnapshot({ ok: 1, gone: undefined })).not.toThrow();
  });
});
