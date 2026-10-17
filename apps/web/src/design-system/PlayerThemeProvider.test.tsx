// @vitest-environment jsdom
import { StrictMode, type ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderComponent, screen } from "../test-support/render";
import { PlayerThemeProvider } from "./PlayerThemeProvider";

beforeEach(() => {
  document.documentElement.removeAttribute("data-player-theme");
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
});

afterEach(() => {
  document.documentElement.removeAttribute("data-player-theme");
  vi.unstubAllGlobals();
});

function provider(themeId: string | null): ReactElement {
  return (
    <PlayerThemeProvider themeId={themeId}>
      <span data-testid="themed-content">Содержимое</span>
    </PlayerThemeProvider>
  );
}

function gravityRoot(): HTMLElement {
  const root = screen.getByTestId("themed-content").closest(".arken-root");
  expect(root).not.toBeNull();
  return root as HTMLElement;
}

it("keeps the document attribute and actual Gravity color scheme in sync", () => {
  const { rerender } = renderComponent(provider("light"));
  expect(document.documentElement).toHaveAttribute(
    "data-player-theme",
    "light",
  );
  expect(gravityRoot()).toHaveClass("arken-root--theme-light");

  rerender(provider("classic-v1"));
  expect(document.documentElement).toHaveAttribute(
    "data-player-theme",
    "classic-v1",
  );
  expect(gravityRoot()).toHaveClass("arken-root--theme-dark");

  rerender(provider("forest"));
  expect(document.documentElement).toHaveAttribute(
    "data-player-theme",
    "forest",
  );
  expect(gravityRoot()).toHaveClass("arken-root--theme-dark");
});

it.each(["system", null, "not-published"] as const)(
  "uses the dark baseline without an attribute for %s",
  (themeId) => {
    document.documentElement.setAttribute("data-player-theme", "fire");
    renderComponent(provider(themeId));
    expect(document.documentElement).not.toHaveAttribute("data-player-theme");
    expect(gravityRoot()).toHaveClass("arken-root--theme-dark");
  },
);

it("removes its attribute on unmount", () => {
  const { unmount } = renderComponent(provider("gold"));
  expect(document.documentElement).toHaveAttribute("data-player-theme", "gold");
  unmount();
  expect(document.documentElement).not.toHaveAttribute("data-player-theme");
});

it("does not leak the attribute through StrictMode effect replay", () => {
  const { unmount } = renderComponent(
    <StrictMode>{provider("ice")}</StrictMode>,
  );
  expect(document.documentElement).toHaveAttribute("data-player-theme", "ice");
  expect(gravityRoot()).toHaveClass("arken-root--theme-dark");
  unmount();
  expect(document.documentElement).not.toHaveAttribute("data-player-theme");
});
