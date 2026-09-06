import { type Page, type Route, type WebSocketRoute } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import type { GameSnapshot } from "@arken/contracts";

const sceneId = "7376b502-02f8-4cd6-9c55-3816d70d44dc";
const tokenId = "35f46186-2ebc-4cf8-bce7-870097305a6b";
const assetId = "65f46186-2ebc-4cf8-bce7-870097305a6b";
const portraitUrl = `/api/assets/${assetId}/content`;

const snapshot = {
  campaign: {
    id: "b4c34840-cb11-4a07-884d-680ae85c48db",
    name: "Canvas regression fixture",
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
    id: "d21b4bb6-ae66-47b9-b719-610e0440044c",
    role: "GM",
    displayName: "GM",
    characterId: null,
  },
  members: [],
  characters: [],
  catalogEntries: [],
  scenes: [
    {
      id: sceneId,
      name: "Regression scene",
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
  tokens: [
    {
      id: tokenId,
      definitionId: "45f46186-2ebc-4cf8-bce7-870097305a6b",
      definitionRevision: 0,
      controllerMembershipIds: [],
      sceneId,
      characterId: null,
      ownerMembershipId: null,
      assetId,
      name: "Selected token",
      x: 384,
      y: 320,
      z: 0,
      levelId: null,
      width: 64,
      height: 64,
      rotation: 0,
      visible: true,
      locked: false,
      baseColor: "#8899aa",
      frameColor: null,
      layer: "PLAYER" as const,
      conditions: [],
      revision: 0,
    },
  ],
  tokenDefinitions: [],
  fogReveals: [],
  drawings: [],
  messages: [],
  chatThreads: [],
  chatThreadStates: [],
  assets: [
    {
      id: assetId,
      kind: "IMAGE",
      name: "Portrait",
      mimeType: "image/png",
      sizeBytes: 68,
      width: 1,
      height: 1,
      durationSeconds: null,
      url: portraitUrl,
      createdAt: "2026-08-02T00:00:00.000Z",
    },
  ],
  audio: {
    assetId: null,
    playing: false,
    positionSeconds: 0,
    loop: false,
    startedAt: null,
    revision: 0,
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
  characterIdentities: [],
  audioTracks: [],
  snapshotVersion: 0,
  schemaVersion: 2,
  buildVersion: "test",
  buildRevision: "test-revision",
  serverTime: "2026-08-02T00:00:00.000Z",
} satisfies GameSnapshot;

async function openPlacementFixture(page: Page) {
  const current: GameSnapshot = structuredClone(snapshot);
  const prototype = current.tokens[0]!;
  current.tokens = [];
  current.tokenDefinitions = [
    {
      id: prototype.definitionId,
      characterId: null,
      defaultAssetId: assetId,
      name: "Быстрый токен",
      ownName: "Быстрый токен",
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [],
      revision: 0,
    },
  ];
  const held: Route[] = [];
  let realtime: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    realtime = socket;
    socket.onMessage((message) => {
      const packet = message.toString();
      if (packet === "40") socket.send('40{"sid":"latency-socket"}');
    });
    socket.send(
      '0{"sid":"latency-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  await page.route("**/api/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/api/canvas/history**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**${portraitUrl}`, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/token-definitions/*/placements", (route) => {
    held.push(route);
  });
  await page.goto("/");
  await page.locator(".token-tray > summary").click();
  const button = page
    .locator(".token-tray")
    .getByRole("button", { name: "Быстрый токен" });
  await expect(button).toBeVisible();
  return {
    held,
    button,
    prototype,
    broadcast: (tokens: GameSnapshot["tokens"]) => {
      current.tokens = tokens;
      current.snapshotVersion++;
      if (!realtime) throw new Error("Fixture socket did not connect");
      realtime.send(`42${JSON.stringify(["game:snapshot", current])}`);
    },
  };
}

const imageStates = async (page: Page) =>
  (await page
    .locator(".map-viewport")
    .getAttribute("data-token-image-states")) ?? "";

test("UIX-621 two placements paint before held HTTP responses and settle without duplicates", async ({
  page,
}) => {
  const { held, button, prototype } = await openPlacementFixture(page);
  await button.click();
  await button.click();
  await expect.poll(() => held.length).toBe(2);
  // Neither response is released until both images have actually mounted.
  await expect
    .poll(async () => (await imageStates(page)).match(/pending:/g)?.length ?? 0)
    .toBe(2);
  const actions = held.map((route) => route.request().postDataJSON().actionId);
  expect(new Set(actions).size).toBe(2);
  await held[0]!.fulfill({
    json: {
      ...prototype,
      id: "confirmed-one",
      name: "Быстрый токен",
      revision: 1,
    },
  });
  await held[1]!.fulfill({
    json: {
      ...prototype,
      id: "confirmed-two",
      name: "Быстрый токен",
      revision: 1,
    },
  });
  await expect.poll(() => imageStates(page)).toContain("confirmed-one:loaded");
  await expect.poll(() => imageStates(page)).toContain("confirmed-two:loaded");
  await expect.poll(() => imageStates(page)).not.toContain("pending:");
  expect((await imageStates(page)).split(",")).toHaveLength(2);
});

test("UIX-621 refusing one placement rolls back only its draft", async ({
  page,
}) => {
  const { held, button, prototype } = await openPlacementFixture(page);
  await button.click();
  await button.click();
  await expect.poll(() => held.length).toBe(2);
  await expect
    .poll(async () => (await imageStates(page)).match(/pending:/g)?.length ?? 0)
    .toBe(2);
  await held[0]!.fulfill({
    status: 403,
    json: { error: "TOKEN_DEFINITION_FORBIDDEN" },
  });
  await expect
    .poll(async () => (await imageStates(page)).match(/pending:/g)?.length ?? 0)
    .toBe(1);
  await held[1]!.fulfill({
    json: { ...prototype, id: "confirmed-survivor", revision: 1 },
  });
  await expect
    .poll(() => imageStates(page))
    .toContain("confirmed-survivor:loaded");
  await expect.poll(() => imageStates(page)).not.toContain("pending:");
  expect((await imageStates(page)).split(",")).toHaveLength(1);
});

test("UIX-621 a websocket snapshot before HTTP ack replaces the exact pending placement", async ({
  page,
}) => {
  const { held, button, prototype, broadcast } =
    await openPlacementFixture(page);
  await button.click();
  await button.click();
  await expect.poll(() => held.length).toBe(2);
  await expect
    .poll(async () => (await imageStates(page)).match(/pending:/g)?.length ?? 0)
    .toBe(2);
  const first = {
    ...prototype,
    id: held[0]!.request().postDataJSON().placementId,
    revision: 1,
  };
  const second = {
    ...prototype,
    id: held[1]!.request().postDataJSON().placementId,
    revision: 1,
  };
  expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
  broadcast([first]);
  await expect.poll(() => imageStates(page)).toContain(`${first.id}:loaded`);
  await expect
    .poll(async () => (await imageStates(page)).match(/pending:/g)?.length ?? 0)
    .toBe(1);
  expect((await imageStates(page)).split(",")).toHaveLength(2);
  broadcast([first, second]);
  await expect.poll(() => imageStates(page)).not.toContain("pending:");
  expect((await imageStates(page)).split(",")).toHaveLength(2);
  await held[0]!.fulfill({ json: first });
  await held[1]!.fulfill({ json: second });
  await expect.poll(() => imageStates(page)).not.toContain("pending:");
  expect((await imageStates(page)).split(",")).toHaveLength(2);
});
