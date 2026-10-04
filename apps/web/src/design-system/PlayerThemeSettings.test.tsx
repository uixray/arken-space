// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "@gravity-ui/uikit";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement, type ReactNode } from "react";

import { renderComponent as renderBase, screen } from "../test-support/render";
import { PLAYER_THEMES } from "./player-themes";
import {
  PlayerThemeSettings,
  type PlayerThemeSettingsProps,
} from "./PlayerThemeSettings";

beforeEach(() => {
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

afterEach(() => vi.unstubAllGlobals());

function renderComponent(ui: ReactElement) {
  return renderBase(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider theme="dark" lang="ru">
        {children}
      </ThemeProvider>
    ),
  });
}

function props(
  overrides: Partial<PlayerThemeSettingsProps> = {},
): PlayerThemeSettingsProps {
  return {
    publishedThemes: PLAYER_THEMES,
    currentResolvedThemeId: "forest",
    defaultThemeId: "forest",
    savedOverrideThemeId: null,
    scopeKey: "player-1",
    onPreview: vi.fn(),
    onApply: vi.fn(),
    onReset: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

it("shows only the supplied catalogue plus a distinct system baseline", async () => {
  renderComponent(
    <PlayerThemeSettings
      {...props({
        publishedThemes: [
          ...PLAYER_THEMES.slice(0, 1),
          {
            id: "not-in-registry",
            name: "Неподдерживаемая",
            colorScheme: "dark",
            version: 1,
          },
        ],
      })}
    />,
  );

  expect(screen.getByRole("group", { name: "Тема" })).toBeInTheDocument();
  expect(
    screen.getByRole("radio", { name: "Лес — сейчас, по умолчанию" }),
  ).toBeChecked();
  expect(
    screen.getByRole("radio", { name: "Системное оформление" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("radio", { name: "Драконы" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("radio", { name: "Неподдерживаемая" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/не означает сброс/)).toBeInTheDocument();
});

it("returns the draft to the controlled appearance after a successful reset with an unchanged null override", async () => {
  const user = userEvent.setup();

  function ControlledHost() {
    const [appearance, setAppearance] = useState<"forest" | "dragons">(
      "forest",
    );
    return (
      <>
        <output aria-label="Применённая тема">{appearance}</output>
        <PlayerThemeSettings
          {...props({
            currentResolvedThemeId: appearance,
            defaultThemeId: "forest",
            savedOverrideThemeId: null,
            onPreview: (themeId) => {
              if (themeId === "forest" || themeId === "dragons")
                setAppearance(themeId);
            },
            // The saved adapter already contains null; only resolved appearance
            // changes when the successful reset is confirmed.
            onReset: () => setAppearance("forest"),
          })}
        />
      </>
    );
  }

  renderComponent(<ControlledHost />);
  await user.click(screen.getByRole("radio", { name: "Драконы" }));
  expect(
    screen.getByRole("status", { name: "Применённая тема" }),
  ).toHaveTextContent("dragons");
  expect(screen.getByRole("radio", { name: /Драконы/ })).toBeChecked();

  await user.click(
    screen.getByRole("button", { name: "Сбросить к моей теме" }),
  );
  expect(
    screen.getByRole("status", { name: "Применённая тема" }),
  ).toHaveTextContent("forest");
  expect(screen.getByRole("radio", { name: /Лес/ })).toBeChecked();
});

it("previews without saving, then applies the draft or cancels through explicit callbacks", async () => {
  const user = userEvent.setup();
  const onPreview = vi.fn();
  const onApply = vi.fn();
  const onCancel = vi.fn();
  renderComponent(
    <PlayerThemeSettings {...props({ onPreview, onApply, onCancel })} />,
  );

  await user.click(screen.getByRole("radio", { name: "Драконы" }));
  expect(onPreview).toHaveBeenCalledWith("dragons");
  expect(onApply).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Сохранить" }));
  expect(onApply).toHaveBeenCalledWith("dragons");
  await user.click(screen.getByRole("button", { name: "Отмена" }));
  expect(onCancel).toHaveBeenCalledOnce();
});

it("keeps a rejected draft, resets through the null-override callback, and drops it for a new scope", async () => {
  const user = userEvent.setup();
  const onReset = vi.fn();
  const initial = props({ onReset, savedOverrideThemeId: "gold" });
  const { rerender } = renderComponent(<PlayerThemeSettings {...initial} />);

  await user.click(screen.getByRole("radio", { name: "Драконы" }));
  rerender(
    <PlayerThemeSettings {...initial} error="Не удалось сохранить тему." />,
  );
  expect(screen.getByRole("radio", { name: "Драконы" })).toBeChecked();
  expect(
    screen.getByRole("group", { name: "Тема" }),
  ).toHaveAccessibleDescription(/Не удалось сохранить тему/);

  await user.click(
    screen.getByRole("button", { name: "Сбросить к моей теме" }),
  );
  expect(onReset).toHaveBeenCalledOnce();
  expect(screen.getByRole("radio", { name: "Драконы" })).toBeChecked();

  // The owner confirms reset by changing the persisted override to null.
  rerender(
    <PlayerThemeSettings
      {...initial}
      error={null}
      savedOverrideThemeId={null}
    />,
  );
  expect(screen.getByRole("radio", { name: /Лес/ })).toBeChecked();

  rerender(
    <PlayerThemeSettings
      {...initial}
      scopeKey="player-2"
      defaultThemeId="system"
      savedOverrideThemeId="gold"
    />,
  );
  expect(screen.getByRole("radio", { name: "Золото" })).toBeChecked();
});

it("offers explicit system and classic choices and never applies a removed catalogue item", async () => {
  const user = userEvent.setup();
  const onPreview = vi.fn();
  const onApply = vi.fn();
  const initial = props({ onPreview, onApply });
  const { rerender } = renderComponent(<PlayerThemeSettings {...initial} />);

  await user.click(screen.getByRole("radio", { name: "Прежнее оформление" }));
  expect(onPreview).toHaveBeenLastCalledWith("classic-v1");

  await user.click(screen.getByRole("radio", { name: "Системное оформление" }));
  expect(onPreview).toHaveBeenLastCalledWith("system");

  await user.click(screen.getByRole("radio", { name: "Драконы" }));
  rerender(
    <PlayerThemeSettings
      {...initial}
      publishedThemes={PLAYER_THEMES.filter(({ id }) => id !== "dragons")}
    />,
  );
  expect(screen.getByRole("radio", { name: /Лес/ })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Сохранить" }));
  expect(onApply).toHaveBeenLastCalledWith("forest");
});

it("disables every mutating action while a request is pending", () => {
  renderComponent(<PlayerThemeSettings {...props({ pending: true })} />);
  for (const radio of screen.getAllByRole("radio"))
    expect(radio).toBeDisabled();
  expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Отмена" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Сбросить к моей теме" }),
  ).toBeDisabled();
});
