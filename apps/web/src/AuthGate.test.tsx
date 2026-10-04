// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  waitFor,
  within,
} from "./test-support/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: apiMock }));
vi.mock("./LandingGuide", () => ({ LandingGuide: () => null }));

const { AuthGate } = await import("./AuthGate");

const roadmapItems = [
  { id: "floating-ui", count: 4, voted: false },
  { id: "service-routine", count: 2, voted: false },
  { id: "bestiary-encounters", count: 1, voted: false },
];

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) =>
    path === "/api/public/roadmap-votes"
      ? Promise.resolve({ items: roadmapItems })
      : Promise.resolve(),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("AuthGate quick player login", () => {
  it("provides accessible links to the landing page sections", () => {
    window.history.replaceState({}, "", "/");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);

    const navigation = screen.getByRole("navigation", {
      name: "Разделы страницы",
    });
    expect(
      within(navigation).getByRole("link", { name: "Возможности" }),
    ).toHaveAttribute("href", "#capabilities-title");
    expect(
      within(navigation).getByRole("link", { name: "Как играть" }),
    ).toHaveAttribute("href", "#guide-title");
    expect(
      within(navigation).getByRole("link", { name: "Планы" }),
    ).toHaveAttribute("href", "#roadmap-title");
    expect(
      within(navigation).getByRole("link", { name: "Обновления" }),
    ).toHaveAttribute("href", "#changelog-title");
  });

  it("shows the published roadmap beyond the short preview on request", () => {
    window.history.replaceState({}, "", "/");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);

    expect(
      screen.queryByRole("heading", {
        name: "Знакомство с игрой для новых участников",
      }),
    ).not.toBeInTheDocument();
    const expand = screen.getByRole("button", {
      name: "Показать все планы",
    });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(expand).toHaveAttribute("aria-controls", "roadmap-planned-items");
    fireEvent.click(expand);

    expect(
      screen.getByRole("heading", {
        name: "Знакомство с игрой для новых участников",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Достижения" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Свернуть планы" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("dispatches only one login and disables player links while pending", async () => {
    let resolveLogin!: () => void;
    apiMock.mockImplementation((path: string) =>
      path === "/api/public/roadmap-votes"
        ? Promise.resolve({ items: roadmapItems })
        : new Promise<void>((resolve) => (resolveLogin = resolve)),
    );
    window.history.replaceState({}, "", "/");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);

    const playerLinks = within(
      screen.getByRole("navigation", { name: "Постоянные игроки" }),
    ).getAllByRole("link");
    const [firstPlayer, secondPlayer] = playerLinks;
    fireEvent.click(firstPlayer!);

    expect(
      apiMock.mock.calls.filter(
        ([path]) => path !== "/api/public/roadmap-votes",
      ),
    ).toHaveLength(1);
    expect(firstPlayer).toHaveAttribute("aria-disabled", "true");
    expect(firstPlayer).toHaveAttribute("tabindex", "-1");
    expect(secondPlayer).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(secondPlayer!);
    expect(
      apiMock.mock.calls.filter(
        ([path]) => path !== "/api/public/roadmap-votes",
      ),
    ).toHaveLength(1);

    await act(async () => resolveLogin!());
  });

  it("shows persisted public vote counts and toggles the selected plan", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/public/roadmap-votes")
        return Promise.resolve({ items: roadmapItems });
      if (path === "/api/public/roadmap-votes/floating-ui")
        return Promise.resolve({ id: "floating-ui", count: 5, voted: true });
      return Promise.resolve();
    });
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);
    const vote = await screen.findByRole("button", { name: /Голосовать.*4/ });
    fireEvent.click(vote);
    await waitFor(() => expect(vote).toHaveAttribute("aria-pressed", "true"));
    expect(vote).toHaveTextContent("5");
    expect(apiMock).toHaveBeenCalledWith(
      "/api/public/roadmap-votes/floating-ui",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
