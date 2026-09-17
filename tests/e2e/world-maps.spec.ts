import { type Locator, type Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";
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
    campaign: {
      id: ids.campaign,
      name: "Тестовая кампания",
      day: 1,
      paused: false,
      battleActive: false,
      battleCounter: 0,
      statLayout: [],
      initiative: [],
      battleZone: null,
      revision: 0,
    },
    me,
    members: [me],
    characters: [],
    scenes: [
      {
        id: ids.scene,
        name: "Руины",
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
    characterIdentities: [],
    audioTracks: [],
    chatThreads: [],
    chatThreadStates: [],
    assets: [
      {
        id: ids.asset,
        name: "Карта региона",
        kind: "MAP",
        url: "/map-background.png",
        mimeType: "image/png",
        sizeBytes: 128,
        durationSeconds: null,
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
        kind: "SETTLEMENT" as const,
        summary: String(body?.summary ?? ""),
        visibility: "PUBLIC" as const,
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
  await openWorkspaceSection(page, "Карты мира");
  return page.getByRole("dialog", { name: "Карты мира" });
}

test("UIX-243: GM creates, completes and publishes a world map", async ({
  page,
}) => {
  const state = snapshotFor("GM");
  await mockWorldMapApi(page, state);
  await page.goto("/");
  const workspace = await openWorldMaps(page);
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(workspace).toHaveClass(/world-maps-workspace/);
  await expect(
    workspace.locator(".arken-workspace-window__drag-handle"),
  ).toHaveAttribute("data-draggable", "false");

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

test("UIX-243: PLAYER cannot enter the GM-only world-map workspace from navigation", async ({
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

  await expect(
    page.getByRole("button", { name: "Карты мира", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Карты мира" })).toHaveCount(0);
  await expect(page.getByText("Сторожевая башня")).toHaveCount(0);
  await expect(page.getByText("Открытая карта")).toHaveCount(0);
});

for (const width of [1280, 360]) {
  test(`UIX-644: world-map native controls and nested drafts ${width}`, async ({
    page,
  }, testInfo) => {
    const state = snapshotFor("GM");
    const secondMap = "55555555-5555-4555-8555-555555555555";
    state.worldMaps!.maps = [ids.map, secondMap].map((id, index) => ({
      id,
      name: index ? "Южные земли" : "Северные земли",
      scope: "REGION",
      visibility: "CAMPAIGN",
      lifecycle: "DRAFT",
      backgroundAssetId: null,
      revision: 0,
    }));
    const writes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/api/world-maps") &&
        request.method() !== "GET"
      )
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await mockWorldMapApi(page, state);
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const workspace = await openWorldMaps(page);
    const receipts: { label: string; value: string }[] = [];
    // Native OS option windows are not DOM listboxes. Check the rendered control
    // and keyboard state, without pretending to measure OS popup geometry.
    async function choose(
      control: Locator,
      label: string,
      key: "End" | "Home",
      expected: string,
    ) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
      expect(
        await control.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.left >= 0 &&
            box.right <= innerWidth &&
            box.top >= 0 &&
            box.bottom <= innerHeight &&
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ) === element
          );
        }),
      ).toBe(true);
      await control.focus();
      await control.press(key);
      await expect(control).toHaveValue(expected);
      await expect(control).toBeFocused();
      receipts.push({ label, value: expected });
    }
    await choose(
      workspace.getByRole("combobox", { name: "Карта", exact: true }),
      "current-map",
      "End",
      secondMap,
    );
    await choose(
      workspace.getByRole("combobox", { name: "Карта", exact: true }),
      "current-map",
      "Home",
      ids.map,
    );
    await workspace
      .getByRole("button", { name: "Создать карту", exact: true })
      .click();
    const mapEditor = page.getByRole("dialog", {
      name: "Новая карта",
      exact: true,
    });
    await mapEditor
      .getByLabel("Название", { exact: true })
      .fill("Несохранённая карта");
    await choose(mapEditor.getByLabel("Охват"), "map-scope", "End", "WORLD");
    await choose(
      mapEditor.getByLabel("Видимость"),
      "map-visibility",
      "End",
      "GM_ONLY",
    );
    await page.setViewportSize({
      width: width === 360 ? 390 : 1180,
      height: 640,
    });
    await expect(mapEditor.getByLabel("Охват")).toHaveValue("WORLD");
    await expect(mapEditor.getByLabel("Видимость")).toHaveValue("GM_ONLY");
    await expect(mapEditor.getByLabel("Название", { exact: true })).toHaveValue(
      "Несохранённая карта",
    );
    await mapEditor
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(mapEditor).toBeHidden();
    await expect(workspace).toBeVisible();
    await workspace
      .getByRole("button", { name: "Добавить локацию", exact: true })
      .click();
    const locationEditor = page.getByRole("dialog", {
      name: "Новая локация",
      exact: true,
    });
    await locationEditor
      .getByLabel("Название", { exact: true })
      .fill("Несохранённая локация");
    const kind = locationEditor.getByRole("combobox", {
      name: "Тип",
      exact: true,
    });
    const firstKind = await kind
      .locator("option")
      .first()
      .getAttribute("value");
    expect(firstKind).toBeTruthy();
    await choose(kind, "location-kind", "Home", firstKind!);
    await choose(
      locationEditor.getByLabel("Видимость"),
      "location-visibility",
      "Home",
      "PUBLIC",
    );
    await page.setViewportSize({ width, height: 800 });
    await expect(kind).toHaveValue(firstKind!);
    await expect(locationEditor.getByLabel("Видимость")).toHaveValue("PUBLIC");
    await expect(
      locationEditor.getByLabel("Название", { exact: true }),
    ).toHaveValue("Несохранённая локация");
    await locationEditor
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(locationEditor).toBeHidden();
    await expect(workspace).toBeVisible();
    await testInfo.attach("native-world-map-controls", {
      body: JSON.stringify({ receipts, writes, errors }),
      contentType: "application/json",
    });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const width of [1280, 360]) {
  for (const name of ["Башня", "Северная сторожевая башня древнего перевала"])
    test(`UIX-645 world marker controls ${width} ${name}`, async ({
      page,
    }, info) => {
      const state = snapshotFor("GM");
      const location = {
        id: ids.location,
        mapId: ids.map,
        name,
        kind: "SETTLEMENT" as const,
        summary: "",
        visibility: "PUBLIC" as const,
        x: 0.5,
        y: 0.5,
        revision: 0,
        sceneIds: [],
      };
      state.worldMaps = {
        maps: [
          {
            id: ids.map,
            name: "Регион",
            scope: "REGION",
            visibility: "CAMPAIGN",
            lifecycle: "PUBLISHED",
            backgroundAssetId: ids.asset,
            revision: 3,
          },
        ],
        locations: [location],
        gmLocations: [{ ...location, gmNotes: "" }],
        partyPosition: {
          mapId: ids.map,
          locationId: ids.location,
          revision: 0,
          updatedAt: "2026-07-23T00:00:00.000Z",
        },
      };
      const writes: string[] = [],
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", (route) => {
        const r = route.request(),
          path = new URL(r.url()).pathname;
        if (r.method() !== "GET" && path !== "/api/chat/read")
          writes.push(`${r.method()} ${path}`);
        return route.fulfill({ json: [] });
      });
      await mockWorldMapApi(page, state);
      await page.route("**/map-background.png", (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#40566b"/></svg>',
        }),
      );
      await page.setViewportSize({ width, height: 850 });
      await page.goto("/");
      const workspace = await openWorldMaps(page);
      const marker = workspace.getByRole("button", {
        name: `Локация: ${name}`,
        exact: true,
      });
      const party = workspace.getByRole("img", {
        name: "Текущая позиция группы",
        exact: true,
      });
      await expect(party).toBeVisible();
      await expect(marker).toHaveAccessibleDescription(
        "Текущая позиция группы",
      );
      const partyBox = await party.boundingBox();
      const captionBox = await marker
        .locator(":scope > span:last-child")
        .boundingBox();
      expect(partyBox!.x + partyBox!.width).toBeLessThanOrEqual(captionBox!.x);
      await marker.scrollIntoViewIfNeeded();
      const box = await marker.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
      expect(box!.height).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
      expect(
        await marker.evaluate((n) => {
          const r = n.getBoundingClientRect();
          return n.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
      ).toBe(true);
      for (const control of [marker, party]) {
        await expect(control.locator(":scope > svg.arken-icon")).toHaveCount(1);
        await expect(control.locator(":scope > svg")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
        await expect(control.locator(":scope > svg")).toHaveAttribute(
          "focusable",
          "false",
        );
        await expect(control.locator(":scope > svg")).toHaveAttribute(
          "stroke",
          "currentColor",
        );
      }
      expect(await marker.locator(":scope > svg").innerHTML()).not.toBe(
        await party.locator("svg").innerHTML(),
      );
      const locationSvgBox = await marker.locator(":scope > svg").boundingBox();
      expect(locationSvgBox!.width).toBe(16);
      const partySvgBox = await party.locator("svg").boundingBox();
      expect(partySvgBox!.width).toBe(24);
      const label = marker.locator(":scope > span:last-child");
      const labelBox = await label.boundingBox();
      const markerBox = await marker.boundingBox();
      expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(
        markerBox!.x + markerBox!.width,
      );
      await marker.focus();
      await marker.press("Enter");
      await expect(marker).toHaveAttribute("aria-pressed", "true");
      await expect(marker).toBeFocused();
      await expect(
        workspace.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`world-marker-${width}.png`),
      });
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
}
