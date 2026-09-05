import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";
import type { GameSnapshot } from "@arken/contracts";

const snapshot: GameSnapshot = {
  campaign: {
    id: "campaign-1",
    name: "Проверка сцен",
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
    id: "gm-1",
    role: "GM",
    displayName: "Мастер",
    characterId: null,
  },
  members: [
    { id: "gm-1", role: "GM", displayName: "Мастер", characterId: null },
  ],
  characters: [],
  scenes: [
    {
      id: "scene-1",
      name: "Длинный переход через забытые руины",
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

const longTokenName =
  "Невероятнодлинноеназваниежетонакотороенедолжноломатькарточкупалитры";
const tokenSnapshot: GameSnapshot = {
  ...snapshot,
  tokenDefinitions: [
    {
      id: "token-definition-1",
      characterId: null,
      defaultAssetId: null,
      name: longTokenName,
      defaultWidth: 64,
      defaultHeight: 64,
      ownName: null,
      controllerMembershipIds: [],
      revision: 1,
    },
  ],
};

async function mockBootstrap(
  page: import("@playwright/test").Page,
  source: GameSnapshot,
) {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(source),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

test("scene editor stays above the workspace and restores its interaction", async ({
  page,
}) => {
  await mockBootstrap(page, snapshot);
  await page.goto("/");

  await openWorkspaceSection(page, "Сцены");

  const manager = page.getByRole("dialog", { name: "Сцены" });
  await expect(manager).toBeVisible();
  const configure = manager.getByRole("button", { name: "Настроить" });
  await configure.click();

  const editor = page.getByRole("dialog", { name: /Настройка:/ });
  const name = editor.getByLabel("Название");
  await expect(editor).toBeVisible();
  expect(
    await editor.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const modal = document.querySelector<HTMLElement>(".g-modal");
        const workspace = document.querySelector<HTMLElement>(
          ".arken-workspace-window",
        );
        if (!modal || !workspace) return false;
        return (
          Number.parseInt(getComputedStyle(modal).zIndex, 10) >
          Number.parseInt(getComputedStyle(workspace).zIndex, 10)
        );
      }),
    )
    .toBe(true);

  await name.fill("Сцена с проверенным фокусом");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(manager).toBeVisible();
  await expect(configure).toBeFocused();

  await manager.getByRole("button", { name: "Создать сцену" }).click();
  await expect(page.getByRole("dialog", { name: "Новая сцена" })).toBeVisible();
});

test("long token names remain inside a palette card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await mockBootstrap(page, tokenSnapshot);
  await page.goto("/");

  await openWorkspaceSection(page, "Токены");
  const tokens = page.getByRole("dialog", { name: "Токены" });
  const card = tokens
    .locator(".palette-card")
    .filter({ hasText: longTokenName });
  const title = card.locator(".palette-card__title");

  await expect(title).toHaveText(longTokenName);
  expect(
    await card.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(await title.evaluate((element) => element.clientHeight <= 36)).toBe(
    true,
  );
});

test("a desktop workspace window drags by its labelled header handle and resets safely", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockBootstrap(page, snapshot);
  await page.goto("/");

  await openWorkspaceSection(page, "Токены");
  const workspace = page.getByRole("dialog", { name: "Токены" });
  const handle = workspace.getByRole("group", {
    name: "Перетащить окно: Токены",
  });
  const before = await workspace.boundingBox();
  expect(before).not.toBeNull();

  await handle.hover();
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + 32, handleBox!.y + 16);
  await page.mouse.down();
  // Move beyond the viewport to exercise the right and bottom clamps while
  // pointer capture keeps the drag active outside the header.
  await page.mouse.move(2500, 1800);
  await page.mouse.up();

  await expect(
    workspace.getByRole("button", { name: "Сбросить расположение окна" }),
  ).toBeVisible();
  const clamped = await workspace.boundingBox();
  expect(clamped).not.toBeNull();
  expect(clamped!.x + clamped!.width).toBeLessThanOrEqual(1264);
  expect(clamped!.y + clamped!.height).toBeLessThanOrEqual(784);

  await workspace
    .getByRole("button", { name: "Сбросить расположение окна" })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Сбросить расположение окна" }),
  ).toHaveCount(0);
  const reset = await workspace.boundingBox();
  expect(reset).not.toBeNull();
  expect(reset!.x).toBeCloseTo(before!.x, 0);
  expect(reset!.y).toBeCloseTo(before!.y, 0);

  // Narrow layouts remain anchored by CSS and deliberately ignore dragging.
  await page.setViewportSize({ width: 390, height: 840 });
  const narrowBefore = await workspace.boundingBox();
  expect(narrowBefore).not.toBeNull();
  await handle.hover();
  const narrowHandleBox = await handle.boundingBox();
  expect(narrowHandleBox).not.toBeNull();
  await page.mouse.move(narrowHandleBox!.x + 24, narrowHandleBox!.y + 16);
  await page.mouse.down();
  await page.mouse.move(360, 400);
  await page.mouse.up();
  const narrowAfter = await workspace.boundingBox();
  expect(narrowAfter).not.toBeNull();
  expect(narrowAfter!.x).toBeCloseTo(narrowBefore!.x, 0);
  expect(narrowAfter!.y).toBeCloseTo(narrowBefore!.y, 0);
});

test("grid settings reset their draft and close outside the popover", async ({
  page,
}) => {
  await mockBootstrap(page, snapshot);
  await page.goto("/");

  const settings = page.locator("details.grid-settings");
  await settings.locator("summary").click();
  await expect(settings).toHaveAttribute("open", "");

  const size = settings.locator('input[type="number"]').first();
  await size.fill("96");
  await settings.locator(".grid-settings-popover button").first().click();
  await expect(size).toHaveValue("64");

  await page.locator(".map-viewport").click({ position: { x: 500, y: 300 } });
  await expect(settings).not.toHaveAttribute("open", "");
});

test("grid settings save canonical values across reopen and bootstrap reload", async ({
  page,
}) => {
  let canonical = structuredClone(snapshot);
  canonical.scenes[0] = {
    ...canonical.scenes[0]!,
    revision: 3,
  };

  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(canonical),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/scenes/scene-1/canvas", async (route) => {
    const body = route.request().postDataJSON() as {
      revision: number;
      grid: GameSnapshot["scenes"][number]["grid"];
    };
    expect(body.revision).toBe(canonical.scenes[0]!.revision);
    canonical = {
      ...canonical,
      snapshotVersion: canonical.snapshotVersion + 1,
      scenes: canonical.scenes.map((scene) =>
        scene.id === "scene-1"
          ? { ...scene, grid: body.grid, revision: body.revision + 1 }
          : scene,
      ),
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(canonical.scenes[0]),
    });
  });

  await page.goto("/");
  const settings = page.locator("details.grid-settings");
  const fields = settings.locator('input[type="number"]');
  await settings.locator("summary").click();
  await fields.nth(0).fill("96");
  await fields.nth(1).fill("12");
  await fields.nth(2).fill("-8");
  await settings.locator(".inline-fields button").nth(1).click();
  await expect(settings).not.toHaveAttribute("open", "");

  await settings.locator("summary").click();
  await expect(fields.nth(0)).toHaveValue("96");
  await expect(fields.nth(1)).toHaveValue("12");
  await expect(fields.nth(2)).toHaveValue("-8");

  await page.reload();
  await settings.locator("summary").click();
  await expect(fields.nth(0)).toHaveValue("96");
  await expect(fields.nth(1)).toHaveValue("12");
  await expect(fields.nth(2)).toHaveValue("-8");
});

test("grid settings keep a rejected draft open for correction or retry", async ({
  page,
}) => {
  await mockBootstrap(page, snapshot);
  await page.route("**/api/scenes/scene-1/canvas", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "SCENE_CONFLICT" }),
    }),
  );
  await page.goto("/");

  const settings = page.locator("details.grid-settings");
  await settings.locator("summary").click();
  const size = settings.locator('input[type="number"]').first();
  await size.fill("96");
  const save = settings.locator(".inline-fields button").nth(1);
  await save.click();

  await expect(settings).toHaveAttribute("open", "");
  await expect(size).toHaveValue("96");
  await expect(save).toBeEnabled();
});

test("UIX-621 overflow navigation has clickable visible menu items", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await mockBootstrap(page, snapshot);
  await page.goto("/");
  await page.getByLabel("Ещё разделы").click();
  const item = page.locator(".workspace-nav__menu button").first();
  await expect(item).toBeVisible();
  await expect
    .poll(() =>
      item.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    )
    .toBe(true);
  await item.click();
  await expect(page.locator(".arken-workspace-window")).toBeVisible();
});

test("UIX-621 select portal receives pointer above token workspace", async ({
  page,
}, testInfo) => {
  await mockBootstrap(page, tokenSnapshot);
  await page.goto("/");
  await openWorkspaceSection(page, "Токены");
  const workspace = page.getByRole("dialog", { name: "Токены" });
  const select = workspace.locator(".g-select").first();
  const option = page.getByRole("option").first();

  for (const phase of ["normal", "saturated"] as const) {
    await test.step(`${phase} workspace popup`, async () => {
      if (phase === "saturated") {
        // Exercise the real bringToFront handler until it stops allocating
        // higher layers. Do not assign styles or hardcode the workspace cap:
        // restoring the old cap must violate the popup ordering below.
        const saturation = await workspace.evaluate(async (element) => {
          const readLayer = () => Number(getComputedStyle(element).zIndex);
          const initialLayer = readLayer();
          const dialogLayer = Number(
            getComputedStyle(element).getPropertyValue("--arken-layer-dialog"),
          );
          let previousLayer = initialLayer;
          for (
            let pointerDowns = 0;
            pointerDowns < dialogLayer;
            pointerDowns += 32
          ) {
            for (let index = 0; index < 32; index += 1) {
              element.dispatchEvent(
                new PointerEvent("pointerdown", { bubbles: true }),
              );
            }
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            const currentLayer = readLayer();
            if (currentLayer === previousLayer) {
              return {
                initialLayer,
                cappedLayer: currentLayer,
                pointerDowns: pointerDowns + 32,
              };
            }
            previousLayer = currentLayer;
          }
          throw new Error(
            "Workspace layer did not saturate below the dialog tier",
          );
        });
        await testInfo.attach("workspace-layer-saturation", {
          body: JSON.stringify(saturation, null, 2),
          contentType: "application/json",
        });
        expect(saturation.cappedLayer).toBeGreaterThan(saturation.initialLayer);
      }

      await select.click();
      await expect(option).toBeVisible();
      const diagnostics = await option.evaluate((element) => {
        const describe = (node: Element | null) => {
          if (!node) return null;
          const style = getComputedStyle(node);
          return {
            tag: node.tagName,
            className: node.getAttribute("class"),
            zIndex: style.zIndex,
            position: style.position,
            transform: style.transform,
            isolation: style.isolation,
            opacity: style.opacity,
            contain: style.contain,
          };
        };
        const workspace = document.querySelector(".arken-workspace-window");
        const workspaceAncestors = [];
        for (let node = workspace; node; node = node.parentElement) {
          workspaceAncestors.push(describe(node));
        }
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        const wrapper = element.closest("[data-floating-ui-status]");
        const popupZIndex = wrapper ? getComputedStyle(wrapper).zIndex : "";
        return {
          wrapper: describe(wrapper),
          workspaceAncestors,
          hit: describe(hit),
          receivesPointer: element.contains(hit),
          popupLayerSupported: CSS.supports("z-index", popupZIndex),
          fractionalZIndexSupported: CSS.supports("z-index", "1999.5"),
          dialogLayer: Number(
            getComputedStyle(element).getPropertyValue("--arken-layer-dialog"),
          ),
        };
      });
      await testInfo.attach(`workspace-popup-layers-${phase}`, {
        body: JSON.stringify(diagnostics, null, 2),
        contentType: "application/json",
      });
      const popupLayer = Number(diagnostics.wrapper?.zIndex);
      const workspaceLayer = Number(diagnostics.workspaceAncestors[0]?.zIndex);
      expect(diagnostics.popupLayerSupported).toBe(true);
      expect(Number.isInteger(popupLayer)).toBe(true);
      expect(popupLayer).toBeGreaterThan(workspaceLayer);
      expect(popupLayer).toBeLessThan(diagnostics.dialogLayer);
      await expect
        .poll(() =>
          option.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              ),
            );
          }),
        )
        .toBe(true);
      await option.click();
      await expect(option).toBeHidden();
    });
  }
});

test("UIX-621 raw Gravity select receives pointer above feedback modal", async ({
  page,
}) => {
  await mockBootstrap(page, snapshot);
  await page.goto("/");
  await page.getByLabel("Меню сеанса").click();
  await page.getByRole("button", { name: "Сообщить", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Сообщить о проблеме или идее",
  });
  await dialog.locator(".g-select").click();
  const option = page.getByRole("option", { name: "Идея", exact: true });
  await expect(option).toBeVisible();
  await expect
    .poll(() =>
      option.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    )
    .toBe(true);
  await option.click();
  await expect(dialog.locator(".g-select")).toContainText("Идея");
});
