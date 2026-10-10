// @vitest-environment jsdom
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";
import { MapToolbar, type MapToolbarProps } from "./MapToolbar";
import {
  MAP_TOOL_SHORTCUTS,
  shortcutLabel,
} from "./renderers/map-tool-shortcuts";
import { cursorPreferenceDefault } from "./cursor-preference";
import { writeToolbarCollapsed } from "./toolbar-preference";

vi.mock("./api", () => ({
  api: vi.fn().mockResolvedValue([]),
}));

vi.mock("@gravity-ui/uikit", () => ({
  Popup: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  Switch: ({
    checked,
    onUpdate,
    children,
  }: {
    checked?: boolean;
    onUpdate?: (next: boolean) => void;
    children?: ReactNode;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onUpdate?.(event.target.checked)}
      />
      {children}
    </label>
  ),
}));

function createMockSnapshot(role: "GM" | "PLAYER" = "GM"): GameSnapshot {
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    buildVersion: "test",
    campaign: {
      id: "c1",
      name: "Кампания",
      revision: 1,
      battleZone: null,
    } as unknown as GameSnapshot["campaign"],
    me: { id: "m1", displayName: "Тестер", role },
    scenes: [
      {
        id: "s1",
        name: "Сцена 1",
        active: true,
        mapAssetId: null,
        revision: 1,
        grid: {
          enabled: true,
          size: 64,
          offsetX: 0,
          offsetY: 0,
          color: "#c8b78b",
          opacity: 0.22,
        },
      },
    ] as unknown as GameSnapshot["scenes"],
    tokens: [],
    fogReveals: [],
    drawings: [],
    assets: [],
    messages: [],
    directThreads: [],
    encounters: [],
    worldMaps: null,
    audio: null,
    catalog: null,
    storyPosts: [],
    playerRequests: [],
  } as unknown as GameSnapshot;
}

function createDefaultProps(
  overrides?: Partial<MapToolbarProps>,
): MapToolbarProps {
  const snapshot = createMockSnapshot("GM");
  return {
    tool: "PAN",
    onToolSelect: vi.fn(),
    snapshot,
    viewSnapshot: snapshot,
    previewSnapshot: null,
    activeScene: snapshot.scenes[0],
    activeCanvasVersion: "v1",
    cursorPreference: cursorPreferenceDefault("GM"),
    onCursorPreferenceChange: vi.fn(),
    fogBrushRadius: 40,
    onFogBrushRadiusChange: vi.fn(),
    canvasEditMode: null,
    onCanvasEditModeChange: vi.fn(),
    onGridPreview: vi.fn(),
    onGridSave: vi.fn().mockResolvedValue(undefined),
    gmFogOpacity: 0.35,
    onGmFogOpacityChange: vi.fn(),
    gmFogVisible: true,
    onGmFogVisibleChange: vi.fn(),
    gmGridVisible: true,
    onGmGridVisibleChange: vi.fn(),
    ...overrides,
  };
}

describe("MapToolbar — панель инструментов карты (UIX-407)", () => {
  beforeEach(() => {
    writeToolbarCollapsed(window.localStorage, "m1", false);
  });
  it("keeps every toolbar control in the single full-height scroller", () => {
    const { container } = renderComponent(
      <MapToolbar
        {...createDefaultProps({ pauseControl: <button>Pause</button>, onToggleObjectList: vi.fn() })}
      />,
    );
    const toolbar = container.querySelector(".map-toolbar")!;
    const scroller = toolbar.querySelector(".map-toolbar__scroll")!;
    expect(toolbar.firstElementChild).toHaveClass("map-toolbar__collapse");
    expect(scroller).toContainElement(
      screen.getByRole("button", { name: "Pause" }),
    );
    expect(scroller).toContainElement(screen.getByRole("button", { name: "Pause" }));
    expect(scroller.querySelector(".map-toolbar__pause")).toBeInTheDocument();
    expect(scroller.lastElementChild).toHaveAttribute("data-tool", "STAMP");
    expect(scroller).toContainElement(screen.getByRole("button", { name: "Перемещение" }));
    const objectList = screen.getByRole("button", {
      name: "Список объектов и токенов карты",
    });
    expect(scroller).toContainElement(objectList);
    expect(objectList).toHaveTextContent("Список");
  });

  it("рендерит инструменты для роли PLAYER: без тумана и боевой зоны", () => {
    const playerSnapshot = createMockSnapshot("PLAYER");
    const props = createDefaultProps({
      snapshot: playerSnapshot,
      viewSnapshot: playerSnapshot,
      cursorPreference: cursorPreferenceDefault("PLAYER"),
    });

    const { container } = renderComponent(<MapToolbar {...props} />);

    expect(
      screen.getByRole("button", { name: "Перемещение" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Рисование" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Линейка" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Пинг" })).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: "Открыть туман" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Закрыть туман" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Обвести зону боя" }),
    ).not.toBeInTheDocument();
    for (const entry of MAP_TOOL_SHORTCUTS.filter(
      (shortcut) => shortcut.gmOnly,
    )) {
      expect(
        container.querySelector(`[data-tool="${entry.tool}"]`),
        `${entry.tool} is GM-only`,
      ).toBeNull();
      if (entry.shiftTool)
        expect(
          container.querySelector(`[data-tool="${entry.shiftTool}"]`),
          `${entry.shiftTool} is GM-only`,
        ).toBeNull();
    }
  });

  it("shows each canonical shortcut in the actual GM toolbar tooltip", async () => {
    const user = userEvent.setup();
    const { container } = renderComponent(
      <MapToolbar {...createDefaultProps()} />,
    );
    const toolbar = container.querySelector(".map-toolbar")!;

    for (const entry of MAP_TOOL_SHORTCUTS) {
      const trigger = toolbar.querySelector<HTMLElement>(
        `[data-tool="${entry.tool}"]`,
      );
      expect(trigger, `${entry.tool} trigger`).not.toBeNull();
      await user.hover(trigger!);
      const tooltip = await screen.findByRole("tooltip");
      expect(
        tooltip.textContent?.trim().split("·").at(-1)?.trim(),
        `${entry.tool} tooltip shortcut`,
      ).toBe(shortcutLabel(entry.tool));
      await user.unhover(trigger!);
      await waitFor(() =>
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
      );

      if (entry.shiftTool) {
        const shiftTrigger = toolbar.querySelector<HTMLElement>(
          `[data-tool="${entry.shiftTool}"]`,
        );
        expect(shiftTrigger, `${entry.shiftTool} trigger`).not.toBeNull();
        await user.hover(shiftTrigger!);
        const shiftTooltip = await screen.findByRole("tooltip");
        expect(
          shiftTooltip.textContent?.trim().split("·").at(-1)?.trim(),
          `${entry.shiftTool} tooltip shortcut`,
        ).toBe(shortcutLabel(entry.shiftTool));
        await user.unhover(shiftTrigger!);
        await waitFor(() =>
          expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
        );
      }
    }
  });

  it("keeps the GM fog heading between navigation and map markers", () => {
    const { container } = renderComponent(
      <MapToolbar {...createDefaultProps()} />,
    );
    const group = container.querySelector(".toolbar-group")!;
    const children = Array.from(group.children);
    const indexOfText = (text: string) =>
      children.findIndex((child) => child.textContent?.trim() === text);
    const fogHeading = indexOfText("Туман");
    const markersHeading = indexOfText("Метки");
    const pan = children.findIndex(
      (child) => child.getAttribute("data-tool") === "PAN",
    );
    const fog = children.findIndex(
      (child) => child.getAttribute("data-tool") === "FOG",
    );
    const ruler = children.findIndex(
      (child) => child.getAttribute("data-tool") === "RULER",
    );

    expect(pan).toBeGreaterThanOrEqual(0);
    expect(fogHeading).toBeGreaterThan(pan);
    expect(fog).toBeGreaterThan(fogHeading);
    expect(markersHeading).toBeGreaterThan(fog);
    expect(ruler).toBeGreaterThan(markersHeading);
  });

  it("keeps stamp as the final GM toolbar action and opens an adjacent dismissible popup", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    const { container } = renderComponent(<MapToolbar {...props} />);
    const scroller = container.querySelector(".map-toolbar__scroll")!;
    const stamp = screen.getByRole("button", { name: "Штамп рельефа" });
    expect(scroller.lastElementChild).toBe(stamp);

    await user.click(stamp);
    const popup = screen.getByRole("dialog", { name: "Штампы рельефа" });
    expect(scroller).not.toContainElement(popup);
    expect(popup.parentElement).toBe(document.body);

    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Штампы рельефа" })).not.toBeInTheDocument());
    await waitFor(() => expect(stamp).toHaveFocus());
    expect(props.onToolSelect).toHaveBeenLastCalledWith("PAN");
  });

  it("dismisses the stamp popup on outside pointer interaction without stealing focus", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    const { container } = renderComponent(<MapToolbar {...props} />);
    const stamp = screen.getByRole("button", { name: "Штамп рельефа" });
    await user.click(stamp);
    expect(screen.getByRole("dialog", { name: "Штампы рельефа" })).toBeInTheDocument();
    const outside = container.querySelector(".map-toolbar__collapse")!;
    await user.click(outside);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Штампы рельефа" })).not.toBeInTheDocument());
    expect(props.onToolSelect).toHaveBeenLastCalledWith("STAMP");
  });

  it("рендерит инструменты GM без отключённого боя (UIX-621)", () => {
    const props = createDefaultProps();
    renderComponent(<MapToolbar {...props} />);

    expect(
      screen.getByRole("button", { name: "Перемещение" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Открыть туман" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Закрыть туман" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Открыть туман кистью" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Закрыть туман кистью" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Линейка" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Пинг" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Обвести зону боя" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Начать бой" }),
    ).not.toBeInTheDocument();
  });

  it("вызывает onToolSelect при клике на инструмент", async () => {
    const onToolSelect = vi.fn();
    const props = createDefaultProps({ onToolSelect });
    renderComponent(<MapToolbar {...props} />);

    await userEvent.click(screen.getByRole("button", { name: "Рисование" }));
    expect(onToolSelect).toHaveBeenCalledWith("DRAW");

    await userEvent.click(screen.getByRole("button", { name: "Линейка" }));
    expect(onToolSelect).toHaveBeenCalledWith("RULER");
  });

  it("сворачивает и разворачивает панель при клике на кнопку сворачивания", async () => {
    const props = createDefaultProps();
    const { container } = renderComponent(<MapToolbar {...props} />);

    const revealPolygon = container.querySelector(
      '[data-tool="FOG_POLYGON"] svg',
    );
    const coverPolygon = container.querySelector(
      '[data-tool="COVER_POLYGON"] svg',
    );
    expect(revealPolygon).not.toBeNull();
    expect(coverPolygon).not.toBeNull();
    expect(
      revealPolygon?.innerHTML,
      "UIX645_COLLAPSED_FOG_POLYGONS_REMAIN_DISTINCT",
    ).not.toBe(coverPolygon?.innerHTML);

    const collapseButton = screen.getByRole("button", {
      name: /Свернуть панель до значков/,
    });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(collapseButton);
    expect(collapseButton).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".map-toolbar")).toHaveClass("is-collapsed");
    expect(revealPolygon?.innerHTML).not.toBe(coverPolygon?.innerHTML);
  });

  it("снимает фокус с инструмента по Escape, не отменяя клавишу", async () => {
    const props = createDefaultProps();
    renderComponent(<MapToolbar {...props} />);
    const fog = screen.getByRole("button", { name: "Открыть туман" });
    fog.focus();
    expect(fog).toHaveFocus();

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    fog.dispatchEvent(escape);

    expect(fog).not.toHaveFocus();
    expect(escape.defaultPrevented).toBe(false);
  });

  it("lets an open tooltip own the first Escape before toolbar focus is released", async () => {
    const props = createDefaultProps();
    renderComponent(<MapToolbar {...props} />);
    const fog = screen.getByRole("button", { name: "Открыть туман" });
    await userEvent.hover(fog);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    fog.focus();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
    const tooltipId = fog.getAttribute("aria-describedby");
    const staleTooltip = tooltipId && document.getElementById(tooltipId);
    if (staleTooltip) expect(staleTooltip).not.toHaveAttribute("data-open");
    expect(fog).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(fog).not.toHaveFocus();
  });

  it("does not let a stale closed tooltip node keep toolbar focus on Escape", async () => {
    const props = createDefaultProps();
    renderComponent(<MapToolbar {...props} />);
    const fog = screen.getByRole("button", { name: "Открыть туман" });
    const stale = document.createElement("div");
    stale.id = "stale-toolbar-tooltip";
    stale.setAttribute("role", "tooltip");
    document.body.append(stale);
    fog.setAttribute("aria-describedby", stale.id);
    fog.focus();

    await userEvent.keyboard("{Escape}");

    expect(fog).not.toHaveFocus();
    stale.remove();
  });

  it("не возвращает боевые кнопки при сохранённом активном столкновении", () => {
    const props = createDefaultProps();
    props.snapshot.campaign.battleActive = true;
    renderComponent(<MapToolbar {...props} />);
    expect(
      screen.queryByRole("button", { name: "Завершить бой" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Начать бой" }),
    ).not.toBeInTheDocument();
  });

  it("UIX645_MAP_TOOLBAR_LUCIDE renders decorative SVG without glyph doubles", () => {
    const props = createDefaultProps();
    const { container } = renderComponent(<MapToolbar {...props} />);
    for (const tool of [
      "PAN",
      "FOG",
      "COVER",
      "FOG_BRUSH",
      "COVER_BRUSH",
      "FOG_POLYGON",
      "COVER_POLYGON",
      "RULER",
      "PING",
      "DRAW",
      "CURSOR_PRESENCE",
      "GRID",
      "RESIZE",
      "UNDO",
      "REDO",
    ]) {
      const control = container.querySelector<HTMLElement>(
        `[data-tool="${tool}"]`,
      );
      expect(control, `${tool} control`).not.toBeNull();
      expect(
        control!.querySelectorAll("svg.arken-icon"),
        `${tool} Lucide`,
      ).toHaveLength(1);
      expect(control!.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
    const collapse = screen.getByRole("button", {
      name: "Свернуть панель до значков",
    });
    expect(collapse.querySelectorAll("svg.arken-icon")).toHaveLength(1);
    const overflow = screen.getByLabelText("Дополнительные инструменты");
    expect(overflow.querySelectorAll("svg.arken-icon")).toHaveLength(1);
    expect(container.textContent).not.toContain("•••");
    expect(container.textContent).not.toContain("↶");
    expect(container.textContent).not.toContain("↷");
  });
});
