// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "./test-support/render";
const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: apiMock,
}));
const { AccountAuthWorkspace } = await import("./AccountAuthWorkspace");
const capabilities = {
  accountAuthEnabled: true,
  registrationEnabled: false,
  legacyDevEnabled: false,
  campaignLinkAccessEnabled: false,
  campaignCreationEnabled: false,
};
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});
it("requires changing an initial hosted password before loading campaigns, including after reload", async () => {
  window.history.replaceState({}, "", "/account");
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === "/api/account/session")
      return Promise.resolve({
        authenticated: true,
        account: {
          id: "11111111-1111-4111-8111-111111111111",
          identityKind: "HOSTED",
          login: "synthetic",
          email: null,
          verified: false,
          passwordChangeRequired: true,
        },
        csrfToken: "synthetic-csrf",
      });
    if (path === "/api/account/password/change")
      return Promise.resolve({ ok: true, revokedSessions: 1 });
    return Promise.resolve({ campaigns: [] });
  });
  renderComponent(
    <AccountAuthWorkspace
      capabilities={capabilities}
      onAuthenticated={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Задайте свой пароль" });
  expect(screen.queryByRole("heading", { name: "Мои кампании" })).toBeNull();
  expect(
    apiMock.mock.calls.some(([path]) => path === "/api/account/campaigns"),
  ).toBe(false);
  fireEvent.change(screen.getByLabelText("Временный пароль"), {
    target: { value: "synthetic-old-password" },
  });
  fireEvent.change(screen.getByLabelText("Новый пароль"), {
    target: { value: "synthetic-new-password" },
  });
  fireEvent.change(screen.getByLabelText("Повторите новый пароль"), {
    target: { value: "synthetic-new-password" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить новый пароль" }),
  );
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      "/api/account/password/change",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  await screen.findByText("Пароль изменён. Войдите снова.");
  expect(screen.getByRole("heading", { name: "Войти в аккаунт" })).toBeTruthy();
});
