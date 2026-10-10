// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
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
      : path === "/api/account/capabilities"
        ? Promise.resolve({ accountAuthEnabled: false, registrationEnabled: false, legacyDevEnabled: true })
        : Promise.resolve(),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("AuthGate quick player login", () => {
  it("uses legacy sign-in only when the capability endpoint explicitly allows local dev mode", async () => {
    window.history.replaceState({}, "", "/");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);
    expect(await screen.findByRole("navigation", { name: "Вход по персональной ссылке" })).toBeInTheDocument();
    expect(screen.queryByText("Выберите игрока из публичного списка")).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/api/account/capabilities");
  });

  it("preserves a captured legacy GM link token after URL cleanup in StrictMode", async () => {
    window.history.replaceState({}, "", "/gm/synthetic-legacy-gm-link");
    const onAuthenticated = vi.fn();
    renderComponent(<StrictMode><AuthGate onAuthenticated={onAuthenticated} /></StrictMode>);
    const signIn = await screen.findByRole("button", { name: "Войти в игру" });
    await waitFor(() => expect(window.location.pathname).toBe("/gm"));
    fireEvent.click(signIn);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/auth/gm", expect.objectContaining({
      method: "POST", body: JSON.stringify({ token: "synthetic-legacy-gm-link" }),
    })));
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it("preserves a captured legacy PLAYER link token after URL cleanup", async () => {
    window.history.replaceState({}, "", "/join/synthetic-legacy-player-link");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);
    const name = await screen.findByLabelText("Имя");
    fireEvent.change(name, { target: { value: "Synthetic Player" } });
    await waitFor(() => expect(window.location.pathname).toBe("/join"));
    fireEvent.click(screen.getByRole("button", { name: "Войти в игру" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/auth/invite", expect.objectContaining({
      method: "POST", body: JSON.stringify({ token: "synthetic-legacy-player-link", displayName: "Synthetic Player" }),
    })));
  });

  it("routes account mode to email/password UI without exposing beta aliases", async () => {
    apiMock.mockImplementation((path: string) => path === "/api/account/capabilities"
      ? Promise.resolve({ accountAuthEnabled: true, registrationEnabled: true, legacyDevEnabled: false, campaignLinkAccessEnabled: false, campaignCreationEnabled: false })
      : path === "/api/account/session" ? Promise.resolve({ authenticated: false })
        : path === "/api/public/roadmap-votes" ? Promise.resolve({ items: roadmapItems }) : Promise.resolve());
    window.history.replaceState({}, "", "/");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Войти в аккаунт" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Постоянные игроки" })).not.toBeInTheDocument();
  });

  it("provides accessible links to the landing page sections", async () => {
    window.history.replaceState({}, "", "/");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);

    const navigation = await screen.findByRole("navigation", {
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

  it("shows the published roadmap beyond the short preview on request", async () => {
    window.history.replaceState({}, "", "/");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);

    expect(
      screen.queryByRole("heading", {
        name: "Знакомство с игрой для новых участников",
      }),
    ).not.toBeInTheDocument();
    const expand = await screen.findByRole("button", {
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

  it("uses account-mode GM link only when explicitly enabled and clears the secret URL before submission", async () => {
    let resolveLogin!: () => void;
    apiMock.mockImplementation((path: string) =>
      path === "/api/public/roadmap-votes"
        ? Promise.resolve({ items: roadmapItems })
        : path === "/api/account/capabilities"
          ? Promise.resolve({ accountAuthEnabled: true, registrationEnabled: true, legacyDevEnabled: false, campaignLinkAccessEnabled: true, campaignCreationEnabled: false })
          : new Promise<void>((resolve) => (resolveLogin = resolve)),
    );
    window.history.replaceState({}, "", "/gm/synthetic-gm-token");
    const onAuthenticated = vi.fn();
    renderComponent(<AuthGate onAuthenticated={onAuthenticated} />);

    const signIn = await screen.findByRole("button", { name: "Продолжить в игру" });
    await waitFor(() => expect(window.location.pathname).toBe("/gm"));
    fireEvent.click(signIn);

    expect(
      apiMock.mock.calls.filter(
        ([path]) => path !== "/api/public/roadmap-votes" && path !== "/api/account/capabilities",
      ),
    ).toHaveLength(1);
    expect(apiMock).toHaveBeenCalledWith("/api/auth/gm", expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "synthetic-gm-token" }) }));
    expect(signIn).toBeDisabled();

    fireEvent.click(signIn);
    expect(
      apiMock.mock.calls.filter(
        ([path]) => path !== "/api/public/roadmap-votes" && path !== "/api/account/capabilities",
      ),
    ).toHaveLength(1);

    await act(async () => resolveLogin!());
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it("shows a disabled account-mode campaign link without falling back when capability is false", async () => {
    apiMock.mockImplementation((path: string) => path === "/api/account/capabilities"
      ? Promise.resolve({ accountAuthEnabled: true, registrationEnabled: true, legacyDevEnabled: false, campaignLinkAccessEnabled: false, campaignCreationEnabled: false })
      : path === "/api/account/session" ? Promise.resolve({ authenticated: false }) : Promise.resolve());
    window.history.replaceState({}, "", "/join/synthetic-invite-token");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Присоединиться по ссылке" })).toBeInTheDocument();
    expect(await screen.findByText(/пока не включён/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продолжить в игру" })).toBeDisabled();
    await waitFor(() => expect(window.location.pathname).toBe("/join"));
    expect(apiMock).not.toHaveBeenCalledWith("/api/auth/invite", expect.anything());
  });

  it("submits a PLAYER invite through the scoped link flow and never uses public alias login", async () => {
    apiMock.mockImplementation((path: string) => path === "/api/account/capabilities"
      ? Promise.resolve({ accountAuthEnabled: true, registrationEnabled: true, legacyDevEnabled: false, campaignLinkAccessEnabled: true, campaignCreationEnabled: false })
      : path === "/api/auth/invite" ? Promise.resolve({ ok: true })
        : path === "/api/public/roadmap-votes" ? Promise.resolve({ items: roadmapItems }) : Promise.resolve());
    window.history.replaceState({}, "", "/join/synthetic-player-grant-token");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);
    const input = await screen.findByLabelText("Имя в кампании");
    fireEvent.change(input, { target: { value: "Synthetic Adventurer" } });
    fireEvent.click(screen.getByRole("button", { name: "Продолжить в игру" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/auth/invite", expect.objectContaining({
      method: "POST", body: JSON.stringify({ token: "synthetic-player-grant-token", displayName: "Synthetic Adventurer" }),
    })));
    expect(apiMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/api\/auth\/player\//), expect.anything());
  });

  it("does not offer public alias login in account mode", async () => {
    apiMock.mockImplementation((path: string) => path === "/api/account/capabilities"
      ? Promise.resolve({ accountAuthEnabled: true, registrationEnabled: true, legacyDevEnabled: false, campaignLinkAccessEnabled: false, campaignCreationEnabled: false })
      : Promise.resolve({ authenticated: false }));
    window.history.replaceState({}, "", "/play/synthetic-public-alias");
    renderComponent(<AuthGate onAuthenticated={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Эта ссылка больше не поддерживается" })).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/api\/auth\/player\//), expect.anything());
  });

  it("shows persisted public vote counts and toggles the selected plan", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/account/capabilities")
        return Promise.resolve({ accountAuthEnabled: false, registrationEnabled: false, legacyDevEnabled: true });
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
