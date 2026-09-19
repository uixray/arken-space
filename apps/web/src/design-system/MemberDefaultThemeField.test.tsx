// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "@gravity-ui/uikit";
import { type ReactElement, type ReactNode } from "react";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: vi.fn() };
});

import { ApiError, api } from "../api";
import {
  renderComponent as renderBase,
  screen,
  act,
  userEvent,
  waitFor,
} from "../test-support/render";
import { PLAYER_THEMES } from "./player-themes";
import { MemberDefaultThemeField } from "./MemberDefaultThemeField";

function renderComponent(ui: ReactElement) {
  return renderBase(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider theme="dark" lang="ru">
        {children}
      </ThemeProvider>
    ),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

function field(revision = 0) {
  return (
    <MemberDefaultThemeField
      membership={{
        id: "11111111-1111-4111-8111-111111111111",
        defaultThemeId: "forest",
        revision,
      }}
      publishedThemes={PLAYER_THEMES}
    />
  );
}

async function chooseTheme(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(
    screen.getByRole("combobox", { name: "Тема игрока по умолчанию" }),
  );
  await user.click(screen.getByRole("option", { name }));
}

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

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("disables the selector and submit while its default-theme save is pending", async () => {
  const user = userEvent.setup();
  const save = deferred<{
    id: string;
    defaultThemeId: string;
    revision: number;
  }>();
  vi.mocked(api).mockReturnValueOnce(save.promise);
  renderComponent(field());

  await chooseTheme(user, "Драконы");
  await user.click(screen.getByRole("button", { name: "Назначить тему" }));
  await waitFor(() => expect(api).toHaveBeenCalledOnce());

  expect(
    screen.getByRole("combobox", { name: "Тема игрока по умолчанию" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Назначить тему" })).toBeDisabled();
  expect(
    screen.getByText("Тема игрока по умолчанию").closest(".field"),
  ).toHaveAttribute("aria-busy", "true");

  await act(async () =>
    save.resolve({
      id: "11111111-1111-4111-8111-111111111111",
      defaultThemeId: "dragons",
      revision: 1,
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Назначить тему" }),
    ).toBeDisabled(),
  );
});

it("adopts a same-member 409 revision and uses it for the next save", async () => {
  const user = userEvent.setup();
  const membershipId = "11111111-1111-4111-8111-111111111111";
  vi.mocked(api)
    .mockRejectedValueOnce(
      new ApiError(
        409,
        "THEME_DEFAULT_CONFLICT",
        "Conflict",
        undefined,
        undefined,
        {
          membership: { id: membershipId, defaultThemeId: "gold", revision: 7 },
        },
      ),
    )
    .mockResolvedValueOnce({
      id: membershipId,
      defaultThemeId: "dragons",
      revision: 8,
    });
  renderComponent(field());

  await chooseTheme(user, "Драконы");
  await user.click(screen.getByRole("button", { name: "Назначить тему" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Тема игрока уже изменена в другом окне.",
    ),
  );
  expect(
    screen.getByRole("combobox", { name: "Тема игрока по умолчанию" }),
  ).toHaveTextContent("Золото");

  await chooseTheme(user, "Драконы");
  await user.click(screen.getByRole("button", { name: "Назначить тему" }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api).mock.calls[1]).toEqual([
    `/api/members/${membershipId}/theme-default`,
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ defaultThemeId: "dragons", expectedRevision: 7 }),
    }),
  ]);
});

it("retains the draft and displays a generic network error", async () => {
  const user = userEvent.setup();
  vi.mocked(api).mockRejectedValueOnce(new Error("Network unavailable"));
  renderComponent(field());

  await chooseTheme(user, "Драконы");
  await user.click(screen.getByRole("button", { name: "Назначить тему" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Network unavailable"),
  );
  expect(
    screen.getByRole("combobox", { name: "Тема игрока по умолчанию" }),
  ).toHaveTextContent("Драконы");
});
