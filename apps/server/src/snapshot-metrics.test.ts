import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  countQuery,
  largestFields,
  measureSnapshot,
  queryCountSince,
  readQueryCount,
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

  it("ведёт независимые монотонные process-window оценки", () => {
    const firstWindow = readQueryCount();
    countQuery();
    const secondWindow = readQueryCount();
    countQuery();
    expect(queryCountSince(firstWindow)).toBe(2);
    expect(queryCountSince(secondWindow)).toBe(1);
  });

  it("открывает окно broadcast до общего read set и не платит за пустую комнату", () => {
    const source = readFileSync(
      new URL("./routes.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("async function broadcastSnapshots(");
    const end = source.indexOf("\nfunction errorMessage", start);
    const body = source.slice(start, end);
    const emptyRoomGuard = body.indexOf("targetSockets.length === 0");
    const windowStart = body.indexOf("queryCountAtStart = readQueryCount()");
    const sharedRead = body.indexOf(
      "await loadCampaignReadSet(db, campaignId)",
    );
    const parallelProjection = body.indexOf("await Promise.all(");

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(emptyRoomGuard).toBeGreaterThanOrEqual(0);
    expect(emptyRoomGuard).toBeLessThan(windowStart);
    expect(windowStart).toBeLessThan(sharedRead);
    expect(parallelProjection).toBeGreaterThan(sharedRead);
    expect(body).not.toContain("resetQueryCount()");
  });
});
