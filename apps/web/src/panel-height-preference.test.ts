import { describe, expect, it, vi } from "vitest";
import {
  clampPanelHeight,
  PANEL_HEIGHT_LIMITS,
  panelHeightStorageKey,
  readPanelHeight,
  writePanelHeight,
} from "./panel-height-preference";

/**
 * UIX-455. Наследник тестов `dice-tray-height-preference`: те же границы и та
 * же устойчивость к недоступному хранилищу, но ключ теперь помнит ещё и панель.
 */
describe("высота растягиваемой панели", () => {
  it("разводит панели по разным ключам", () => {
    // Ради этого имя панели и стало параметром: с общим ключом две панели
    // делили бы одну высоту, и заметил бы это только тот, кто тянет обе.
    expect(panelHeightStorageKey("quickRolls", "c", "m")).not.toBe(
      panelHeightStorageKey("diceTray", "c", "m"),
    );
  });

  it("привязывает высоту и к кампании, и к членству", () => {
    expect(panelHeightStorageKey("quickRolls", "campaign/a", "member:b")).toBe(
      "arken.panelHeight:quickRolls:campaign%2Fa:member%3Ab",
    );
  });

  it("держит высоту в границах", () => {
    expect(clampPanelHeight(10)).toBe(PANEL_HEIGHT_LIMITS.min);
    expect(clampPanelHeight(9000)).toBe(PANEL_HEIGHT_LIMITS.max);
    expect(clampPanelHeight(200)).toBe(200);
    expect(clampPanelHeight(Number.NaN)).toBe(PANEL_HEIGHT_LIMITS.default);
  });

  it("не даёт схлопнуть панель в полоску", () => {
    // Минимум — не косметика: свёрнутую до нуля панель нечем вернуть, ручка
    // окажется прижата к заголовку.
    expect(clampPanelHeight(0)).toBeGreaterThanOrEqual(96);
  });

  it("отдаёт null, когда ничего не сохранено или сохранён мусор", () => {
    expect(readPanelHeight({ getItem: () => null }, "p", "c", "m")).toBe(null);
    expect(readPanelHeight({ getItem: () => "не число" }, "p", "c", "m")).toBe(
      null,
    );
  });

  it("читает сохранённое, прогоняя через границы", () => {
    expect(readPanelHeight({ getItem: () => "9000" }, "p", "c", "m")).toBe(
      PANEL_HEIGHT_LIMITS.max,
    );
    expect(readPanelHeight({ getItem: () => "200" }, "p", "c", "m")).toBe(200);
  });

  it("переживает недоступное хранилище", () => {
    expect(
      readPanelHeight(
        {
          getItem: () => {
            throw new Error("blocked");
          },
        },
        "p",
        "c",
        "m",
      ),
    ).toBe(null);
    expect(() =>
      writePanelHeight(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        "p",
        "c",
        "m",
        200,
      ),
    ).not.toThrow();
  });

  it("пишет высоту строкой под ключом панели", () => {
    const setItem = vi.fn();
    writePanelHeight({ setItem }, "quickRolls", "campaign", "member", 9000);
    expect(setItem).toHaveBeenCalledWith(
      "arken.panelHeight:quickRolls:campaign:member",
      String(PANEL_HEIGHT_LIMITS.max),
    );
  });
});
