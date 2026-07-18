import { expect, test, type Page } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";

const baseSnapshot: GameSnapshot = {
  campaign: { id: "campaign-1", name: "Первая экспедиция" },
  me: {
    id: "membership-gm",
    role: "GM",
    displayName: "Мастер",
    characterId: null,
  },
  members: [
    {
      id: "membership-gm",
      role: "GM",
      displayName: "Мастер",
      characterId: null,
    },
  ],
  characters: [],
  scenes: [
    {
      id: "scene-1",
      name: "Первая сцена",
      projection: "ORTHOGRAPHIC_2D",
      mapAssetId: null,
      width: 1600,
      height: 1000,
      grid: {
        enabled: true,
        size: 64,
        offsetX: 0,
        offsetY: 0,
        color: "#c8b78b",
        opacity: 0.22,
      },
      active: true,
    },
  ],
  tokens: [],
  fogReveals: [],
  messages: [],
  assets: [],
  catalogEntries: [],
  tokenDefinitions: [],
  audio: {
    assetId: null,
    playing: false,
    positionSeconds: 0,
    loop: false,
    startedAt: null,
    revision: 0,
    updatedAt: new Date().toISOString(),
  },
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: new Date().toISOString(),
};

async function mockAuthenticatedApp(page: Page, snapshot = baseSnapshot) {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

test("public landing explains the service and accepts a suggestion", async ({
  page,
}) => {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );

  let suggestion: Record<string, unknown> | undefined;
  await page.route("**/api/feedback/suggestions", async (route) => {
    suggestion = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Всё необходимое для игры — в одном пространстве",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Возможности сервиса" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ближайшие планы" }),
  ).toBeVisible();

  await page
    .getByLabel("Предложение")
    .fill("Добавьте заметные маркеры инициативы");
  await page.getByLabel(/Контакт/).fill("@playtester");
  await page.getByRole("button", { name: "Отправить предложение" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Спасибо, предложение отправлено",
  );
  expect(suggestion).toEqual({
    description: "Добавьте заметные маркеры инициативы",
    contact: "@playtester",
    website: "",
  });
});

test("public landing lists the six permanent beta players", async ({
  page,
}) => {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/");
  const players = page.getByRole("navigation", { name: "Постоянные игроки" });
  await expect(players.getByRole("link")).toHaveCount(6);
  await expect(
    players.getByRole("link", { name: /Эд.*archinamon/ }),
  ).toHaveAttribute("href", "/play/archinamon");
  await expect(
    players.getByRole("link", { name: /Андрей.*uixray/ }),
  ).toHaveAttribute("href", "/play/uixray");
});

test("nickname link exchanges a public beta player session", async ({
  page,
}) => {
  let authenticated = false;
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(authenticated ? baseSnapshot : {}),
    }),
  );
  await page.route("**/api/auth/player/archinamon", (route) => {
    authenticated = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/play/archinamon");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText(baseSnapshot.campaign.name)).toBeVisible();
  await expect(page).toHaveURL("/");
});

for (const invitation of [
  { path: "/gm/gm-token", endpoint: "/api/auth/gm", label: "Вход мастера" },
  {
    path: "/join/player-token",
    endpoint: "/api/auth/invite",
    label: "Вход в кампанию",
  },
]) {
  test(`${invitation.label} remains available from the landing`, async ({
    page,
  }) => {
    let authenticated = false;
    await page.route("**/api/bootstrap", (route) =>
      route.fulfill({
        status: authenticated ? 200 : 401,
        contentType: "application/json",
        body: JSON.stringify(authenticated ? baseSnapshot : {}),
      }),
    );
    await page.route("**/api/player-access", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await page.route(`**${invitation.endpoint}`, async (route) => {
      authenticated = true;
      await route.fulfill({ status: 204, body: "" });
    });

    await page.goto(invitation.path);
    await expect(
      page.getByRole("heading", { name: invitation.label }),
    ).toBeVisible();
    if (invitation.path.startsWith("/join/")) {
      await page.getByLabel("Имя").fill("Игрок");
    }
    await page.getByRole("button", { name: "Войти" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.locator("canvas").first()).toBeVisible();
  });
}

for (const role of ["GM", "PLAYER"] as const) {
  test(`${role} can open and submit the in-game feedback reporter`, async ({
    page,
  }) => {
    const snapshot: GameSnapshot = {
      ...baseSnapshot,
      me: {
        id: `membership-${role.toLowerCase()}`,
        role,
        displayName: role === "GM" ? "Мастер" : "Игрок",
        characterId: null,
      },
    };
    await mockAuthenticatedApp(page, snapshot);

    let reportContentType = "";
    let reportBody = "";
    await page.route("**/api/feedback/reports", async (route) => {
      reportContentType = route.request().headers()["content-type"] ?? "";
      reportBody = route.request().postData() ?? "";
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Сообщить" }).click();

    const dialog = page.getByRole("dialog", {
      name: "Сообщить о проблеме или идее",
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("textbox", { name: "Короткое название" })
      .fill("Не работает пинг");
    await dialog
      .getByLabel("Описание")
      .fill("После выбора инструмента пинг не появляется на карте.");
    await dialog.getByRole("button", { name: "Отправить" }).click();

    await expect(dialog).toBeHidden();
    expect(reportContentType).toContain("multipart/form-data");
    expect(reportBody).toContain('name="kind"');
    expect(reportBody).toContain("BUG");
    expect(reportBody).toContain('name="title"');
    expect(reportBody).toContain("Не работает пинг");
    expect(reportBody).toContain('name="diagnostics"');
  });
}
