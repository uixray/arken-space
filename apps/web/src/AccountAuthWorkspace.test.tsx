// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { ApiError } from "./api";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "./test-support/render";
const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: apiMock,
}));
const { AccountAuthWorkspace } = await import("./AccountAuthWorkspace");
const session = {
  authenticated: true as const,
  account: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "person@example.test",
    verified: true,
  },
  csrfToken: "synthetic-csrf-token",
};
const verifyToken = "synthetic-verification-token-123456789";
const resetToken = "synthetic-reset-token-123456789012";
const capabilities = {
  accountAuthEnabled: true,
  registrationEnabled: true,
  legacyDevEnabled: false,
  campaignLinkAccessEnabled: false,
  campaignCreationEnabled: false,
} as const;
beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) =>
    path === "/api/account/session"
      ? Promise.resolve({ authenticated: false })
      : path === "/api/account/campaigns"
        ? Promise.resolve({ campaigns: [] })
        : Promise.resolve({ ok: true }),
  );
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});
describe("AccountAuthWorkspace", () => {
  it("registers without creating a session or storing the password", async () => {
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={capabilities}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Создать аккаунт" }),
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/Пароль/), {
      target: { value: "a secure pass phrase" },
    });
    fireEvent.change(screen.getByLabelText("Повторите пароль"), {
      target: { value: "a secure pass phrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    await screen.findByText(
      "Если адрес можно зарегистрировать, запрос на подтверждение принят. Проверьте почту позже.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      /отправлено|доставлено/i,
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/account/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(localStorage.length).toBe(0);
  });
  it("consumes an emailed verification token, clears the URL, then permits login", async () => {
    window.history.replaceState({}, "", `/account/verify#token=${verifyToken}`);
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve({ authenticated: false })
        : Promise.resolve({ ok: true }),
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={capabilities}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Подтвердить email" }),
    );
    await screen.findByRole("heading", { name: "Войти в аккаунт" });
    expect(window.location.hash).toBe("");
    expect(apiMock).toHaveBeenCalledWith(
      "/api/account/verification/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: verifyToken }),
      }),
    );
  });
  it("consumes verification token once under StrictMode and preserves action flow for an authenticated session", async () => {
    window.history.replaceState({}, "", `/account/verify#token=${verifyToken}`);
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve(session)
        : Promise.resolve({ ok: true }),
    );
    renderComponent(
      <StrictMode>
        <AccountAuthWorkspace
          onAuthenticated={vi.fn()}
          capabilities={capabilities}
        />
      </StrictMode>,
    );
    expect(
      await screen.findByRole("heading", { name: "Подтвердить email" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Подтвердить email" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить email" }));
    await screen.findByRole("heading", { name: "Войти в аккаунт" });
    expect(
      apiMock.mock.calls.filter(
        ([path]) => path === "/api/account/verification/confirm",
      ),
    ).toHaveLength(1);
    expect(window.location.hash).toBe("");
  });
  it("keeps a reset action route ahead of an existing account session", async () => {
    window.history.replaceState(
      {},
      "",
      `/account/reset-password#token=${resetToken}`,
    );
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve(session)
        : Promise.resolve({ ok: true }),
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={{ ...capabilities, registrationEnabled: false }}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Задать новый пароль" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("person@example.test");
    expect(
      screen.getByRole("button", { name: "Сохранить новый пароль" }),
    ).toBeEnabled();
  });
  it("posts reset token only in body and enforces password confirmation", async () => {
    window.history.replaceState(
      {},
      "",
      `/account/reset-password#token=${resetToken}`,
    );
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve({ authenticated: false })
        : Promise.resolve({ ok: true }),
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={{ ...capabilities, registrationEnabled: false }}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "person@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/Пароль/), {
      target: { value: "another secure phrase" },
    });
    fireEvent.change(screen.getByLabelText("Повторите пароль"), {
      target: { value: "another secure phrase" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить новый пароль" }),
    );
    await screen.findByText("Пароль изменён. Войдите с новым паролем.");
    expect(window.location.hash).toBe("");
    expect(apiMock).toHaveBeenCalledWith(
      "/api/account/password/reset/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          token: resetToken,
          password: "another secure phrase",
        }),
      }),
    );
  });
  it("uses session CSRF for password change and clears the revoked session", async () => {
    const onAuthenticated = vi.fn();
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve(session)
        : Promise.resolve({ ok: true, revokedSessions: 0 }),
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={onAuthenticated}
        capabilities={capabilities}
      />,
    );
    await screen.findByRole("heading", { name: "Добро пожаловать" });
    fireEvent.click(screen.getByText("Изменить пароль"));
    fireEvent.change(screen.getByLabelText("Текущий пароль"), {
      target: { value: "old secure phrase" },
    });
    fireEvent.change(screen.getByLabelText("Новый пароль"), {
      target: { value: "new secure phrase" },
    });
    fireEvent.change(screen.getByLabelText("Повторите новый пароль"), {
      target: { value: "new secure phrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/account/password/change",
        expect.objectContaining({
          headers: { "x-csrf-token": session.csrfToken },
        }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Войти в аккаунт" }),
    ).toBeInTheDocument();
  });
  it("uses the in-memory session CSRF token for logout", async () => {
    const onAuthenticated = vi.fn();
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve(session)
        : Promise.resolve({ ok: true }),
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={onAuthenticated}
        capabilities={capabilities}
      />,
    );
    await screen.findByRole("heading", { name: "Добро пожаловать" });
    fireEvent.click(screen.getByRole("button", { name: "Выйти из аккаунта" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/account/logout",
        expect.objectContaining({
          headers: { "x-csrf-token": session.csrfToken },
        }),
      ),
    );
    expect(onAuthenticated).toHaveBeenCalled();
  });
  it("keeps unverified login generic and offers a verification resend", async () => {
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve({ authenticated: false })
        : Promise.reject(
            new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials"),
          ),
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={{ ...capabilities, registrationEnabled: false }}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Логин или email"), {
      target: { value: "person@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "unverified password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Проверьте логин или email и пароль",
    );
    expect(
      screen.getByRole("button", {
        name: "Отправить письмо для подтверждения",
      }),
    ).toBeInTheDocument();
  });
  it("describes verification resend and reset as accepted requests, not delivered mail", async () => {
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve({ authenticated: false })
        : Promise.resolve({ accepted: true }),
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={capabilities}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Логин или email"), {
      target: { value: "person@example.test" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Отправить письмо для подтверждения",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Если аккаунту требуется подтверждение, запрос принят.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      /отправлено|доставлено/i,
    );
    fireEvent.click(screen.getByRole("button", { name: "Забыли пароль?" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить инструкцию" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Если аккаунт существует, запрос принят.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      /отправлено|доставлено/i,
    );
  });
  it("renders expired action token errors without echoing the token", async () => {
    window.history.replaceState({}, "", `/account/verify#token=${verifyToken}`);
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve({ authenticated: false })
        : Promise.reject(
            new ApiError(400, "INVALID_OR_EXPIRED_ACCOUNT_TOKEN", "Expired"),
          ),
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={{ ...capabilities, registrationEnabled: false }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Подтвердить email" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ссылка истекла или уже использована",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(verifyToken);
  });
  it("shows local password validation rather than a generic request failure", async () => {
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={capabilities}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Создать аккаунт" }),
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/Пароль/), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("Повторите пароль"), {
      target: { value: "different" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Пароли не совпадают",
    );
  });
  it("creates a campaign and an invitation link with account CSRF", async () => {
    const onAuthenticated = vi.fn();
    const list = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "My table",
        role: "GM",
        membershipId: "33333333-3333-4333-8333-333333333333",
        selected: true,
      },
    ];
    let created = false;
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/api/account/session") return Promise.resolve(session);
      if (path === "/api/account/campaigns" && !options)
        return Promise.resolve({ campaigns: created ? list : [] });
      if (path === "/api/account/campaigns" && options?.method === "POST") {
        created = true;
        return Promise.resolve({
          campaignId: list[0]!.id,
          membershipId: list[0]!.membershipId,
          name: list[0]!.name,
          role: "GM",
        });
      }
      if (path === "/api/account/campaigns/invites")
        return Promise.resolve({
          inviteId: "44444444-4444-4444-8444-444444444444",
          token: "synthetic-campaign-invite-token",
          expiresAt: new Date(0).toISOString(),
          role: "PLAYER",
        });
      if (path === "/api/account/campaigns/select")
        return Promise.resolve({
          campaignId: list[0]!.id,
          membershipId: list[0]!.membershipId,
          role: "GM",
        });
      return Promise.resolve({ campaigns: list });
    });
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={onAuthenticated}
        capabilities={{ ...capabilities, campaignCreationEnabled: true }}
      />,
    );
    await screen.findByRole("heading", { name: "Мои кампании" });
    fireEvent.click(
      screen.getByText("Создать кампанию", { selector: "summary" }),
    );
    fireEvent.change(screen.getByLabelText("Новая кампания"), {
      target: { value: "My table" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать кампанию" }));
    await screen.findByText("My table");
    fireEvent.click(
      screen.getByText("Пригласить игрока", { selector: "summary" }),
    );
    fireEvent.change(screen.getByLabelText("Приглашение игроку"), {
      target: { value: "Player one" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Создать ссылку-приглашение" }),
    );
    const invite = await screen.findByLabelText(
      "Личная ссылка (действует до 72 часов)",
    );
    expect((invite as HTMLInputElement).value).toContain(
      "/account/join#token=synthetic-campaign-invite-token",
    );
    const createCall = apiMock.mock.calls.find(
      (call) =>
        call[0] === "/api/account/campaigns" &&
        (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(createCall?.[1]).toMatchObject({
      headers: { "x-csrf-token": session.csrfToken },
    });
    fireEvent.click(screen.getByRole("button", { name: "Открыть кампанию" }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
  });
  it("claims a campaign invite token from the URL fragment", async () => {
    window.history.replaceState(
      {},
      "",
      "/account/join#token=synthetic-claim-token-1234567890123456789012345",
    );
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/account/session") return Promise.resolve(session);
      if (path === "/api/account/campaigns")
        return Promise.resolve({ campaigns: [] });
      if (path === "/api/account/campaigns/invites/claim")
        return Promise.resolve({
          campaignId: "22222222-2222-4222-8222-222222222222",
          membershipId: "33333333-3333-4333-8333-333333333333",
          role: "PLAYER",
        });
      return Promise.resolve({ ok: true });
    });
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={capabilities}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Присоединиться" }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    fireEvent.click(
      screen.getByRole("button", { name: "Принять приглашение" }),
    );
    await screen.findByText(
      "Вы присоединились к кампании. Выберите её, чтобы открыть игровой стол.",
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/account/campaigns/invites/claim",
      expect.objectContaining({
        body: JSON.stringify({
          token: "synthetic-claim-token-1234567890123456789012345",
        }),
        headers: { "x-csrf-token": session.csrfToken },
      }),
    );
  });
  it("keeps the invite-claim lock synchronous against immediate duplicate submits", async () => {
    let resolveClaim!: (value: unknown) => void;
    let claimCalls = 0;
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/account/session") return Promise.resolve(session);
      if (path === "/api/account/campaigns")
        return Promise.resolve({ campaigns: [] });
      if (path === "/api/account/campaigns/invites/claim") {
        claimCalls += 1;
        return new Promise((resolve) => {
          resolveClaim = resolve;
        });
      }
      return Promise.resolve({ ok: true });
    });
    window.history.replaceState(
      {},
      "",
      "/account/join#token=synthetic-claim-token-1234567890123456789012345",
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={capabilities}
      />,
    );
    await screen.findByRole("heading", { name: "Присоединиться" });
    const button = await screen.findByRole("button", {
      name: "Принять приглашение",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(claimCalls).toBe(1));
    resolveClaim({
      campaignId: "22222222-2222-4222-8222-222222222222",
      membershipId: "33333333-3333-4333-8333-333333333333",
      role: "PLAYER",
    });
  });
  it("accepts a same-origin invite URL pasted into the account form and rejects foreign links", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/account/session") return Promise.resolve(session);
      if (path === "/api/account/campaigns")
        return Promise.resolve({ campaigns: [] });
      return Promise.resolve({ campaigns: [] });
    });
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={capabilities}
      />,
    );
    await screen.findByRole("heading", { name: "Мои кампании" });
    fireEvent.change(screen.getByLabelText("Ссылка-приглашение"), {
      target: {
        value: "https://elsewhere.example/account/join#token=synthetic-token",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Присоединиться к кампании" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Вставьте действительную ссылку-приглашение",
    );
    expect(
      apiMock.mock.calls.some(
        ([path]) => path === "/api/account/campaigns/invites/claim",
      ),
    ).toBe(false);
  });
  it("retries uncertain campaign creation with the exact original idempotency payload", async () => {
    let calls = 0;
    const submitted: unknown[] = [];
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/api/account/session") return Promise.resolve(session);
      if (path === "/api/account/campaigns" && options?.method === "POST") {
        submitted.push(JSON.parse(String(options.body)));
        calls += 1;
        if (calls === 1)
          return Promise.reject(new Error("Connection was interrupted"));
        return Promise.resolve({
          campaignId: "22222222-2222-4222-8222-222222222222",
          membershipId: "33333333-3333-4333-8333-333333333333",
          name: "Retry table",
          role: "GM",
        });
      }
      if (path === "/api/account/campaigns")
        return Promise.resolve({ campaigns: [] });
      return Promise.resolve({ campaigns: [] });
    });
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={{ ...capabilities, campaignCreationEnabled: true }}
      />,
    );
    await screen.findByRole("heading", { name: "Мои кампании" });
    const name = screen.getByLabelText("Новая кампания");
    fireEvent.change(name, { target: { value: "Retry table" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать кампанию" }));
    await screen.findByRole("button", { name: "Повторить создание" });
    expect(name).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Повторить создание" }));
    await screen.findByText("Кампания «Retry table» создана.");
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toEqual(submitted[1]);
  });
  it("retains the original campaign key when session selection returns 401 after a possible commit", async () => {
    const submitted: Array<Record<string, unknown>> = [];
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/api/account/session") return Promise.resolve(session);
      if (path === "/api/account/campaigns" && options?.method === "POST") {
        submitted.push(JSON.parse(String(options.body)));
        if (submitted.length === 1)
          return Promise.reject(
            new ApiError(401, "ACCOUNT_AUTH_REQUIRED", "Войдите снова"),
          );
        return Promise.resolve({
          campaignId: "22222222-2222-4222-8222-222222222222",
          membershipId: "33333333-3333-4333-8333-333333333333",
          name: "Retry 401",
          role: "GM",
        });
      }
      return Promise.resolve({ campaigns: [] });
    });
    const view = renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={{ ...capabilities, campaignCreationEnabled: true }}
      />,
    );
    await screen.findByRole("heading", { name: "Мои кампании" });
    fireEvent.change(screen.getByLabelText("Новая кампания"), {
      target: { value: "Retry 401" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать кампанию" }));
    await screen.findByRole("button", { name: "Повторить создание" });
    expect(screen.getByLabelText("Новая кампания")).toBeDisabled();
    const stored = JSON.parse(
      sessionStorage.getItem(
        `arken.account.campaign-create.v1.${session.account.id}`,
      )!,
    );
    expect(Object.keys(stored).sort()).toEqual([
      "accountId",
      "key",
      "name",
      "uncertain",
    ]);
    expect(JSON.stringify(stored)).not.toContain(session.csrfToken);
    view.unmount();
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={{ ...capabilities, campaignCreationEnabled: true }}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Повторить создание" }),
    );
    await screen.findByText("Кампания «Retry 401» создана.");
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(
      sessionStorage.getItem(
        `arken.account.campaign-create.v1.${session.account.id}`,
      ),
    ).toBeNull();
  });
  it("preserves corrupt campaign creation state and blocks new creation", async () => {
    const key = `arken.account.campaign-create.v1.${session.account.id}`;
    sessionStorage.setItem(key, "{");
    apiMock.mockImplementation((path: string) =>
      path === "/api/account/session"
        ? Promise.resolve(session)
        : Promise.resolve({ campaigns: [] }),
    );
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={{ ...capabilities, campaignCreationEnabled: true }}
      />,
    );
    expect(
      await screen.findByText(/запрос создания кампании повреждён/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Создать кампанию" }),
    ).toBeDisabled();
    expect(sessionStorage.getItem(key)).toBe("{");
  });
  it("permits a second intentional invite after the first invite is confirmed", async () => {
    let inviteCount = 0;
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/account/session") return Promise.resolve(session);
      if (path === "/api/account/campaigns")
        return Promise.resolve({
          campaigns: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "My table",
              role: "GM",
              membershipId: "33333333-3333-4333-8333-333333333333",
              selected: true,
            },
          ],
        });
      if (path === "/api/account/campaigns/invites") {
        inviteCount += 1;
        return Promise.resolve({
          inviteId: `44444444-4444-4444-8444-44444444444${inviteCount}`,
          token: `synthetic-player-invite-token-${inviteCount}-12345678901234567890`,
          expiresAt: new Date(0).toISOString(),
          role: "PLAYER",
        });
      }
      return Promise.resolve({ ok: true });
    });
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={capabilities}
      />,
    );
    await screen.findByRole("heading", { name: "Мои кампании" });
    const inviteButton = await screen.findByRole("button", {
      name: "Создать ссылку-приглашение",
    });
    fireEvent.click(inviteButton);
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "Личная ссылка (действует до 72 часов)",
          ) as HTMLInputElement
        ).value,
      ).toContain("synthetic-player-invite-token-1"),
    );
    fireEvent.click(inviteButton);
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "Личная ссылка (действует до 72 часов)",
          ) as HTMLInputElement
        ).value,
      ).toContain("synthetic-player-invite-token-2"),
    );
    expect(inviteCount).toBe(2);
  });
  it("blocks a second invite after an uncertain result until reload", async () => {
    let inviteCount = 0;
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/account/session") return Promise.resolve(session);
      if (path === "/api/account/campaigns")
        return Promise.resolve({
          campaigns: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "My table",
              role: "GM",
              membershipId: "33333333-3333-4333-8333-333333333333",
              selected: true,
            },
          ],
        });
      if (path === "/api/account/campaigns/invites") {
        inviteCount += 1;
        return Promise.reject(new Error("network lost"));
      }
      return Promise.resolve({ ok: true });
    });
    renderComponent(
      <AccountAuthWorkspace
        onAuthenticated={vi.fn()}
        capabilities={capabilities}
      />,
    );
    await screen.findByRole("heading", { name: "Мои кампании" });
    const inviteButton = await screen.findByRole("button", {
      name: "Создать ссылку-приглашение",
    });
    fireEvent.click(inviteButton);
    await screen.findByRole("alert");
    expect(inviteButton).toBeDisabled();
    expect(inviteCount).toBe(1);
  });
});
it("creates a local account from an invitation and signs in without persisting the secret", async () => {
  const invite = "i".repeat(48),
    password = "a secure player password";
  window.history.replaceState({}, "", `/account/join#token=${invite}`);
  const localSession = {
    authenticated: true,
    account: {
      id: "11111111-1111-4111-8111-111111111111",
      identityKind: "LOCAL",
      login: "local-player",
      verified: false,
    },
    csrfToken: "synthetic-csrf",
  };
  apiMock.mockImplementation((path: string) =>
    path === "/api/account/session"
      ? Promise.resolve({ authenticated: false })
      : path === "/api/account/local/enroll"
        ? Promise.resolve({
            login: "local-player",
            campaignId: "00000000-0000-4000-8000-000000000009",
            role: "PLAYER",
          })
        : path === "/api/account/login"
          ? Promise.resolve(localSession)
          : path === "/api/account/campaigns"
            ? Promise.resolve({ campaigns: [] })
            : Promise.resolve({ ok: true }),
  );
  const firstRender = renderComponent(
    <AccountAuthWorkspace
      onAuthenticated={vi.fn()}
      capabilities={{
        ...capabilities,
        localAccounts: true,
        localTransport: "HTTPS_LAN",
      }}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Нет аккаунта — создать по приглашению",
    }),
  );
  fireEvent.change(screen.getByLabelText("Локальный логин"), {
    target: { value: "local-player" },
  });
  fireEvent.change(screen.getByLabelText("Пароль", { exact: true }), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Повторите пароль"), {
    target: { value: password },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Создать аккаунт и принять приглашение",
    }),
  );
  await screen.findByText(
    "Локальный аккаунт создан, приглашение принято. Войдите с выбранным логином и паролем.",
  );
  expect(window.location.hash).toBe("");
  expect(localStorage.length).toBe(0);
  expect(window.location.pathname).toBe("/account");
  const savedWelcome = sessionStorage.getItem("arken.local-first-run.v1");
  expect(savedWelcome).not.toContain(password);
  expect(savedWelcome).not.toContain(invite);
  expect(apiMock).toHaveBeenCalledWith(
    "/api/account/local/enroll",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ login: "local-player", password, token: invite }),
    }),
  );
  expect(
    (screen.getByLabelText("Пароль", { exact: true }) as HTMLInputElement)
      .value,
  ).toBe("");
  firstRender.unmount();
  renderComponent(
    <AccountAuthWorkspace
      onAuthenticated={vi.fn()}
      capabilities={{
        ...capabilities,
        localAccounts: true,
        localTransport: "HTTPS_LAN",
      }}
    />,
  );
  fireEvent.change(await screen.findByLabelText("Локальный логин"), {
    target: { value: "local-player" },
  });
  fireEvent.change(screen.getByLabelText("Пароль", { exact: true }), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "Войти" }));
  await screen.findByRole("heading", { name: "Мои кампании" });
  expect(
    screen.getByRole("heading", { name: "Локальный аккаунт" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/локальный аккаунт сервера мастера/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Вы в кампании" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Создать персонажа/)).toBeInTheDocument();
  expect(sessionStorage.getItem("arken.local-first-run.v1")).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "Почта подтверждена" }),
  ).not.toBeInTheDocument();
  expect(apiMock).toHaveBeenCalledWith(
    "/api/account/login",
    expect.objectContaining({
      body: JSON.stringify({ login: "local-player", password }),
    }),
  );
  expect(localStorage.length).toBe(0);
});
it("does not show another local login's saved welcome", async () => {
  window.history.replaceState({}, "", "/account");
  sessionStorage.setItem(
    "arken.local-first-run.v1",
    JSON.stringify({
      login: "local-first",
      campaignId: "00000000-0000-4000-8000-000000000009",
    }),
  );
  apiMock.mockImplementation((path: string) =>
    path === "/api/account/session"
      ? Promise.resolve({ authenticated: false })
      : path === "/api/account/login"
        ? Promise.resolve({
            authenticated: true,
            account: {
              id: "other",
              identityKind: "LOCAL",
              login: "local-other",
            },
            csrfToken: "csrf",
          })
        : path === "/api/account/campaigns"
          ? Promise.resolve({ campaigns: [] })
          : Promise.resolve({ ok: true }),
  );
  renderComponent(
    <AccountAuthWorkspace
      onAuthenticated={vi.fn()}
      capabilities={{
        ...capabilities,
        localAccounts: true,
        localTransport: "HTTPS_LAN",
      }}
    />,
  );
  fireEvent.change(await screen.findByLabelText("Локальный логин"), {
    target: { value: "local-other" },
  });
  fireEvent.change(screen.getByLabelText("Пароль", { exact: true }), {
    target: { value: "a secure player password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Войти" }));
  await screen.findByRole("heading", { name: "Мои кампании" });
  expect(
    screen.queryByRole("heading", { name: "Вы в кампании" }),
  ).not.toBeInTheDocument();
  expect(sessionStorage.getItem("arken.local-first-run.v1")).toBeNull();
});
it("offers local sign-in rather than silently retrying uncertain enrollment", async () => {
  const invite = "j".repeat(48),
    password = "another secure password";
  window.history.replaceState({}, "", `/account/join#token=${invite}`);
  apiMock.mockImplementation((path: string) =>
    path === "/api/account/session"
      ? Promise.resolve({ authenticated: false })
      : path === "/api/account/local/enroll"
        ? Promise.reject(
            new ApiError(503, "LOCAL_ENROLLMENT_UNAVAILABLE", "unknown"),
          )
        : path === "/api/account/login"
          ? Promise.resolve({
              authenticated: true,
              account: {
                id: "u",
                identityKind: "LOCAL",
                login: "uncertain-player",
              },
              csrfToken: "csrf",
            })
          : path === "/api/account/campaigns/invites/claim"
            ? Promise.resolve({
                campaignId: "c",
                membershipId: "m",
                role: "PLAYER",
              })
            : path === "/api/account/campaigns"
              ? Promise.resolve({ campaigns: [] })
              : Promise.resolve({ ok: true }),
  );
  renderComponent(
    <AccountAuthWorkspace
      onAuthenticated={vi.fn()}
      capabilities={{
        ...capabilities,
        localAccounts: true,
        localTransport: "HTTPS_LAN",
      }}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Нет аккаунта — создать по приглашению",
    }),
  );
  fireEvent.change(screen.getByLabelText("Локальный логин"), {
    target: { value: "uncertain-player" },
  });
  fireEvent.change(screen.getByLabelText("Пароль", { exact: true }), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Повторите пароль"), {
    target: { value: password },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Создать аккаунт и принять приглашение",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Попробуйте войти с выбранным логином и паролем",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Уже есть аккаунт — войти" }),
  );
  expect(
    screen.getByRole("button", { name: "Принять приглашение" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Пароль", { exact: true }), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "Принять приглашение" }));
  await screen.findByRole("heading", { name: "Мои кампании" });
  expect(apiMock).toHaveBeenCalledWith(
    "/api/account/campaigns/invites/claim",
    expect.objectContaining({ body: JSON.stringify({ token: invite }) }),
  );
  expect(
    apiMock.mock.calls.filter(([path]) => path === "/api/account/local/enroll"),
  ).toHaveLength(1);
  expect(window.location.hash).toBe("");
  expect(localStorage.length).toBe(0);
});
