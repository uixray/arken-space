// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { MapToolbar, type MapToolbarProps } from "./MapToolbar";
import { cursorPreferenceDefault } from "./cursor-preference";

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
  it("рендерит инструменты для роли PLAYER: без тумана и боевой зоны", () => {
    const playerSnapshot = createMockSnapshot("PLAYER");
    const props = createDefaultProps({
      snapshot: playerSnapshot,
      viewSnapshot: playerSnapshot,
      cursorPreference: cursorPreferenceDefault("PLAYER"),
    });

    renderComponent(<MapToolbar {...props} />);

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
    renderComponent(<MapToolbar {...props} />);

    const collapseButton = screen.getByRole("button", {
      name: /Свернуть панель до значков/,
    });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(collapseButton);
    expect(collapseButton).toHaveAttribute("aria-expanded", "false");
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
});
