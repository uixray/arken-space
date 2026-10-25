import { expect, test } from "./react-console-guard";

test("account-mode public and campaign-link auth boundaries remain explicit", async ({
  page,
}) => {
  const aliasRequests: string[] = [];
  const linkRequests: Array<{ path: string; body: unknown }> = [];
  let campaignLinkAccessEnabled = false;
  let holdInviteResponse = false;
  let releaseHeldInvite: (() => void) | undefined;
  let markInviteHeld: (() => void) | undefined;
  const inviteHeld = new Promise<void>((resolve) => {
    markInviteHeld = resolve;
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/account/capabilities")
      return route.fulfill({
        status: 200,
        json: {
          accountAuthEnabled: true,
          registrationEnabled: false,
          legacyDevEnabled: false,
          campaignLinkAccessEnabled,
          campaignCreationEnabled: false,
        },
      });
    if (request.method() === "GET" && path === "/api/account/session")
      return route.fulfill({ status: 200, json: { authenticated: false } });
    if (request.method() === "GET" && path === "/api/public/roadmap-votes")
      return route.fulfill({
        status: 200,
        json: { items: [], anonymousCookieLimit: "" },
      });
    if (request.method() === "GET" && path === "/api/bootstrap")
      return route.fulfill({
        status: 401,
        json: { error: "SESSION_REQUIRED" },
      });
    if (request.method() === "POST" && path === "/api/auth/invite") {
      linkRequests.push({ path, body: request.postDataJSON() });
      if (holdInviteResponse) {
        await new Promise<void>((resolve) => {
          releaseHeldInvite = resolve;
          markInviteHeld?.();
        });
      }
      return route.fulfill({ status: 410, json: { error: "INVITE_EXPIRED" } });
    }
    if (request.method() === "POST" && path === "/api/auth/gm") {
      linkRequests.push({ path, body: request.postDataJSON() });
      return route.fulfill({
        status: 403,
        json: { error: "INVALID_MASTER_TOKEN" },
      });
    }
    if (request.method() === "POST" && /^\/api\/auth\/player\//.test(path)) {
      aliasRequests.push(path);
      return route.fulfill({
        status: 410,
        json: { error: "PUBLIC_ALIAS_LOGIN_DISABLED" },
      });
    }
    throw new Error(
      `Unexpected UIX-527 API request: ${request.method()} ${path}`,
    );
  });

  try {
    await page.goto("/play/synthetic-public-handle");
    await expect(
      page.getByRole("heading", {
        name: "Эта ссылка больше не поддерживается",
      }),
    ).toBeVisible();
    expect(aliasRequests).toEqual([]);

    await page.goto("/join/synthetic-player-token");
    await expect(
      page.getByRole("heading", { name: "Присоединиться по ссылке" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByRole("status")).toHaveText(
      "Ссылка не отправлялась.",
    );
    const disabledSubmit = page.getByRole("button", {
      name: "Продолжить в игру",
    });
    await expect(disabledSubmit).toBeDisabled();
    expect(linkRequests).toEqual([]);

    campaignLinkAccessEnabled = true;
    await page.goto("/join/synthetic-player-token");
    await expect(
      page.getByRole("heading", { name: "Присоединиться по ссылке" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/join$/);
    await page.getByLabel("Имя в кампании").fill("Synthetic Adventurer");
    const playerSubmit = page.getByRole("button", {
      name: "Продолжить в игру",
    });
    holdInviteResponse = true;
    await playerSubmit.click();
    await inviteHeld;
    await expect(playerSubmit).toBeDisabled();
    expect(linkRequests).toEqual([
      {
        path: "/api/auth/invite",
        body: {
          token: "synthetic-player-token",
          displayName: "Synthetic Adventurer",
        },
      },
    ]);
    releaseHeldInvite?.();
    holdInviteResponse = false;
    await expect(page.getByRole("alert")).toHaveText(
      "Не удалось выполнить запрос",
    );
    await expect(playerSubmit).toBeEnabled();
    expect(linkRequests).toHaveLength(1);

    await page.goto("/gm/synthetic-gm-token");
    await expect(
      page.getByRole("heading", { name: "Войти как мастер по ссылке" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/gm$/);
    const gmSubmit = page.getByRole("button", { name: "Продолжить в игру" });
    await gmSubmit.click();
    await expect(page.getByRole("alert")).toHaveText(
      "Не удалось выполнить запрос",
    );
    await expect(gmSubmit).toBeEnabled();
    expect(linkRequests).toEqual([
      {
        path: "/api/auth/invite",
        body: {
          token: "synthetic-player-token",
          displayName: "Synthetic Adventurer",
        },
      },
      { path: "/api/auth/gm", body: { token: "synthetic-gm-token" } },
    ]);
    expect(aliasRequests).toEqual([]);
  } finally {
    releaseHeldInvite?.();
  }
});
