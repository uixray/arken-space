// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AssetDto } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { AssetPicker } from "./AssetPicker";

// UIX-383: AssetPicker.test.ts (kept as-is, see that file's own UIX-390
// comment) only ever checked static markup via `renderToStaticMarkup`. That
// left every interactive behavior -- clicking a tile, arrow-key navigation
// between tiles, the text filter narrowing the grid -- unverified, even
// though `asset-picker-logic.ts`'s pure helpers behind them were tested.
// This file closes that gap with real DOM events (React Testing Library +
// user-event) instead of asserting on rendered HTML strings.
//
// AssetPicker has no @gravity-ui/uikit dependency, so unlike most other
// components in this app it needs no mocking here -- it is exercised as the
// real component tree end to end.

function asset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id: "asset-1",
    kind: "PORTRAIT",
    name: "Portrait One",
    mimeType: "image/png",
    sizeBytes: 1024,
    width: 512,
    height: 512,
    durationSeconds: null,
    url: "/api/assets/asset-1/content",
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("AssetPicker interaction", () => {
  it("calls onChange with the asset id when its tile is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderComponent(
      <AssetPicker
        assets={[asset({ id: "hero", name: "Hero Portrait" })]}
        value={null}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Hero Portrait" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("hero");
  });

  it("calls onChange(null) when the no-selection tile is clicked, even with a value selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderComponent(
      <AssetPicker
        assets={[asset({ id: "hero", name: "Hero Portrait" })]}
        value="hero"
        onChange={onChange}
        noneLabel="Без портрета"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Без портрета" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("moves focus to the next tile on ArrowRight and wraps around with ArrowLeft", async () => {
    const user = userEvent.setup();
    renderComponent(
      <AssetPicker
        assets={[asset({ id: "a", name: "Alpha" }), asset({ id: "b", name: "Beta" })]}
        value={null}
        onChange={() => {}}
        noneLabel="Без изображения"
      />,
    );

    const none = screen.getByRole("button", { name: "Без изображения" });
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });

    none.focus();
    expect(none).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(alpha).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(beta).toHaveFocus();

    // Wraps past the last tile back to "no selection".
    await user.keyboard("{ArrowRight}");
    expect(none).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(beta).toHaveFocus();
  });

  it("narrows the visible tiles as the user types in the filter", async () => {
    const user = userEvent.setup();
    renderComponent(
      <AssetPicker
        assets={[
          asset({ id: "hero", name: "Hero Portrait" }),
          asset({ id: "villain", name: "Villain Portrait" }),
        ]}
        value={null}
        onChange={() => {}}
        filterable
      />,
    );

    expect(screen.getByRole("button", { name: "Hero Portrait" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Villain Portrait" })).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: "Поиск изображений по имени" }),
      "hero",
    );

    expect(screen.getByRole("button", { name: "Hero Portrait" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Villain Portrait" }),
    ).not.toBeInTheDocument();
  });

  it("shows an accessible empty state and an optional call to action, without crashing", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderComponent(
      <AssetPicker
        assets={[]}
        value={null}
        onChange={() => {}}
        emptyAction={{ label: "Загрузить изображение", onSelect }}
      />,
    );

    expect(screen.getByText("Нет доступных изображений.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Загрузить изображение" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
