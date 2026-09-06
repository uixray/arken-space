import { type Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import type { GameSnapshot } from "@arken/contracts";

const baseSnapshot: GameSnapshot = {
  campaign: {
    id: "campaign-1",
    name: "Первая экспедиция",
    day: 1,
    paused: false,
    battleActive: false,
    battleCounter: 0,
    statLayout: [],
    initiative: [],
    battleZone: null,
    revision: 0,
  },
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
      backgroundFrame: { x: 0, y: 0, width: 1600, height: 1000 },
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
  characterIdentities: [],
  chatThreadStates: [],
  audioTracks: [],
  chatThreads: [],
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
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("region", { name: "Интерактивная карта сцены" }),
  ).toBeVisible();
});

test("a player can safely hand off a shared computer to the player chooser", async ({
  page,
}) => {
  const playerSnapshot: GameSnapshot = {
    ...baseSnapshot,
    me: {
      id: "membership-player",
      role: "PLAYER",
      displayName: "Игрок один",
      characterId: null,
    },
  };
  let authenticated = true;
  let logoutRequests = 0;
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(authenticated ? playerSnapshot : {}),
    }),
  );
  await page.route("**/api/auth/logout", async (route) => {
    authenticated = false;
    logoutRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  await page.goto("/");
  await page.getByLabel("Меню сеанса").click();
  await expect(page.getByText("Вы играете как: Игрок один")).toBeVisible();
  await page.getByRole("button", { name: "Сменить игрока" }).click();

  const dialog = page.getByRole("dialog", { name: "Сменить игрока?" });
  await expect(dialog).toContainText("несохранённые данные");
  await dialog.getByRole("button", { name: "Сменить игрока" }).click();

  await expect.poll(() => logoutRequests).toBe(1);
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Выберите игрока" }),
  ).toBeVisible();
  await expect(page.getByText("Вы играете как: Игрок один")).toHaveCount(0);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Выберите игрока" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Вы играете как: Игрок один")).toHaveCount(0);
});

test("handoff hides the previous player when the logout response is lost", async ({
  page,
}) => {
  const playerSnapshot: GameSnapshot = {
    ...baseSnapshot,
    me: {
      id: "membership-player",
      role: "PLAYER",
      displayName: "Игрок один",
      characterId: null,
    },
  };
  let authenticated = true;
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(authenticated ? playerSnapshot : {}),
    }),
  );
  await page.route("**/api/auth/logout", async (route) => {
    authenticated = false;
    await route.abort("failed");
  });
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  await page.goto("/");
  await page.getByLabel("Меню сеанса").click();
  await expect(page.getByText("Вы играете как: Игрок один")).toBeVisible();
  await page.getByRole("button", { name: "Сменить игрока" }).click();
  await page
    .getByRole("dialog", { name: "Сменить игрока?" })
    .getByRole("button", { name: "Сменить игрока" })
    .click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Выберите игрока" }),
  ).toBeVisible();
  await expect(page.getByText("Вы играете как: Игрок один")).toHaveCount(0);
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
    await page.locator(".account-menu summary").click();
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

test("drawing color picker controls the next drawing", async ({ page }) => {
  await mockAuthenticatedApp(page);
  let createPayload: Record<string, unknown> | undefined;
  let createRequests = 0;
  await page.route("**/api/drawings", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createRequests += 1;
    createPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "drawing-new",
        sceneId: "scene-1",
        authorMembershipId: "membership-gm",
        points: createPayload.points,
        x: 0,
        y: 0,
        color: createPayload.color,
        revision: 0,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Рисование", exact: true }).click();

  const color = page.getByLabel("Цвет рисунка");
  await expect(color).toBeVisible();
  const presets = page
    .getByRole("group", { name: "Готовые цвета" })
    .getByRole("button");
  await expect(presets).toHaveCount(9);
  await page.getByRole("button", { name: "Синий: #3b82f6" }).click();
  await expect(
    page.getByRole("button", { name: "Синий: #3b82f6" }),
  ).toHaveAttribute("aria-pressed", "true");
  await color.fill("#123456");

  const viewport = page.locator(".map-viewport");
  const gesture = await viewport.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const candidates = [
      [0.65, 0.55],
      [0.55, 0.7],
      [0.75, 0.4],
    ] as const;
    for (const [xRatio, yRatio] of candidates) {
      const start = {
        x: box.left + box.width * xRatio,
        y: box.top + box.height * yRatio,
      };
      const end = { x: start.x + 60, y: start.y + 60 };
      if (
        document.elementFromPoint(start.x, start.y) instanceof
          HTMLCanvasElement &&
        document.elementFromPoint(end.x, end.y) instanceof HTMLCanvasElement
      )
        return { start, end };
    }
    throw new Error("No unobstructed drawing surface is visible");
  });
  await page.mouse.move(gesture.start.x, gesture.start.y);
  await page.mouse.down();
  await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 4 });
  // Releasing over the sidebar (outside the Stage, but inside the document)
  // must still finish this gesture exactly once.
  const sidebarBox = await page.locator(".sidebar").boundingBox();
  expect(sidebarBox).not.toBeNull();
  await page.mouse.move(sidebarBox!.x + 12, sidebarBox!.y + 120);
  await page.mouse.up();

  await expect.poll(() => createPayload?.color).toBe("#123456");
  await expect.poll(() => createRequests).toBe(1);
});
