import { describe, expect, it } from "vitest";
import {
  splitWorkspaceNav,
  workspaceNavItems,
  type WorkspaceId,
} from "../apps/web/src/workspace-nav.js";

const ids = (items: readonly { id: WorkspaceId }[]) =>
  items.map((item) => item.id);

describe("UIX-472 — состав разделов", () => {
  const gm = workspaceNavItems({ isGm: true, operatorFeedbackAllowed: false });
  const player = workspaceNavItems({
    isGm: false,
    operatorFeedbackAllowed: false,
  });

  it("прячет у игрока мастерские разделы", () => {
    // Инструменты подготовки: в списке игрока они только удлиняли перебор.
    for (const hidden of ["media", "world-maps", "world-codex"] as const)
      expect(ids(player)).not.toContain(hidden);
    for (const shown of ["media", "world-maps", "world-codex"] as const)
      expect(ids(gm)).toContain(shown);
  });

  it("оставляет игроку то, чем он пользуется", () => {
    expect(ids(player)).toEqual(["characters", "tokens", "player-requests"]);
  });

  it("называет заявки по-разному мастеру и игроку", () => {
    // У мастера это очередь входящих, у игрока — свои отправленные.
    expect(gm.find((item) => item.id === "player-requests")?.label).toBe(
      "Открытые заявки",
    );
    expect(player.find((item) => item.id === "player-requests")?.label).toBe(
      "Мои заявки",
    );
  });

  it("показывает отчёты оператора только тому, кому они разрешены", () => {
    expect(ids(gm)).not.toContain("operator-feedback");
    expect(
      ids(workspaceNavItems({ isGm: true, operatorFeedbackAllowed: true })),
    ).toContain("operator-feedback");
  });
});

describe("UIX-472 — что помещается в строку", () => {
  const items = [
    { id: "characters" as const },
    { id: "tokens" as const },
    { id: "scenes" as const },
    { id: "setup" as const },
  ];
  const widths = new Map<WorkspaceId, number>([
    ["characters", 100],
    ["tokens", 100],
    ["scenes", 100],
    ["setup", 100],
  ]);

  it("не заводит «Ещё», когда всё помещается", () => {
    // Иначе последний раздел уезжал бы в меню, освобождая место для кнопки,
    // которая открывает меню с ним одним.
    const split = splitWorkspaceNav(items, widths, 400, 60);
    expect(ids(split.visible)).toHaveLength(4);
    expect(split.overflow).toEqual([]);
  });

  it("резервирует место под «Ещё», когда она неизбежна", () => {
    // 300 хватило бы на три раздела ровно, но тогда «Ещё» некуда поставить.
    const split = splitWorkspaceNav(items, widths, 300, 60);
    expect(ids(split.visible)).toEqual(["characters", "tokens"]);
    expect(ids(split.overflow)).toEqual(["scenes", "setup"]);
  });

  it("считает по измеренным ширинам, а не по числу пунктов", () => {
    // Подписи разной длины: «первые четыре» на одной машине занимают строку, а
    // на другой — половину.
    const uneven = new Map<WorkspaceId, number>([
      ["characters", 40],
      ["tokens", 40],
      ["scenes", 40],
      ["setup", 300],
    ]);
    const split = splitWorkspaceNav(items, uneven, 200, 60);
    expect(ids(split.visible)).toEqual(["characters", "tokens", "scenes"]);
  });

  it("учитывает промежутки между кнопками", () => {
    const split = splitWorkspaceNav(items, widths, 400, 60, 20);
    expect(split.overflow.length).toBeGreaterThan(0);
  });

  it("не падает, когда ширина ещё не измерена", () => {
    // Первый кадр до измерения: лучше показать всё в меню, чем мигнуть строкой,
    // которую тут же перестроят.
    const split = splitWorkspaceNav(items, widths, 0, 60);
    expect(split.visible).toEqual([]);
    expect(split.overflow).toHaveLength(4);
  });

  it("уводит в меню всё, когда не помещается даже один раздел", () => {
    const split = splitWorkspaceNav(items, widths, 80, 60);
    expect(split.visible).toEqual([]);
    expect(ids(split.overflow)).toHaveLength(4);
  });
});
