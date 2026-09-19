// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  act,
  fireEvent,
  renderComponent,
  screen,
} from "../test-support/render";
import { PlayerThemeRoot } from "./player-theme-runtime";
import { usePlayerThemeRuntime } from "./player-theme-runtime-context";
import {
  usePlayerThemePreference,
  type SavePlayerThemePreference,
} from "./usePlayerThemePreference";

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

function Controller({ themeId }: { themeId: string | null }) {
  const runtime = usePlayerThemeRuntime();
  useLayoutEffect(() => runtime.setThemeId(themeId), [runtime, themeId]);
  return <span>Приложение</span>;
}

it("keeps one Gravity root around application and portal owners while switching theme", () => {
  const { rerender, unmount } = renderComponent(
    <PlayerThemeRoot>
      <Controller themeId="light" />
      <div data-testid="toaster-owner" />
    </PlayerThemeRoot>,
  );
  const gravityRoot = screen.getByText("Приложение").closest(".g-root");
  expect(gravityRoot).toHaveClass("g-root_theme_light");
  expect(screen.getByTestId("toaster-owner").closest(".g-root")).toBe(
    gravityRoot,
  );
  expect(document.documentElement).toHaveAttribute(
    "data-player-theme",
    "light",
  );

  rerender(
    <PlayerThemeRoot>
      <Controller themeId={null} />
      <div data-testid="toaster-owner" />
    </PlayerThemeRoot>,
  );
  expect(screen.getByText("Приложение").closest(".g-root")).toHaveClass(
    "g-root_theme_dark",
  );
  expect(document.documentElement).not.toHaveAttribute("data-player-theme");
  unmount();
  expect(document.documentElement).not.toHaveAttribute("data-player-theme");
});

function PreferenceController({
  scopeKey,
  save,
}: {
  scopeKey: string | null;
  save: SavePlayerThemePreference;
}) {
  const runtime = usePlayerThemeRuntime();
  const preference = usePlayerThemePreference({
    scopeKey,
    preference: {
      selectedThemeId: scopeKey ? "light" : null,
      defaultThemeId: scopeKey ? "light" : null,
      revision: 1,
    },
    publishedThemeIds: ["light", "forest"],
    save,
  });
  useLayoutEffect(
    () => runtime.setThemeId(preference.selection),
    [preference.selection, runtime],
  );
  return (
    <button
      onClick={() => {
        preference.preview("forest");
        void preference.apply();
      }}
    >
      Сохранить лес
    </button>
  );
}

it("clears the old scope before paint and aborts its pending preference write", async () => {
  let requestSignal: AbortSignal | undefined;
  let resolveRequest!: (value: {
    selectedThemeId: string | null;
    defaultThemeId: string | null;
    revision: number;
  }) => void;
  const save: SavePlayerThemePreference = (_selection, { signal }) => {
    requestSignal = signal;
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  };
  const { rerender } = renderComponent(
    <PlayerThemeRoot>
      <PreferenceController scopeKey="campaign-a:member-a" save={save} />
    </PlayerThemeRoot>,
  );
  expect(document.documentElement).toHaveAttribute(
    "data-player-theme",
    "light",
  );
  fireEvent.click(screen.getByRole("button", { name: "Сохранить лес" }));

  rerender(
    <PlayerThemeRoot>
      <PreferenceController scopeKey={null} save={save} />
    </PlayerThemeRoot>,
  );
  expect(requestSignal?.aborted).toBe(true);
  expect(document.documentElement).not.toHaveAttribute("data-player-theme");
  await act(async () =>
    resolveRequest({
      selectedThemeId: "forest",
      defaultThemeId: "forest",
      revision: 2,
    }),
  );
  expect(document.documentElement).not.toHaveAttribute("data-player-theme");
});
