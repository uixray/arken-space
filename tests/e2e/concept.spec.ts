import { expect, test } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";

const snapshot: GameSnapshot = {
  campaign: {
    id: "b4c34840-cb11-4a07-884d-680ae85c48db",
    name: "Первая экспедиция",
  },
  me: {
    id: "d21b4bb6-ae66-47b9-b719-610e0440044c",
    role: "GM",
    displayName: "Мастер",
    characterId: null,
  },
  members: [
    {
      id: "d21b4bb6-ae66-47b9-b719-610e0440044c",
      role: "GM",
      displayName: "Мастер",
      characterId: null,
    },
  ],
  characters: [
    {
      id: "62668dba-d385-434a-a76c-b9e2f8e84de9",
      name: "Картограф",
      ownerMembershipId: null,
      portraitAssetId: null,
      stats: {
        might: 2,
        agility: 3,
        mind: 4,
        spirit: 1,
        presence: 2,
        health: 10,
        focus: 6,
      },
      skills: [
        { key: "observe", name: "Наблюдение", rank: 1, formula: "2d6 + mind" },
      ],
      spells: [],
      notes: "Ищет проход к нижнему уровню.",
      revision: 1,
    },
  ],
  scenes: [
    {
      id: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
      name: "Внешний двор",
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
  tokens: [
    {
      id: "35f46186-2ebc-4cf8-bce7-870097305a6b",
      sceneId: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
      characterId: "62668dba-d385-434a-a76c-b9e2f8e84de9",
      ownerMembershipId: null,
      assetId: null,
      name: "Картограф",
      x: 384,
      y: 320,
      z: 0,
      levelId: null,
      width: 64,
      height: 64,
      rotation: 0,
      visible: true,
      locked: false,
      revision: 0,
    },
  ],
  fogReveals: [
    {
      id: "cfb16822-113a-43b8-adb9-d134f3d7c61f",
      sceneId: "7376b502-02f8-4cd6-9c55-3816d70d44dc",
      x: 256,
      y: 192,
      width: 512,
      height: 384,
    },
  ],
  messages: [
    {
      id: "c67832eb-f418-4712-a1fa-a5c8b90bb124",
      membershipId: "d21b4bb6-ae66-47b9-b719-610e0440044c",
      displayName: "Мастер",
      characterId: null,
      body: "Сцена готова.",
      visibility: "PUBLIC",
      kind: "SYSTEM",
      dice: null,
      createdAt: new Date().toISOString(),
    },
  ],
  assets: [],
  audio: {
    assetId: null,
    playing: false,
    positionSeconds: 0,
    loop: false,
    startedAt: null,
    updatedAt: new Date().toISOString(),
  },
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: new Date().toISOString(),
};

test("concept shell keeps the map primary and exposes core tools", async ({
  page,
}) => {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.goto("/");

  await expect(page.getByText("Внешний двор").first()).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Панорама" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Персонаж" }).click();
  await expect(page.getByRole("heading", { name: "Картограф" })).toBeVisible();
  await expect(page.getByText("Наблюдение")).toBeVisible();

  await page.getByRole("button", { name: /Чат/ }).click();
  await expect(page.getByText("Сцена готова.")).toBeVisible();
  await page.screenshot({
    path: "test-results/concept-shell.png",
    fullPage: true,
  });
});
