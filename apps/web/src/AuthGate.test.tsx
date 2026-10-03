// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  within,
} from "./test-support/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: apiMock }));
vi.mock("./LandingGuide", () => ({ LandingGuide: () => null }));

const { AuthGate } = await import("./AuthGate");

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("AuthGate quick player login", () => {
  it("dispatches only one login and disables player links while pending", async () => {
    let resolveLogin!: () => void;
    apiMock.mockImplementation(
      () => new Promise<void>((resolve) => (resolveLogin = resolve)),
    );
    window.history.replaceState({}, "", "/");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);

    const playerLinks = within(
      screen.getByRole("navigation", { name: "Постоянные игроки" }),
    ).getAllByRole("link");
    const [firstPlayer, secondPlayer] = playerLinks;
    fireEvent.click(firstPlayer!);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(firstPlayer).toHaveAttribute("aria-disabled", "true");
    expect(firstPlayer).toHaveAttribute("tabindex", "-1");
    expect(secondPlayer).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(secondPlayer!);
    expect(apiMock).toHaveBeenCalledTimes(1);

    await act(async () => resolveLogin!());
  });
});
