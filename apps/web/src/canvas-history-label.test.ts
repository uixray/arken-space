import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import {
  describeHistoryEntry,
  historyControlLabel,
  nextHistoryEntry,
  type CanvasHistoryEntry,
} from "./canvas-history-label";

/**
 * UIX-503. Проверяется решение «что сказать человеку», отдельно от разметки:
 * подпись обязана называть то самое действие, которое отменится, и молчать об
 * объекте, которого мне не показывают.
 */
const entry = (
  overrides: Partial<CanvasHistoryEntry> = {},
): CanvasHistoryEntry => ({
  sequence: 10,
  type: "TOKEN_MOVE",
  targetType: "TOKEN",
  targetId: "token-1",
  status: "APPLIED",
  ...overrides,
});

const snapshotWith = (tokens: { id: string; name: string }[]) =>
  ({ tokens }) as unknown as GameSnapshot;

describe("подпись отмены и повтора", () => {
  it("называет действие и объект", () => {
    expect(
      describeHistoryEntry(
        entry(),
        snapshotWith([{ id: "token-1", name: "Тейн" }]),
      ),
    ).toBe("токен перемещён — Тейн");
  });

  it("молчит об объекте, которого нет в моём снапшоте", () => {
    // Токен, скрытый туманом, в снапшот игрока не попадает. Подпись обязана
    // остаться родовой, а не выдумать имя и не раскрыть скрытое.
    expect(describeHistoryEntry(entry(), snapshotWith([]))).toBe(
      "токен перемещён",
    );
  });

  it("не показывает сырой тип из журнала для незнакомой записи", () => {
    // Новый тип действия появится раньше, чем эта таблица о нём узнает.
    // «WALLET_AUDIT» в подписи кнопки был бы утечкой внутреннего словаря.
    expect(
      describeHistoryEntry(entry({ type: "SOMETHING_NEW" }), snapshotWith([])),
    ).toBe("действие");
  });

  it("покрывает все виды записей канваса", () => {
    // Условие приёмки перечисляет их поимённо: движение, размер, рисунки,
    // туман. Родовое «действие» здесь означало бы, что подпись не выполнена.
    for (const type of [
      "TOKEN_CREATE",
      "TOKEN_DELETE",
      "TOKEN_MOVE",
      "TOKEN_RESIZE",
      "TOKEN_APPEARANCE",
      "TOKEN_CONDITIONS",
      "TOKEN_LAYER",
      "DRAWING_CREATE",
      "DRAWING_UPDATE",
      "DRAWING_DELETE",
      "FOG_CREATE",
      "SCENE_CANVAS",
    ])
      expect(
        describeHistoryEntry(
          entry({ type, targetType: "OTHER" }),
          snapshotWith([]),
        ),
        `тип ${type} не описан`,
      ).not.toBe("действие");
  });

  it("недоступной кнопке достаётся родовая подпись, а не обещание", () => {
    expect(historyControlLabel("undo", undefined, snapshotWith([]))).toBe(
      "Отменить последнее действие",
    );
    expect(historyControlLabel("redo", undefined, snapshotWith([]))).toBe(
      "Повторить отменённое действие",
    );
  });

  it("подписывает кнопку глаголом и описанием", () => {
    const snapshot = snapshotWith([{ id: "token-1", name: "Тейн" }]);
    expect(historyControlLabel("undo", entry(), snapshot)).toBe(
      "Отменить: токен перемещён — Тейн",
    );
    expect(
      historyControlLabel("redo", entry({ status: "UNDONE" }), snapshot),
    ).toBe("Повторить: токен перемещён — Тейн");
  });
});

describe("выбор следующей записи", () => {
  /**
   * Порядок обязан совпадать с серверным: `/api/canvas/history` отдаёт записи
   * по убыванию `sequence`, и берётся первая подходящая. Разойдясь с сервером,
   * подпись назвала бы одно, а отменилось бы другое — хуже прежней родовой.
   */
  const history = [
    entry({ sequence: 12, status: "UNDONE", type: "DRAWING_CREATE" }),
    entry({ sequence: 11, status: "APPLIED", type: "TOKEN_RESIZE" }),
    entry({ sequence: 10, status: "APPLIED", type: "TOKEN_MOVE" }),
  ];

  it("отмена берёт самую свежую применённую", () => {
    expect(nextHistoryEntry("undo", history)?.sequence).toBe(11);
  });

  it("повтор берёт самую свежую отменённую", () => {
    expect(nextHistoryEntry("redo", history)?.sequence).toBe(12);
  });

  it("на пустой истории не выбирает ничего", () => {
    expect(nextHistoryEntry("undo", [])).toBeUndefined();
  });
});
