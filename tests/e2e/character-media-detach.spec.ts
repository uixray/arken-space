import { type Page } from "@playwright/test";
import type { CharacterMediaDto, GameSnapshot } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";

const ids = {
  campaign: "11111111-1111-4111-8111-111111111111",
  membership: "22222222-2222-4222-8222-222222222222",
  character: "33333333-3333-4333-8333-333333333333",
  media: "44444444-4444-4444-8444-444444444444",
  asset: "55555555-5555-4555-8555-555555555555",
  scene: "66666666-6666-4666-8666-666666666666",
  tableThread: "77777777-7777-4777-8777-777777777777",
  storyThread: "88888888-8888-4888-8888-888888888888",
  rollsThread: "99999999-9999-4999-8999-999999999999",
};

const media: CharacterMediaDto = {
  id: ids.media,
  campaignId: ids.campaign,
  characterId: ids.character,
  assetId: ids.asset,
  category: "CHARACTER_ART",
  caption: "Портрет у костра",
  ordering: 0,
  visibility: "OWNER_GM",
  relatedEntityId: null,
  uploadedByMembershipId: ids.membership,
  detachedAt: null,
  revision: 7,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const snapshot = {
  campaign: {
    id: ids.campaign,
    name: "Character media detach",
    paused: false,
    day: 1,
    battleActive: false,
    battleCounter: 0,
    statLayout: [],
    initiative: [],
    battleZone: null,
    revision: 0,
  },
  me: {
    id: ids.membership,
    role: "PLAYER" as const,
    displayName: "Владелец",
    characterId: ids.character,
  },
  members: [
    {
      id: ids.membership,
      role: "PLAYER" as const,
      displayName: "Владелец",
      characterId: ids.character,
    },
  ],
  characters: [
    {
      id: ids.character,
      name: "Аркен",
      ownerMembershipId: ids.membership,
      controllerMembershipIds: [],
      portraitAssetId: null,
      lifecycle: "ACTIVE" as const,
      archivedAt: null,
      archivedByMembershipId: null,
      stats: {},
      skills: [],
      spells: [],
      notes: "",
      backstory: "",
      inventory: [],
      resources: {},
      wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
      entries: [],
      revision: 1,
    },
  ],
  catalogEntries: [],
  scenes: [
    {
      id: ids.scene,
      name: "Тестовая сцена",
      projection: "ORTHOGRAPHIC_2D" as const,
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
  tokenDefinitions: [],
  fogReveals: [],
  drawings: [],
  messages: [],
  characterIdentities: [],
  assets: [],
  audioTracks: [],
  chatThreads: [
    {
      id: ids.tableThread,
      campaignId: ids.campaign,
      type: "STREAM" as const,
      stream: "TABLE" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: ids.storyThread,
      campaignId: ids.campaign,
      type: "STREAM" as const,
      stream: "STORY" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: ids.rollsThread,
      campaignId: ids.campaign,
      type: "STREAM" as const,
      stream: "ROLLS" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  chatThreadStates: [],
  audio: {
    assetId: null,
    playing: false,
    positionSeconds: 0,
    loop: false,
    startedAt: null,
    revision: 0,
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: "2026-09-01T00:00:00.000Z",
} satisfies GameSnapshot;

type DetachRequest = {
  method: string;
  pathname: string;
  body: Record<string, unknown>;
};

async function installMockedApp(
  page: Page,
  detachRequests: DetachRequest[],
  unexpectedApiRequests: string[],
) {
  // Registered first so the narrower routes below win. Any REST request not
  // declared by this fixture is recorded instead of reaching a backend or DB.
  await page.route("**/api/**", async (route) => {
    unexpectedApiRequests.push(
      `${route.request().method()} ${new URL(route.request().url()).pathname}`,
    );
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "UNMOCKED_E2E_REQUEST" }),
    });
  });

  await page.route("**/api/bootstrap", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });
  await page.route("**/api/story/posts**", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ posts: [], nextCursor: null }),
    });
  });
  await page.route("**/api/player-access", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
  await page.route("**/api/canvas/history**", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
  await page.route("**/api/operator/feedback/capability", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "FORBIDDEN" }),
    });
  });
  await page.route(`**/api/characters/${ids.character}/media`, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([media]),
    });
  });
  await page.route(`**/api/assets/${ids.asset}/content`, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  await page.route(
    `**/api/character-media/${ids.media}/detach`,
    async (route) => {
      const request = route.request();
      detachRequests.push({
        method: request.method(),
        pathname: new URL(request.url()).pathname,
        body: request.postDataJSON() as Record<string, unknown>,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    },
  );
}

test("an owner confirms before detaching character media from the gallery", async ({
  page,
}) => {
  const detachRequests: DetachRequest[] = [];
  const unexpectedApiRequests: string[] = [];
  await installMockedApp(page, detachRequests, unexpectedApiRequests);

  await page.goto("/");
  await openWorkspaceSection(page, "Персонажи");

  const gallery = page.locator(".character-media-gallery");
  const openDetachDialog = gallery.getByRole("button", {
    name: "Убрать из галереи",
  });
  await expect(openDetachDialog).toBeVisible();
  expect(detachRequests).toHaveLength(0);

  await openDetachDialog.click();
  const dialog = page.getByRole("dialog", {
    name: "Убрать изображение из галереи?",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(
      "Изображение исчезнет из галереи персонажа, но исходный файл останется в медиатеке.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(detachRequests).toHaveLength(0);

  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(detachRequests).toHaveLength(0);

  await openDetachDialog.click();
  await expect(dialog).toBeVisible();
  expect(detachRequests).toHaveLength(0);
  await dialog.getByRole("button", { name: "Убрать", exact: true }).click();

  await expect.poll(() => detachRequests.length).toBe(1);
  expect(detachRequests).toEqual([
    {
      method: "POST",
      pathname: `/api/character-media/${ids.media}/detach`,
      body: {
        actionId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        revision: 7,
      },
    },
  ]);
  await expect(dialog).toBeHidden();
  await expect(
    gallery.getByText(
      "Здесь пока пусто. Добавьте изображение ниже — оно появится в галерее, а исходный файл останется в медиатеке.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(gallery.locator(".character-media-gallery__grid")).toHaveCount(
    0,
  );
  expect(unexpectedApiRequests).toEqual([]);
});
