import { describe, expect, it } from "vitest";
import {
  DICE_FRAME_SOURCES,
  resolveDiceFrame,
} from "../packages/contracts/src/index.js";

/**
 * UIX-457 — какая рамка выигрывает.
 *
 * Правило проверяется отдельно от того, кто его вызывает: «какая из трёх
 * картинок нарисовалась» иначе выясняется только глазами и только на игре.
 */
describe("выбор рамки броска", () => {
  it("рамка скилла старше рамки школы и выбора игрока", () => {
    // Скилл — самое конкретное высказывание: у «Огненного шара» своя рамка
    // именно потому, что он не похож на остальную школу.
    expect(
      resolveDiceFrame({ skill: "a1", school: "a2", player: "a3" }),
    ).toEqual({ assetId: "a1", source: "SKILL" });
  });

  it("рамка школы старше выбора игрока", () => {
    expect(resolveDiceFrame({ school: "a2", player: "a3" })).toEqual({
      assetId: "a2",
      source: "SCHOOL",
    });
  });

  it("выбор игрока работает, когда своей рамки нет ни у скилла, ни у школы", () => {
    // Обычный бросок на характеристику — ни скилла, ни школы: тут выбор игрока
    // и есть весь ответ.
    expect(resolveDiceFrame({ player: "a3" })).toEqual({
      assetId: "a3",
      source: "PLAYER",
    });
  });

  it("отсутствие рамки — нормальное состояние, а не ошибка", () => {
    // До этой задачи рамки не было ни у кого; пустой результат обязан быть
    // выразимым, иначе придётся выдумывать рамку по умолчанию.
    expect(resolveDiceFrame({})).toBeNull();
    expect(
      resolveDiceFrame({ skill: null, school: null, player: null }),
    ).toBeNull();
  });

  it("не подхватывает пустую строку вместо ссылки", () => {
    // Пустая строка приезжает из формы, где поле очистили. Считать её рамкой
    // значит рисовать несуществующий ассет.
    expect(resolveDiceFrame({ skill: "", school: "a2" })).toEqual({
      assetId: "a2",
      source: "SCHOOL",
    });
  });

  it("сообщает, какой источник победил", () => {
    // Не для красоты: интерфейс мастера должен объяснять, почему у броска эта
    // рамка, — иначе настройка превращается в гадание.
    for (const source of DICE_FRAME_SOURCES) {
      const key = source.toLowerCase() as "skill" | "school" | "player";
      expect(resolveDiceFrame({ [key]: "a" })?.source).toBe(source);
    }
  });
});
