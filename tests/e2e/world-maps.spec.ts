import { expect, test, type Page } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";

const ids = {
  campaign: "b4c34840-cb11-4a07-884d-680ae85c48db",
  gm: "d21b4bb6-ae66-47b9-b719-610e0440044c",
  player: "c1af6cd6-20c2-4c08-9691-720fa957ab07",
  map: "11111111-1111-4111-8111-111111111111",
  location: "22222222-2222-4222-8222-222222222222",
  scene: "33333333-3333-4333-8333-333333333333",
  asset: "44444444-4444-4444-8444-444444444444",
};

function snapshotFor(role: "GM" | "PLAYER"): GameSnapshot {
  const me = {
    id: role === "GM" ? ids.gm : ids.player,
    role,
    displayName: role === "GM" ? "Мастер" : "Игрок",
    characterId: null,
  } as const;

  return {
    campaign: { id: ids.campaign, name: "Тестовая кампания" },
    me,
    members: [me],
    characters: [],
    scenes: [
      {
        id: ids.scene,
        name: "Руины",
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
    chatThreads: [],
    chatThreadStates: [],
    assets: [
      {
        id: ids.asset,
        name: "Карта региона",
        kind: "MAP",
        url: "/map-background.png",
        mimeType: "image/png",
        bytes: 128,
        width: 1600,
        height: 900,
        createdAt: "2026-07-23T00:00:00.000Z",
      },
    ],
    catalogEntries: [],
    tokenDefinitions: [],
    audio: {
      assetId: null,
      playing: false,
      positionSeconds: 0,
      loop: false,
      startedAt: null,
      revision: 0,
      updatedAt: "2026-07-23T00:00:00.000Z",
    },
    worldMaps: {
      maps: [],
      locations: [],
      gmLocations: role === "GM" ? [] : undefined,
      partyPosition: null,
    },
    snapshotVersion: 0,
    schemaVersion: 2,
    buildVersion: "test",
    buildRevision: "test-revision",
    serverTime: "2026-07-23T00:00:00.000Z",
  } as GameSnapshot;
}

async function mockWorldMapApi(page: Page, state: GameSnapshot) {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/world-maps**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON?.() as Record<
      string,
      unknown
    > | null;
    const maps = state.worldMaps!;
    if (path === "/api/world-maps" && route.request().method() === "POST") {
      maps.maps = [
        {
          id: ids.map,
          name: String(body?.name),
          scope: "REGION",
          visibility: "CAMPAIGN",
          lifecycle: "DRAFT",
          backgroundAssetId: null,
          revision: 0,
        },
      ];
    } else if (path.endsWith("/draft-background")) {
      maps.maps[0] = {
        ...maps.maps[0]!,
        backgroundAssetId: String(body?.backgroundAssetId),
        revision: 1,
      };
    } else if (path.endsWith("/approve-background")) {
      maps.maps[0] = { ...maps.maps[0]!, revision: 2 };
    } else if (path.endsWith("/publish")) {
      maps.maps[0] = { ...maps.maps[0]!, lifecycle: "PUBLISHED", revision: 3 };
    } else if (path === "/api/world-maps/locations") {
      const location = {
        id: ids.location,
        mapId: ids.map,
        name: String(body?.name),
        kind: "SETTLEMENT",
        summary: String(body?.summary ?? ""),
        visibility: "PUBLIC",
        x: 0.4,
        y: 0.6,
        revision: 0,
        sceneIds: [],
      };
      maps.locations = [location];
      if (state.me.role === "GM")
        maps.gmLocations = [
          { ...location, gmNotes: String(body?.gmNotes ?? "") },
        ];
    } else if (path.includes(`/locations/${ids.location}/scenes/`)) {
      maps.locations[0] = { ...maps.locations[0]!, sceneIds: [ids.scene] };
      if (maps.gmLocations)
        maps.gmLocations[0] = {
          ...maps.gmLocations[0]!,
          sceneIds: [ids.scene],
        };
    } else if (path === "/api/world-maps/party-position") {
      maps.partyPosition = {
        mapId: ids.map,
        locationId: ids.location,
        revision: 0,
        updatedAt: "2026-07-23T00:00:00.000Z",
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
}

async function openWorldMaps(page: Page) {
  await page.locator(".workspace-menu summary").click();
  await page.getByRole("button", { name: "World maps" }).click();
  return page.getByRole("dialog", { name: "Карты мира" });
}

test("UIX-243: GM creates, completes and publishes a world map", async ({
  page,
}) => {
  const state = snapshotFor("GM");
  await mockWorldMapApi(page, state);
  await page.goto("/");
  const workspace = await openWorldMaps(page);

  await workspace.getByRole("button", { name: "Создать карту" }).click();
  const mapEditor = page.getByRole("dialog", { name: "Новая карта" });
  await mapEditor.getByRole("textbox").fill("Северные земли");
  await mapEditor.getByRole("button", { name: "Создать черновик" }).click();
  await expect(workspace.getByText("Черновик", { exact: true })).toBeVisible();

  await workspace.getByLabel("Фон черновика").selectOption(ids.asset);
  await workspace.getByRole("button", { name: "Подтвердить фон" }).click();
  await workspace.getByRole("button", { name: "Добавить локацию" }).click();
  const locationEditor = page.getByRole("dialog", { name: "Новая локация" });
  await locationEditor.getByRole("textbox").first().fill("Сторожевая башня");
  await locationEditor
    .getByRole("textbox")
    .nth(1)
    .fill("Открытая игрокам локация");
  await locationEditor.getByRole("button", { name: "Сохранить" }).click();
  await expect(
    workspace.getByRole("heading", { name: "Сторожевая башня" }),
  ).toBeVisible();

  await workspace
    .getByLabel("Связать с локальной сценой")
    .selectOption(ids.scene);
  await expect(
    workspace.getByRole("button", { name: /Открыть «Руины» локально/ }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "Опубликовать" }).click();
  await expect(
    workspace.getByText("Опубликована", { exact: true }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "Поставить группу здесь" }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "Поставить группу здесь" })
    .click();
  await expect(
    workspace.getByRole("img", { name: "Текущая позиция группы" }),
  ).toBeVisible();
});

test("UIX-243: PLAYER sees only authorized published map and workspace stays responsive", async ({
  page,
}) => {
  const state = snapshotFor("PLAYER");
  state.worldMaps = {
    maps: [
      {
        id: ids.map,
        name: "Открытая карта",
        scope: "REGION",
        visibility: "CAMPAIGN",
        lifecycle: "PUBLISHED",
        backgroundAssetId: ids.asset,
        revision: 3,
      },
    ],
    locations: [
      {
        id: ids.location,
        mapId: ids.map,
        name: "Сторожевая башня",
        kind: "SETTLEMENT",
        summary: "Открытая игрокам локация",
        visibility: "PUBLIC",
        x: 0.4,
        y: 0.6,
        revision: 0,
        sceneIds: [],
      },
    ],
    partyPosition: {
      mapId: ids.map,
      locationId: ids.location,
      revision: 0,
      updatedAt: "2026-07-23T00:00:00.000Z",
    },
  };
  await mockWorldMapApi(page, state);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const workspace = await openWorldMaps(page);

  await expect(workspace.locator(".world-map-toolbar select")).toHaveValue(
    ids.map,
  );
  await expect(
    workspace.getByRole("heading", { name: "Сторожевая башня" }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "Добавить локацию" }),
  ).toHaveCount(0);
  await expect(
    workspace.getByRole("button", { name: "Поставить группу здесь" }),
  ).toHaveCount(0);
  await expect(workspace).toHaveJSProperty(
    "scrollWidth",
    await workspace.evaluate((node) => node.clientWidth),
  );

  await workspace.press("Escape");
  await expect(workspace).toBeHidden();
  await expect(page.locator(".workspace-menu summary")).toBeFocused();
});
