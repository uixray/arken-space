import type { AssetDto, GameSnapshot, TokenDto } from "@arken/contracts";
import type { Locator, Page, Route, TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

// Real App -> PalettePanel -> TokenDefinitionEditor -> production actions and
// optimistic coordinator. Only HTTP/image bytes are synthetic boundaries;
// no callback/context/component mocks, hook-state injection or backend writes.
const ids = {
  campaign: "61300000-0000-4000-8000-000000000001",
  gm: "61300000-0000-4000-8000-000000000002",
  player: "61300000-0000-4000-8000-000000000003",
  character: "61300000-0000-4000-8000-000000000004",
  scene: "61300000-0000-4000-8000-000000000005",
  source: "61300000-0000-4000-8000-000000000006",
  derived: "61300000-0000-4000-8000-000000000007",
  definition: "61300000-0000-4000-8000-000000000008",
};
const date = "2026-09-08T00:00:00.000Z";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const source: AssetDto = {
  id: ids.source,
  kind: "IMAGE",
  name: "Synthetic source.png",
  mimeType: "image/png",
  sizeBytes: png.length,
  width: 1,
  height: 1,
  durationSeconds: null,
  url: `/api/assets/${ids.source}/content`,
  createdAt: date,
};
// A valid PNG preview behind a controlled TOKEN DTO, not a claim that the
// production generator creates PNG or that this browser test verifies WebP.
const derived: AssetDto = {
  ...source,
  id: ids.derived,
  kind: "TOKEN",
  name: "Synthetic derived TOKEN.png",
  url: `/api/assets/${ids.derived}/content`,
};
const deniedMessage = "Недостаточно прав для размещения токена.";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fixtureSnapshot(): GameSnapshot {
  const snapshot = gmSnapshot({
    schemaVersion: 2,
    assets: [{ ...source }],
    scenes: [
      {
        id: ids.scene,
        name: "Синтетическая сцена",
        projection: "ORTHOGRAPHIC_2D",
        mapAssetId: null,
        width: 1600,
        height: 1000,
        backgroundFrame: { x: 0, y: 0, width: 1600, height: 1000 },
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
    characters: [
      {
        id: ids.character,
        name: "Тестовый персонаж",
        ownerMembershipId: null,
        controllerMembershipIds: [],
        portraitAssetId: null,
        stats: {},
        skills: [],
        spells: [],
        entries: [],
        notes: "",
        backstory: "",
        inventory: [],
        resources: {},
        wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
        revision: 0,
        lifecycle: "ACTIVE",
        archivedAt: null,
        archivedByMembershipId: null,
      },
    ],
  });
  snapshot.campaign.id = ids.campaign;
  snapshot.campaign.name = "Проверка результата размещения";
  snapshot.me.id = ids.gm;
  snapshot.members = [
    snapshot.me,
    {
      id: ids.player,
      role: "PLAYER",
      displayName: "Игрок для проверки",
      characterId: null,
    },
  ];
  return snapshot;
}

type RecordedRequest = {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  actionId: string | null;
  status?: number;
};
type HeldPlacement = {
  request: RecordedRequest;
  route: Route;
  settled: boolean;
};
type Evidence = { phase: string; details: unknown };

async function installBoundary(page: Page) {
  const snapshot = fixtureSnapshot();
  const writes: RecordedRequest[] = [];
  const placements: HeldPlacement[] = [];
  const reads: string[] = [];
  const background: string[] = [];
  const unexpected: string[] = [];
  const pageErrors: string[] = [];
  const evidence: Evidence[] = [];
  const transports = { websocket: 0, polling: 0 };
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.routeWebSocket("**/socket.io/**", (socket) => {
    transports.websocket++;
    socket.close();
  });
  await page.route("**/socket.io/**", (route) => {
    transports.polling++;
    return route.abort("blockedbyclient");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === "GET") {
      reads.push(path);
      if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/player-access") return route.fulfill({ json: [] });
      if (path === "/api/canvas/history")
        return route.fulfill({
          // Only IDs, never names. The real Undo label resolves the name only
          // after App accepted the corresponding non-pending token ID.
          json: snapshot.tokens.map((token, index) => ({
            sequence: index + 1,
            type: "TOKEN_CREATE",
            targetType: "TOKEN",
            targetId: token.id,
            status: "APPLIED",
            nextDirection: "undo",
          })),
        });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({
          status: 403,
          json: {
            error: "FORBIDDEN",
            message: "Нет доступа к операторскому разделу.",
          },
        });
      if ([source.url, derived.url].includes(path))
        return route.fulfill({ contentType: "image/png", body: png });
    }
    if (
      method === "POST" &&
      ["/api/chat/read", "/api/client-logs"].includes(path)
    ) {
      // Separate allowlist for automatic read receipts/diagnostics. Still
      // intercepted locally; neither can reach an authenticated backend.
      background.push(`${method} ${path}`);
      return route.fulfill({
        status: path === "/api/client-logs" ? 202 : 204,
        body: "",
      });
    }
    if (
      method === "POST" &&
      ["/api/tokens", `/api/assets/${ids.source}/token`].includes(path)
    ) {
      const recorded: RecordedRequest = {
        path,
        method,
        body: request.postDataJSON() as Record<string, unknown>,
        actionId: await request.headerValue("x-action-id"),
      };
      writes.push(recorded);
      if (path === "/api/tokens") {
        // Deliberately do not fulfil until the test observes the actual
        // pending form (or a distinct reopened editor). No timing sleep.
        placements.push({ request: recorded, route, settled: false });
        return;
      }
      snapshot.assets = [{ ...derived }, ...snapshot.assets];
      recorded.status = 201;
      return route.fulfill({ status: 201, json: derived });
    }
    unexpected.push(`${method} ${path}`);
    return route.abort("blockedbyclient");
  });

  const replyPlacement = async (index: number, status: 201 | 403) => {
    const held = placements[index];
    expect(
      held,
      `placement ${index} reached the actual HTTP boundary`,
    ).toBeDefined();
    expect(held.settled).toBe(false);
    held.settled = true;
    held.request.status = status;
    const body = held.request.body!;
    if (status === 403) {
      await held.route.fulfill({
        status,
        json: { error: "FORBIDDEN", message: deniedMessage },
      });
      return;
    }
    const token: TokenDto = {
      id: String(body.placementId),
      definitionId: ids.definition,
      definitionRevision: 0,
      controllerMembershipIds: body.controllerMembershipIds as string[],
      sceneId: ids.scene,
      characterId: body.characterId as string | null,
      ownerMembershipId: null,
      assetId: body.assetId as string | null,
      name: String(body.name),
      x: Number(body.x),
      y: Number(body.y),
      width: Number(body.width),
      height: Number(body.height),
      z: 0,
      levelId: null,
      rotation: 0,
      visible: true,
      locked: false,
      baseColor: "#ffffff",
      frameColor: null,
      layer: "PLAYER",
      conditions: [],
      revision: 0,
    };
    snapshot.tokens.push(token);
    await held.route.fulfill({ status, json: token });
  };
  return {
    writes,
    placements,
    reads,
    background,
    unexpected,
    pageErrors,
    evidence,
    transports,
    replyPlacement,
  };
}
type Boundary = Awaited<ReturnType<typeof installBoundary>>;

const editorFor = (page: Page) =>
  page.getByRole("dialog", { name: "Новый токен", exact: true });
const nameInput = (editor: Locator) =>
  editor
    .locator("form.entity-form > label")
    .filter({ hasText: /^Название/ })
    .locator("input");
const sizeInput = (editor: Locator, label: string) =>
  editor
    .locator(".token-dimensions label")
    .filter({ hasText: label })
    .locator('input[type="number"]');
const placementButton = (editor: Locator) =>
  editor.getByRole("button", { name: "Создать и поставить", exact: true });

async function openEditor(page: Page) {
  await page.locator(".token-palette > button").click();
  const editor = editorFor(page);
  await expect(editor).toBeVisible();
  await expect(editor.locator(".token-image-generator")).toBeVisible();
  return editor;
}

async function fillDraft(
  page: Page,
  editor: Locator,
  name: string,
  generate: boolean,
) {
  await nameInput(editor).fill(name);
  const character = editor
    .locator("form.entity-form > label")
    .filter({ hasText: /^Персонаж/ })
    .getByRole("combobox");
  await character.click();
  await page
    .getByRole("option", { name: "Тестовый персонаж", exact: true })
    .click();
  await expect(character).toContainText("Тестовый персонаж");
  if (generate) {
    await editor
      .getByRole("button", { name: "Создать изображение токена", exact: true })
      .click();
  }
  const tile = editor
    .getByRole("group", { name: "Изображение токена из файлов" })
    .getByRole("button", { name: derived.name, exact: true });
  if (!generate) await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(tile.locator("img")).toHaveJSProperty("complete", true);
  await expect
    .poll(() =>
      tile
        .locator("img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await editor.getByRole("checkbox", { name: "Сохранять пропорции" }).uncheck();
  await sizeInput(editor, "Ширина, клетки").fill("2");
  await sizeInput(editor, "Высота, клетки").fill("3");
  await editor.getByRole("checkbox", { name: "Игрок для проверки" }).check();
}

async function expectDraft(editor: Locator, name: string) {
  await expect(editor).toBeVisible();
  await expect(nameInput(editor)).toHaveValue(name);
  await expect(
    editor
      .locator("form.entity-form > label")
      .filter({ hasText: /^Персонаж/ })
      .getByRole("combobox"),
  ).toContainText("Тестовый персонаж");
  await expect(
    editor.getByRole("button", { name: derived.name, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(sizeInput(editor, "Ширина, клетки")).toHaveValue("2");
  await expect(sizeInput(editor, "Высота, клетки")).toHaveValue("3");
  await expect(
    editor.getByRole("checkbox", { name: "Сохранять пропорции" }),
  ).not.toBeChecked();
  await expect(
    editor.getByRole("checkbox", { name: "Игрок для проверки" }),
  ).toBeChecked();
}

function expectPlacementRequest(record: RecordedRequest, name: string) {
  expect(record.method).toBe("POST");
  expect(record.path).toBe("/api/tokens");
  expect(record.actionId).toMatch(uuid);
  expect(record.body).toEqual({
    actionId: expect.stringMatching(uuid),
    placementId: expect.stringMatching(uuid),
    sceneId: ids.scene,
    characterId: ids.character,
    assetId: ids.derived,
    name,
    x: 736,
    y: 404,
    width: 128,
    height: 192,
    controllerMembershipIds: [ids.player],
  });
  expect(record.body!.placementId).toBe(record.body!.actionId);
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  mock: Boundary,
  phase: string,
) {
  const editor = editorFor(page);
  const details = await editor.evaluateAll((dialogs) =>
    dialogs.map((dialog) => ({
      box: (() => {
        const { x, y, width, height } = dialog.getBoundingClientRect();
        return { x, y, width, height };
      })(),
      inputs: Array.from(dialog.querySelectorAll("input")).map((input) => ({
        type: input.type,
        value: input.value,
        checked: input.checked,
        disabled: input.disabled,
      })),
      selectedAssets: Array.from(
        dialog.querySelectorAll('.asset-picker button[aria-pressed="true"]'),
      ).map((button) => button.getAttribute("aria-label")),
      errors: Array.from(dialog.querySelectorAll(".field-error")).map(
        (node) => node.textContent,
      ),
      focusInside: dialog.contains(document.activeElement),
    })),
  );
  mock.evidence.push({ phase, details });
  const path = testInfo.outputPath(`${phase}.png`);
  await page.screenshot({ path });
  await testInfo.attach(phase, { path, contentType: "image/png" });
}

async function finish(page: Page, testInfo: TestInfo, mock: Boundary) {
  try {
    await capture(page, testInfo, mock, "final");
    await expect.soft(page.locator("vite-error-overlay")).toHaveCount(0);
    expect.soft(mock.pageErrors).toEqual([]);
    expect
      .soft(
        mock.unexpected,
        "No unlisted API reads or writes may escape the fixture",
      )
      .toEqual([]);
  } finally {
    const path = testInfo.outputPath("token-outcome-receipt.json");
    await writeFile(
      path,
      JSON.stringify(
        {
          revisionBoundary:
            "UIX-613 real App; mock HTTP, no backend persistence proof",
          viewport: page.viewportSize(),
          writes: mock.writes,
          reads: mock.reads,
          background: mock.background,
          unexpected: mock.unexpected,
          transports: mock.transports,
          pageErrors: mock.pageErrors,
          evidence: mock.evidence,
        },
        null,
        2,
      ),
    );
    await testInfo.attach("token-outcome-receipt", {
      path,
      contentType: "application/json",
    });
    // A failed assertion must not leave a held request attached to the page.
    for (const held of mock.placements)
      if (!held.settled) {
        held.settled = true;
        await held.route.abort("blockedbyclient").catch(() => undefined);
      }
  }
}

test("UIX-613 delayed 403 retains derived token draft and retry 201 closes only after acceptance", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const mock = await installBoundary(page);
  try {
    await page.goto("/");
    await openWorkspaceSection(page, "Токены");
    const editor = await openEditor(page);
    const name = "Страж после отказа";
    await fillDraft(page, editor, name, true);
    await placementButton(editor).click();
    await expect.poll(() => mock.placements.length).toBe(1);
    expectPlacementRequest(mock.placements[0].request, name);
    await expectDraft(editor, name);
    await expect(placementButton(editor)).toBeDisabled();
    await capture(page, testInfo, mock, "pending-403");

    await mock.replyPlacement(0, 403);
    await expect(editor.locator(".field-error")).toHaveText(deniedMessage);
    await expectDraft(editor, name);
    await expect(placementButton(editor)).toBeEnabled();
    // The form owns the rejection; a second global action-error toast would
    // be a regression even when the inline draft is correctly retained.
    await expect(page.getByText(deniedMessage, { exact: true })).toHaveCount(1);
    await capture(page, testInfo, mock, "retained-after-403");

    await placementButton(editor).click();
    await expect.poll(() => mock.placements.length).toBe(2);
    expectPlacementRequest(mock.placements[1].request, name);
    expect(mock.placements[1].request.body!.actionId).not.toBe(
      mock.placements[0].request.body!.actionId,
    );
    await expectDraft(editor, name);
    await expect(placementButton(editor)).toBeDisabled();
    await capture(page, testInfo, mock, "retry-pending-201");
    await mock.replyPlacement(1, 201);
    await expect(editor).toBeHidden();
    await page
      .getByRole("button", { name: "Объекты карты", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Объекты карты" })
        .getByRole("button", { name, exact: true }),
    ).toHaveCount(1);
    expect(mock.writes.map(({ path }) => path)).toEqual([
      `/api/assets/${ids.source}/token`,
      "/api/tokens",
      "/api/tokens",
    ]);
    expect(mock.placements.map(({ request }) => request.status)).toEqual([
      403, 201,
    ]);
  } finally {
    await finish(page, testInfo, mock);
  }
});

for (const close of ["header", "Escape"] as const) {
  test(`UIX-613 ${close} closes pending A and late 201 cannot dismiss reopened draft B`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installBoundary(page);
    try {
      await page.goto("/");
      await openWorkspaceSection(page, "Токены");
      const editorA = await openEditor(page);
      await fillDraft(page, editorA, "Первый страж A", true);
      await placementButton(editorA).click();
      await expect.poll(() => mock.placements.length).toBe(1);
      expectPlacementRequest(mock.placements[0].request, "Первый страж A");
      await expect(placementButton(editorA)).toBeDisabled();
      await capture(page, testInfo, mock, "editor-a-pending");
      if (close === "header")
        await editorA
          .getByRole("button", { name: "Закрыть диалоговое окно", exact: true })
          .click();
      else await page.keyboard.press("Escape");
      await expect(editorA).toBeHidden();

      const editorB = await openEditor(page);
      await fillDraft(page, editorB, "Второй страж B", false);
      await expect(placementButton(editorB)).toBeEnabled();
      await capture(page, testInfo, mock, "editor-b-before-late-201");
      const accepted = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/tokens" &&
          response.status() === 201,
      );
      await mock.replyPlacement(0, 201);
      await (await accepted).finished();
      // response.finished() alone does not prove the client's promise chain
      // ran. History carries only the accepted ID, unlike pending:<actionId>;
      // this production label gets A's name from the real App snapshot.
      // No click through the modal or hook-state mutation observes acceptance.
      await expect(page.locator('button[data-tool="UNDO"]')).toHaveAttribute(
        "aria-label",
        "Отменить: токен добавлен — Первый страж A",
      );
      await nameInput(editorB).fill("Второй страж B сохранён");
      await expectDraft(editorB, "Второй страж B сохранён");
      await expect(placementButton(editorB)).toBeEnabled();
      await expect(editorB.locator(".field-error")).toHaveCount(0);
      await expect(editorFor(page)).toHaveCount(1);
      await capture(page, testInfo, mock, "editor-b-after-late-201");
      expect(mock.placements).toHaveLength(1);
      expect(mock.placements[0].request.status).toBe(201);
      expect(mock.writes.map(({ path }) => path)).toEqual([
        `/api/assets/${ids.source}/token`,
        "/api/tokens",
      ]);
    } finally {
      await finish(page, testInfo, mock);
    }
  });
}
