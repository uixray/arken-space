import { describe, expect, it } from "vitest";
import {
  MAP_TOOL_SHORTCUTS,
  mapViewportAriaKeyShortcuts,
  shortcutForTool,
  shortcutLabel,
} from "../apps/web/src/renderers/map-tool-shortcuts.js";
import {
  resolveMapToolShortcut,
  TOOL_SHORTCUTS,
} from "../apps/web/src/renderers/map-interaction.js";
import {
  canvasSections,
  guideSectionsForRole,
} from "../apps/web/src/landing-guide-content.js";

/**
 * UIX-463 — один источник клавиш.
 *
 * До него список жил трижды: разбор нажатия, шпаргалка и подсказки на кнопках,
 * где клавиш не было вовсе. Здесь проверяется не «список правильный», а что
 * все, кто им пользуется, читают одно и то же.
 */
describe("единый список клавиш", () => {
  it("не даёт двум инструментам одну клавишу", () => {
    const keys = MAP_TOOL_SHORTCUTS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("разбор нажатия берёт клавиши из общего списка", () => {
    for (const entry of MAP_TOOL_SHORTCUTS) {
      expect(resolveMapToolShortcut(entry.key, false, "GM")).toBe(entry.tool);
      if (entry.shiftTool)
        expect(resolveMapToolShortcut(entry.key, true, "GM")).toBe(
          entry.shiftTool,
        );
    }
  });

  it("не пускает игрока к мастерским инструментам", () => {
    // Ни с Shift, ни без: туман — не его дело, и клавиша не должна намекать,
    // что дело в сочетании.
    for (const entry of MAP_TOOL_SHORTCUTS.filter((item) => item.gmOnly)) {
      expect(resolveMapToolShortcut(entry.key, false, "PLAYER")).toBeNull();
      expect(resolveMapToolShortcut(entry.key, true, "PLAYER")).toBeNull();
    }
  });

  it("оставляет игроку общие инструменты", () => {
    for (const entry of MAP_TOOL_SHORTCUTS.filter((item) => !item.gmOnly))
      expect(resolveMapToolShortcut(entry.key, false, "PLAYER")).toBe(
        entry.tool,
      );
  });

  it("не выбирает инструмент с Shift там, где пары нет", () => {
    // Иначе Shift+V молча делал бы то же, что V, и человек решил бы, что у
    // сочетания есть смысл.
    for (const entry of MAP_TOOL_SHORTCUTS.filter((item) => !item.shiftTool))
      expect(resolveMapToolShortcut(entry.key, true, "GM")).toBeNull();
  });

  it("оставляет прежний TOOL_SHORTCUTS производным, а не копией", () => {
    // По нему шпаргалка проверяется на полноту; он обязан следовать за общим
    // списком, а не жить своей жизнью.
    for (const [key, tool] of Object.entries(TOOL_SHORTCUTS))
      expect(
        MAP_TOOL_SHORTCUTS.some(
          (entry) => entry.key === key && entry.tool === tool,
        ),
      ).toBe(true);
  });

  it("требует подпись для каждой Shift-пары", () => {
    for (const entry of MAP_TOOL_SHORTCUTS)
      expect(Boolean(entry.shiftTool)).toBe(Boolean(entry.shiftAction));
  });

  it("объявляет доступные клавиши карты с учётом роли", () => {
    const playerKeys = mapViewportAriaKeyShortcuts("PLAYER").split(" ");
    const gmKeys = mapViewportAriaKeyShortcuts("GM").split(" ");
    expect(new Set(playerKeys).size).toBe(playerKeys.length);
    expect(new Set(gmKeys).size).toBe(gmKeys.length);

    // Неинструментальные команды остаются доступны обеим ролям.
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "+",
      "-",
      "0",
      "F",
      "O",
      "Enter",
      "Delete",
      "Escape",
    ])
      expect(playerKeys).toContain(key);

    for (const entry of MAP_TOOL_SHORTCUTS) {
      const key = entry.key.toUpperCase();
      expect(gmKeys).toContain(key);
      expect(playerKeys.includes(key)).toBe(!entry.gmOnly);
      if (entry.shiftTool) {
        expect(gmKeys).toContain(`Shift+${key}`);
        expect(playerKeys.includes(`Shift+${key}`)).toBe(!entry.gmOnly);
      }
    }
  });

  it("строит шпаргалку из полного списка, включая мастерские пары", () => {
    const documented = new Map(
      canvasSections
        .flatMap((section) => section.shortcuts)
        .map((shortcut) => [shortcut.keys.join("+"), shortcut.action]),
    );

    for (const shortcut of MAP_TOOL_SHORTCUTS) {
      const key = shortcut.key.toUpperCase();
      expect(documented.get(key)).toBe(shortcut.action);
      if (shortcut.shiftTool)
        expect(documented.get(`Shift+${key}`)).toBe(shortcut.shiftAction);
    }
  });

  it("даёт подпись клавиши для подсказки на кнопке", () => {
    expect(shortcutLabel("PAN")).toBe("V");
    expect(shortcutLabel("COVER")).toBe("Shift + G");
    expect(shortcutForTool("FOG_BRUSH")).toEqual({
      key: "b",
      withShift: false,
    });
  });

  it("молчит про инструмент без клавиши", () => {
    // Подсказка «· undefined» на кнопке хуже, чем её отсутствие.
    expect(shortcutLabel("SCENE_REGION")).toBeUndefined();
  });
});

describe("UIX-462 — шпаргалка по роли", () => {
  it("мастеру отдаёт всё", () => {
    const forGm = guideSectionsForRole(canvasSections, true);
    expect(forGm.flatMap((section) => section.shortcuts)).toHaveLength(
      canvasSections.flatMap((section) => section.shortcuts).length,
    );
  });

  it("игроку не показывает мастерских клавиш", () => {
    // Список, где половина строк не работает, хуже отсутствующего: человек
    // пробует, ничего не происходит, и перестаёт верить остальным строкам.
    const forPlayer = guideSectionsForRole(canvasSections, false);
    expect(
      forPlayer
        .flatMap((section) => section.shortcuts)
        .some((shortcut) => shortcut.gmOnly),
    ).toBe(false);
  });

  it("не оставляет пустых секций", () => {
    // Пустой заголовок сообщает только о том, что тут что-то скрыли.
    for (const section of guideSectionsForRole(canvasSections, false))
      expect(section.shortcuts.length).toBeGreaterThan(0);
  });

  it("не трогает исходные данные", () => {
    const before = canvasSections.flatMap((s) => s.shortcuts).length;
    guideSectionsForRole(canvasSections, false);
    expect(canvasSections.flatMap((s) => s.shortcuts).length).toBe(before);
  });
});
