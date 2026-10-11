import { expect, test } from "./react-console-guard";

const accountSession = { authenticated: true, account: { id: "11111111-1111-4111-8111-111111111111", email: "person@example.test", verified: true }, csrfToken: "synthetic-csrf" };

test("account registration, verification, reset, login and logout in browser (mock transport)", async ({ page }) => {
  let authenticated = false;
  const posts: Array<{ path: string; body: unknown; csrf: string | null }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ status: 401, json: { error: "AUTH_REQUIRED" } });
    if (path === "/api/account/capabilities") return route.fulfill({ json: { accountAuthEnabled: true, registrationEnabled: true, legacyDevEnabled: false } });
    if (path === "/api/account/session") return route.fulfill({ json: authenticated ? accountSession : { authenticated: false } });
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      posts.push({ path, body, csrf: request.headers()["x-csrf-token"] ?? null });
      if (path === "/api/account/login") { authenticated = true; return route.fulfill({ json: accountSession }); }
      if (path === "/api/account/logout") { authenticated = false; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { ok: true, accepted: true } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Войти в аккаунт" })).toBeVisible();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByLabel("Email").fill("person@example.test");
  await page.getByLabel(/Пароль/).fill("secure phrase more than twelve");
  await page.getByLabel("Повторите пароль").fill("secure phrase more than twelve");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByText(/письмо для подтверждения уже отправлено/)).toBeVisible();

  await page.goto("/account/verify#token=synthetic-verification-token");
  await expect(page.getByRole("heading", { name: "Подтвердить email" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await page.getByRole("button", { name: "Подтвердить email" }).click();
  await expect(page.getByText("Email подтверждён. Теперь войдите в аккаунт.")).toBeVisible();

  await page.getByLabel("Email").fill("person@example.test");
  await page.getByLabel("Пароль").fill("secure phrase more than twelve");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("heading", { name: "Почта подтверждена" })).toBeVisible();
  await expect(page.getByText("person@example.test")).toBeVisible();
  await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await expect(page.getByRole("heading", { name: "Войти в аккаунт" })).toBeVisible();
  expect(posts.map((entry) => entry.path)).toEqual([
    "/api/account/register", "/api/account/verification/confirm", "/api/account/login", "/api/account/logout",
  ]);
  expect(JSON.stringify(posts)).not.toContain("token=synthetic");
  expect(posts.find((entry) => entry.path === "/api/account/logout")?.csrf).toBe("synthetic-csrf");
});

test("expired action link is recoverable without exposing its fragment token", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ status: 401, json: { error: "AUTH_REQUIRED" } });
    if (path === "/api/account/capabilities") return route.fulfill({ json: { accountAuthEnabled: true, registrationEnabled: false, legacyDevEnabled: false } });
    if (path === "/api/account/session") return route.fulfill({ json: { authenticated: false } });
    if (path === "/api/account/verification/confirm") return route.fulfill({ status: 400, json: { error: "INVALID_OR_EXPIRED_ACCOUNT_TOKEN" } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/account/verify#token=expired-synthetic-token");
  await expect(page.getByRole("heading", { name: "Подтвердить email" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить email" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Ссылка истекла или уже использована/);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
});

test("account mode shows a disabled legacy campaign link without fallback (mock transport)", async ({ page }) => {
  const posts: Array<{ path: string; body: unknown }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ status: 401, json: { error: "AUTH_REQUIRED" } });
    if (path === "/api/account/capabilities") return route.fulfill({ json: { accountAuthEnabled: true, registrationEnabled: true, legacyDevEnabled: false, campaignLinkAccessEnabled: false, campaignCreationEnabled: false } });
    if (request.method() === "POST") posts.push({ path, body: request.postDataJSON() });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/gm/synthetic-gm-link-token");
  await expect(page.getByRole("heading", { name: "Войти как мастер по ссылке" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/gm");
  await expect(page.getByRole("button", { name: "Продолжить в игру" })).toBeDisabled();
  expect(posts).toEqual([]);
});

test("account mode submits a legacy PLAYER grant only through the enabled link route (mock transport)", async ({ page }) => {
  const posts: Array<{ path: string; body: unknown }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ status: 401, json: { error: "AUTH_REQUIRED" } });
    if (path === "/api/account/capabilities") return route.fulfill({ json: { accountAuthEnabled: true, registrationEnabled: true, legacyDevEnabled: false, campaignLinkAccessEnabled: true, campaignCreationEnabled: false } });
    if (request.method() === "POST") posts.push({ path, body: request.postDataJSON() });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/join/synthetic-player-grant-token");
  await expect(page.getByRole("heading", { name: "Присоединиться по ссылке" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/join");
  await page.getByLabel("Имя в кампании").fill("Synthetic Player");
  await page.getByRole("button", { name: "Продолжить в игру" }).click();
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/");
  expect(posts).toEqual([{ path: "/api/auth/invite", body: { token: "synthetic-player-grant-token", displayName: "Synthetic Player" } }]);
  expect(posts.some((entry) => entry.path.includes("/player/"))).toBe(false);
});
