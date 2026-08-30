import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import {
  canvasHistoryVersion,
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
      "CANVAS_BULK_MOVE",
      "CANVAS_BULK_DELETE",
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
   * Авторитетная запись может быть добавлена после обычной страницы истории.
   * Ставим перед ней другой UNDONE: выбор по одному статусу назвал бы не то
   * действие, а маркер `nextDirection` обязан всё равно найти правильное.
   */
  const history = [
    entry({ sequence: 12, status: "UNDONE", type: "TOKEN_MOVE" }),
    entry({
      sequence: 10,
      status: "UNDONE",
      type: "DRAWING_CREATE",
      nextDirection: "redo",
    }),
    entry({
      sequence: 11,
      status: "APPLIED",
      type: "TOKEN_RESIZE",
      nextDirection: "undo",
    }),
  ];

  it("отмена берёт самую свежую применённую", () => {
    expect(nextHistoryEntry("undo", history)?.sequence).toBe(11);
  });

  it("повтор берёт самую свежую отменённую", () => {
    expect(nextHistoryEntry("redo", history)?.sequence).toBe(10);
  });

  it("на пустой истории не выбирает ничего", () => {
    expect(nextHistoryEntry("undo", [])).toBeUndefined();
  });

  it("не воскрешает статусом кандидата, которого новый сервер не отметил", () => {
    const withoutRedo = [
      entry({ sequence: 12, status: "UNDONE", nextDirection: null }),
      entry({
        sequence: 11,
        status: "APPLIED",
        nextDirection: "undo",
      }),
    ];
    expect(nextHistoryEntry("redo", withoutRedo)).toBeUndefined();
  });

  it("сохраняет fallback для ответа старого сервера без поля кандидата", () => {
    expect(
      nextHistoryEntry("redo", [entry({ sequence: 12, status: "UNDONE" })])
        ?.sequence,
    ).toBe(12);
  });
});

describe("версия канваса для обновления истории", () => {
  const scene = { id: "scene-1", revision: 3 };
  const fog = [{ id: "fog-1", revision: 1 }];
  const drawings = [{ id: "drawing-1", revision: 20 }];
  const tokens = [
    { id: "token-low", revision: 1 },
    { id: "token-high", revision: 20 },
  ];

  it("меняется, когда растёт не максимальная ревизия", () => {
    const before = canvasHistoryVersion(scene, fog, drawings, tokens);
    const after = canvasHistoryVersion(scene, fog, drawings, [
      { id: "token-low", revision: 2 },
      { id: "token-high", revision: 20 },
    ]);
    expect(after).not.toBe(before);
  });

  it("учитывает изменения сцены и состав объектов", () => {
    const before = canvasHistoryVersion(scene, fog, drawings, tokens);
    expect(
      canvasHistoryVersion({ ...scene, revision: 4 }, fog, drawings, tokens),
    ).not.toBe(before);
    expect(
      canvasHistoryVersion(scene, fog, drawings, tokens.slice(1)),
    ).not.toBe(before);
  });

  it("не меняется только из-за порядка объектов", () => {
    expect(
      canvasHistoryVersion(scene, fog, drawings, [...tokens].reverse()),
    ).toBe(canvasHistoryVersion(scene, fog, drawings, tokens));
  });
});
