import type {
  AssetDto,
  GameSnapshot,
  TokenDefinitionDto,
} from "@arken/contracts";
import type {
  Locator,
  Page,
  Route,
  TestInfo,
  WebSocketRoute,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";
import {
  paintedIconContrast,
  settleIconState,
} from "./helpers/painted-icon-contrast";

// Actual App/Palette/Editor/Generator/upload/actions. Only HTTP and realtime
// transport boundaries are synthetic. Valid PNG files exercise browser image
// decoding; a controlled TOKEN response does not prove server crop/WebP output.
const ids = {
  campaign: "61100000-0000-4000-8000-000000000101",
  gm: "61100000-0000-4000-8000-000000000102",
  scene: "61100000-0000-4000-8000-000000000103",
  a: "61100000-0000-4000-8000-000000000104",
  b: "61100000-0000-4000-8000-000000000105",
  token: "61100000-0000-4000-8000-000000000106",
  unrelated: "61100000-0000-4000-8000-000000000107",
  definition: "61100000-0000-4000-8000-000000000108",
  oldToken: "61100000-0000-4000-8000-000000000109",
  player: "61100000-0000-4000-8000-000000000110",
};
const date = "2026-09-08T00:00:00.000Z";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Tiny opaque RGB PNGs built from standard PNG chunks, with real dimensions
// matching the controlled IMAGE DTOs (not a 1x1 placeholder labelled portrait).
function png(width: number, height: number, rgb: [number, number, number]) {
  const chunk = (type: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, payload, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 3; channel++)
        rows[y * (width * 3 + 1) + 1 + x * 3 + channel] = rgb[channel]!;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function image(
  id: string,
  name: string,
  width: number,
  height: number,
  bytes: Buffer,
): AssetDto {
  return {
    id,
    name,
    kind: "IMAGE",
    mimeType: "image/png",
    sizeBytes: bytes.length,
    width,
    height,
    durationSeconds: null,
    url: `/api/assets/${id}/content`,
    createdAt: date,
  };
}
const aBytes = png(60, 40, [57, 98, 139]);
const bBytes = png(40, 60, [173, 92, 62]);
const tokenBytes = png(64, 64, [125, 150, 81]);
const a = image(ids.a, "SourceA-landscape.png", 60, 40, aBytes);
const b = image(ids.b, "SourceB-portrait.png", 40, 60, bBytes);
const token: AssetDto = {
  ...image(ids.token, "Derived-token.png", 64, 64, tokenBytes),
  kind: "TOKEN",
};
const oldToken: AssetDto = {
  ...token,
  id: ids.oldToken,
  name: "Existing-token.png",
  url: `/api/assets/${ids.oldToken}/content`,
};

const unrelated = image(
  ids.unrelated,
  "Unrelated-landscape.png",
  60,
  40,
  aBytes,
);

function initialSnapshot(): GameSnapshot {
  const snapshot = gmSnapshot({
    schemaVersion: 2,
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
  });
  snapshot.campaign.id = ids.campaign;
  snapshot.campaign.name = "Проверка исходного изображения";
  snapshot.me.id = ids.gm;
  snapshot.members = [snapshot.me];
  return snapshot;
}

type RecordedWrite = {
  path: string;
  actionId: string | null;
  body?: Record<string, unknown>;
  upload?: { name: string; size: number; sha256: string; kind: string | null };
  status?: number;
};

async function installBoundary(page: Page, editExisting = false) {
  const snapshot = initialSnapshot();
  if (editExisting) {
    snapshot.assets = [oldToken, b];
    snapshot.members.push({
      id: ids.player,
      role: "PLAYER",
      displayName: "Игрок атомарной правки",
      characterId: null,
    });
    snapshot.tokenDefinitions = [
      {
        id: ids.definition,
        name: "Редактируемый страж",
        ownName: "Редактируемый страж",
        characterId: null,
        defaultAssetId: oldToken.id,
        defaultWidth: 64,
        defaultHeight: 64,
        controllerMembershipIds: [],
        revision: 4,
      },
    ];
  }
  const writes: RecordedWrite[] = [];
  const reads: string[] = [];
  const background: string[] = [];
  const unexpected: string[] = [];
  const pageErrors: string[] = [];
  const sockets = new Set<WebSocketRoute>();
  const heldUploads: Array<{ route: Route; recorded: RecordedWrite }> = [];
  const heldPatches: Array<{ route: Route; recorded: RecordedWrite }> = [];
  const controllerWrites: string[] = [];
  const evidence: Array<{ phase: string; details: unknown }> = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      const packet = message.toString();
      if (packet === "40") {
        sockets.add(socket);
        socket.send('40{"sid":"upload-source-socket"}');
        return;
      }
      if (!packet.startsWith("42")) return;
      const payloadStart = packet.indexOf("[");
      if (payloadStart < 0) return;
      const [event] = JSON.parse(packet.slice(payloadStart)) as [string];
      if (!["scene:view", "cursor:gone"].includes(event))
        unexpected.push(`socket ${event}`);
    });
    socket.onClose(() => sockets.delete(socket));
    socket.send(
      '0{"sid":"upload-source-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  await page.route("**/socket.io/**", (route) =>
    route.abort("blockedbyclient"),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method === "GET") {
      reads.push(path);
      if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (["/api/player-access", "/api/canvas/history"].includes(path))
        return route.fulfill({ json: [] });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({
          status: 403,
          json: {
            error: "FORBIDDEN",
            message: "Нет доступа к операторскому разделу.",
          },
        });
      const bytes = new Map([
        [a.url, aBytes],
        [b.url, bBytes],
        [token.url, tokenBytes],
        [oldToken.url, tokenBytes],
        [unrelated.url, aBytes],
      ]).get(path);
      if (bytes)
        return route.fulfill({ contentType: "image/png", body: bytes });
    }
    if (
      method === "POST" &&
      ["/api/chat/read", "/api/client-logs"].includes(path)
    ) {
      background.push(`${method} ${path}`);
      return route.fulfill({
        status: path === "/api/client-logs" ? 202 : 204,
        body: "",
      });
    }
    if (
      method === "PUT" &&
      path === `/api/token-definitions/${ids.definition}/controllers`
    ) {
      controllerWrites.push(path);
      unexpected.push(`${method} ${path}`);
      return route.abort("blockedbyclient");
    }
    if (
      editExisting &&
      method === "PATCH" &&
      path === `/api/token-definitions/${ids.definition}`
    ) {
      const recorded: RecordedWrite = {
        path,
        actionId: await request.headerValue("x-action-id"),
        body: request.postDataJSON() as Record<string, unknown>,
      };
      writes.push(recorded);
      heldPatches.push({ route, recorded });
      return;
    }
    if (method === "POST" && path === "/api/assets") {
      const index = writes.filter((item) => item.upload).length;
      const asset = index === 0 ? a : b;
      const bytes = index === 0 ? aBytes : bBytes;
      expect(index, "only the two deliberate IMAGE uploads").toBeLessThan(2);
      expect(url.searchParams.get("kind")).toBe("IMAGE");
      const contentType = request.headers()["content-type"] ?? "";
      expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
      const body = request.postDataBuffer();
      expect(body).not.toBeNull();
      const form = await new Response(new Uint8Array(body!), {
        headers: { "content-type": contentType },
      }).formData();
      expect([...form.keys()]).toEqual(["file"]);
      const received = form.get("file");
      if (!received || typeof received === "string")
        throw new Error("Expected exactly one uploaded File");
      expect(received.name).toBe(asset.name);
      expect(received.type).toBe("image/png");
      const receivedBytes = Buffer.from(await received.arrayBuffer());
      expect(receivedBytes).toEqual(bytes);
      const recorded: RecordedWrite = {
        path,
        actionId: await request.headerValue("x-action-id"),
        upload: {
          name: received.name,
          size: receivedBytes.length,
          sha256: createHash("sha256").update(receivedBytes).digest("hex"),
          kind: url.searchParams.get("kind"),
        },
      };
      writes.push(recorded);
      if (index === 1) {
        heldUploads.push({ route, recorded });
        return;
      }
      snapshot.assets = [a];
      snapshot.snapshotVersion += 1;
      recorded.status = 201;
      return route.fulfill({ status: 201, json: a });
    }
    if (
      method === "POST" &&
      [b.url.replace("/content", "/token"), "/api/token-definitions"].includes(
        path,
      )
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      const recorded: RecordedWrite = {
        path,
        body,
        actionId: await request.headerValue("x-action-id"),
        status: 201,
      };
      writes.push(recorded);
      snapshot.snapshotVersion += 1;
      if (path !== "/api/token-definitions") {
        // Deliberately keep bootstrap stale until definition commit.
        return route.fulfill({ status: 201, json: token });
      }
      const definition: TokenDefinitionDto = {
        id: ids.definition,
        name: String(body.name),
        ownName: String(body.name),
        characterId: null,
        defaultAssetId: String(body.defaultAssetId),
        defaultWidth: Number(body.defaultWidth),
        defaultHeight: Number(body.defaultHeight),
        controllerMembershipIds: body.controllerMembershipIds as string[],
        revision: 0,
      };
      snapshot.assets = [token, ...snapshot.assets];
      snapshot.tokenDefinitions = [definition];
      return route.fulfill({ status: 201, json: definition });
    }
    unexpected.push(`${method} ${path}`);
    return route.abort("blockedbyclient");
  });
  return {
    writes,
    reads,
    background,
    unexpected,
    pageErrors,
    heldUploads,
    heldPatches,
    controllerWrites,
    evidence,
    sockets,
    async finishPatch(success: boolean) {
      const held = heldPatches.shift();
      expect(held, "combined PATCH reached its held boundary").toBeDefined();
      if (!held) throw new Error("No held combined PATCH");
      if (!success) {
        held.recorded.status = 500;
        await held.route.fulfill({
          status: 500,
          json: { error: "EDIT_FAILED", message: "Атомарная правка отклонена" },
        });
        return;
      }
      const body = held.recorded.body!;
      const definition: TokenDefinitionDto = {
        id: ids.definition,
        name: String(body.name),
        ownName: String(body.name),
        characterId: null,
        defaultAssetId: String(body.defaultAssetId),
        defaultWidth: Number(body.defaultWidth),
        defaultHeight: Number(body.defaultHeight),
        controllerMembershipIds: body.controllerMembershipIds as string[],
        revision: Number(body.revision) + 1,
      };
      snapshot.assets = [token, ...snapshot.assets];
      snapshot.tokenDefinitions = [definition];
      snapshot.snapshotVersion += 1;
      held.recorded.status = 200;
      await held.route.fulfill({ status: 200, json: definition });
    },
    async acceptB() {
      const held = heldUploads.shift();
      expect(held, "B reached the held upload boundary").toBeDefined();
      if (!held) throw new Error("No held B upload");
      snapshot.assets = [b, ...snapshot.assets];
      snapshot.snapshotVersion += 1;
      held.recorded.status = 201;
      await held.route.fulfill({ status: 201, json: b });
    },
    refreshUnrelatedSnapshot() {
      snapshot.assets = [unrelated, b, a];
      snapshot.snapshotVersion += 1;
      expect(sockets.size).toBeGreaterThan(0);
      for (const socket of sockets)
        socket.send(`42${JSON.stringify(["game:snapshot", snapshot])}`);
    },
    refreshRecoveredAsset(asset: AssetDto) {
      snapshot.assets = [
        ...snapshot.assets.filter((item) => item.id !== asset.id),
        asset,
      ];
      snapshot.snapshotVersion += 1;
      expect(sockets.size).toBeGreaterThan(0);
      for (const socket of sockets)
        socket.send(`42${JSON.stringify(["game:snapshot", snapshot])}`);
    },
  };
}

async function imageDecoded(image: Locator, width: number, height: number) {
  await expect
    .poll(() =>
      image.evaluate((node) => {
        const image = node as HTMLImageElement;
        return {
          complete: image.complete,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      }),
    )
    .toEqual({ complete: true, width, height });
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}

for (const width of [1280, 360]) {
  test(`UIX-417 damaged token preview recovers after source switch ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installBoundary(page);
    // Replacement content gets a new URL in production. Reusing the corrupt
    // URL instead tests Firefox's failed-image cache, not preview recovery.
    const recoveredA = { ...a, url: `${a.url}?v=recovered-a` };
    let damaged = true;
    let recoveredRequests = 0;
    await page.route(`**${a.url}`, (route) =>
      route.fulfill({
        contentType: "image/png",
        body: damaged
          ? Buffer.from("INVALID_IMAGE private-error-details")
          : aBytes,
        headers: { "cache-control": "no-store" },
      }),
    );
    await page.route(`**${recoveredA.url}`, (route) => {
      recoveredRequests += 1;
      return route.fulfill({ contentType: "image/png", body: aBytes });
    });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await openWorkspaceSection(page, "Токены");
    await page
      .locator(".token-palette")
      .getByRole("button", { name: "Создать токен", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Новый токен",
      exact: true,
    });
    const upload = editor.getByLabel("Загрузить новое изображение", {
      exact: true,
    });
    await upload.setInputFiles({
      name: a.name,
      mimeType: "image/png",
      buffer: aBytes,
    });
    const previewImage = editor.locator(".token-image-preview img");
    await expect
      .poll(() =>
        previewImage.evaluate((node) => ({
          complete: (node as HTMLImageElement).complete,
          width: (node as HTMLImageElement).naturalWidth,
        })),
      )
      .toEqual({ complete: true, width: 0 });
    const alert = editor.locator(".token-image-generator").getByRole("alert");
    await expect(alert).toHaveText(
      "Не удалось загрузить предпросмотр. Выберите другое изображение или откройте редактор заново.",
    );
    await alert.scrollIntoViewIfNeeded();
    const box = (await alert.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(
      await alert.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    await expect(editor).not.toContainText("private-error-details");
    await capture(page, info, "damaged-source-message");
    await upload.setInputFiles({
      name: b.name,
      mimeType: "image/png",
      buffer: bBytes,
    });
    await expect.poll(() => fixture.heldUploads.length).toBe(1);
    await fixture.acceptB();
    const source = editor.getByRole("combobox", {
      name: "Исходное изображение",
      exact: true,
    });
    await expect(source).toHaveValue(b.id);
    await imageDecoded(previewImage, 40, 60);
    await expect(alert).toHaveCount(0);
    damaged = false;
    fixture.refreshRecoveredAsset(recoveredA);
    await source.selectOption(a.id);
    await expect(previewImage).toHaveAttribute("src", recoveredA.url);
    await imageDecoded(previewImage, 60, 40);
    expect(recoveredRequests).toBeGreaterThan(0);
    await expect(alert).toHaveCount(0);
    expect(fixture.writes).toHaveLength(2);
    expect(fixture.writes.every((write) => write.upload)).toBe(true);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  });
}

test("UIX-611 real App selects uploaded portrait B once and saves only generated TOKEN", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await installBoundary(page);
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect.poll(() => fixture.sockets.size).toBeGreaterThan(0);
    await openWorkspaceSection(page, "Токены");
    await page
      .locator(".token-palette")
      .getByRole("button", { name: "Создать токен", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Новый токен",
      exact: true,
    });
    await expect(editor).toBeVisible();
    const originalEditor = await editor.elementHandle();
    if (!originalEditor) throw new Error("Editor was not mounted");
    const name = editor.getByLabel("Название", { exact: true });
    await name.fill("Страж портрета");
    const upload = editor.getByLabel("Загрузить новое изображение", {
      exact: true,
    });
    const noImage = editor
      .getByRole("group", {
        name: "Изображение токена из файлов",
        exact: true,
      })
      .getByRole("button", { name: "Без изображения", exact: true });
    await expect(noImage).toHaveAttribute("aria-pressed", "true");
    await expect(editor.locator(".token-image-preview")).toHaveCount(0);
    await upload.setInputFiles({
      name: a.name,
      mimeType: "image/png",
      buffer: aBytes,
    });
    const source = editor.getByRole("combobox", {
      name: "Исходное изображение",
      exact: true,
    });
    await expect(source).toHaveValue(a.id);
    await expect(noImage).toHaveAttribute("aria-pressed", "false");
    const preview = editor.locator(".token-image-preview");
    const previewImage = preview.locator("img");
    await imageDecoded(previewImage, 60, 40);
    const zoom = editor.getByRole("slider", {
      name: "Масштаб изображения токена",
      exact: true,
    });
    const decrease = editor.getByRole("button", {
      name: "Уменьшить масштаб",
      exact: true,
    });
    const increase = editor.getByRole("button", {
      name: "Увеличить масштаб",
      exact: true,
    });
    // UIX-645: use the real editor and decoded source, not a component demo.
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(zoom).toHaveValue("1");
      await expect(decrease).toBeDisabled();
      await expect(increase).toBeEnabled();
      await increase.focus();
      await increase.press("Enter");
      await expect(zoom).toHaveValue("1.1");
      const glyphs: string[] = [];
      for (const control of [decrease, increase]) {
        await expect(control).toBeEnabled();
        const svg = control.locator("svg.arken-icon");
        await expect(svg).toHaveCount(1);
        await expect(svg).toBeVisible();
        for (const [attribute, value] of [
          ["aria-hidden", "true"],
          ["focusable", "false"],
          ["stroke", "currentColor"],
          ["stroke-width", "2"],
        ])
          await expect(svg).toHaveAttribute(attribute, value);
        glyphs.push(await svg.innerHTML());
        await control.scrollIntoViewIfNeeded();
        const box = (await control.boundingBox())!;
        for (const size of [box.width, box.height])
          expect(Number(size.toFixed(3))).toBeGreaterThanOrEqual(
            width === 360 ? 44 : 24,
          );
        expect(
          await control.evaluate((node) => {
            const r = node.getBoundingClientRect();
            return node.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
        ).toBe(true);
        await control.evaluate((node) => (node as HTMLElement).blur());
        await page.mouse.move(1, 899);
        await settleIconState(control);
        expect(await control.evaluate((node) => node.matches(":hover"))).toBe(
          false,
        );
        expect(await paintedIconContrast(svg)).toBeGreaterThanOrEqual(3);
        await control.hover();
        await settleIconState(control);
        expect(await paintedIconContrast(svg)).toBeGreaterThanOrEqual(3);
        await page.mouse.move(1, 899);
        await control.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(control).toBeFocused();
        expect(
          await control.evaluate((node) => {
            const s = getComputedStyle(node);
            return (
              node.matches(":focus-visible") &&
              ((s.outlineStyle !== "none" &&
                parseFloat(s.outlineWidth) > 0 &&
                s.outlineColor !== "rgba(0, 0, 0, 0)") ||
                s.boxShadow !== "none")
            );
          }),
        ).toBe(true);
        await settleIconState(control);
        expect(await paintedIconContrast(svg)).toBeGreaterThanOrEqual(3);
      }
      expect(new Set(glyphs).size).toBe(2);
      await zoom.fill("8");
      await expect(increase).toBeDisabled();
      await expect(decrease).toBeEnabled();
      await decrease.focus();
      await decrease.press("Enter");
      await expect(zoom).toHaveValue("7.9");
      await expect(increase).toBeEnabled();
      await capture(page, testInfo, `zoom-icons-${width}`);
      await zoom.fill("1");
      await expect(decrease).toBeDisabled();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await zoom.fill("2");
    await preview.focus();
    await preview.press("Shift+ArrowRight");
    await preview.press("Shift+ArrowDown");
    await editor.getByRole("radio", { name: "Бронза", exact: true }).check();
    const edited = await previewImage.evaluate((node) => ({
      left: (node as HTMLElement).style.left,
      top: (node as HTMLElement).style.top,
    }));
    expect(edited).toEqual({ left: "-130%", top: "-70%" });
    await upload.setInputFiles({
      name: b.name,
      mimeType: "image/png",
      buffer: bBytes,
    });
    await expect.poll(() => fixture.heldUploads.length).toBe(1);
    await expect(source).toHaveValue(a.id);
    await expect(source).toBeDisabled();
    await expect(zoom).toHaveValue("2");
    await expect(zoom).toBeDisabled();
    await expect(decrease).toBeDisabled();
    await expect(increase).toBeDisabled();
    await expect(editor.getByRole("status")).toHaveText(
      "Загрузка исходного изображения…",
    );
    await expect(
      editor.getByRole("radio", { name: "Бронза", exact: true }),
    ).toBeChecked();
    expect(fixture.writes.map((item) => item.path)).toEqual([
      "/api/assets",
      "/api/assets",
    ]);
    const bootstrapsBeforeB = fixture.reads.filter(
      (path) => path === "/api/bootstrap",
    ).length;
    await fixture.acceptB();
    await expect(
      source.getByRole("option", { name: b.name, exact: true }),
    ).toHaveCount(1);
    expect(
      fixture.reads.filter((path) => path === "/api/bootstrap").length,
    ).toBeGreaterThan(bootstrapsBeforeB);
    fixture.evidence.push({
      phase: "after-accepted-B",
      details: {
        selected: await source.inputValue(),
        zoom: await zoom.inputValue(),
      },
    });
    await preview.scrollIntoViewIfNeeded();
    await capture(page, testInfo, "uploaded-b-selection");
    // Baseline-capable oracle: with the upload intent removed, B exists but
    // the still-valid A remains selected. Do not change this to a list check.
    await expect(source).toHaveValue(b.id);
    await expect(noImage).toHaveAttribute("aria-pressed", "false");
    await expect(zoom).toHaveValue("1");
    await expect(decrease).toBeDisabled();
    await expect(increase).toBeEnabled();
    await expect(
      editor.getByRole("radio", { name: "Без рамки", exact: true }),
    ).toBeChecked();
    await expect(previewImage).toHaveAttribute("src", b.url);
    await imageDecoded(previewImage, 40, 60);
    expect(
      await previewImage.evaluate((node) => ({
        left: (node as HTMLElement).style.left,
        top: (node as HTMLElement).style.top,
      })),
    ).toEqual({ left: "0%", top: "-25%" });
    await expect(name).toHaveValue("Страж портрета");
    const images = editor.getByRole("group", {
      name: "Изображение токена из файлов",
      exact: true,
    });
    await expect(
      images.getByRole("button", { name: b.name, exact: true }),
    ).toHaveCount(0);
    await expect(
      editor.getByRole("button", {
        name: "Создать изображение токена",
        exact: true,
      }),
    ).toHaveCount(0);
    await source.selectOption(a.id);
    await zoom.fill("2");
    await preview.focus();
    await preview.press("Shift+ArrowRight");
    await preview.press("Shift+ArrowDown");
    await editor.getByRole("radio", { name: "Серебро", exact: true }).check();
    await expect(source).toHaveValue(a.id);
    await imageDecoded(previewImage, 60, 40);
    fixture.refreshUnrelatedSnapshot();
    await expect(
      source.getByRole("option", { name: unrelated.name, exact: true }),
    ).toHaveCount(1);
    expect(await originalEditor.evaluate((node) => node.isConnected)).toBe(
      true,
    );
    await expect(source).toHaveValue(a.id);
    await expect(zoom).toHaveValue("2");
    await expect(
      editor.getByRole("radio", { name: "Серебро", exact: true }),
    ).toBeChecked();
    expect(
      await previewImage.evaluate((node) => ({
        left: (node as HTMLElement).style.left,
        top: (node as HTMLElement).style.top,
      })),
    ).toEqual(edited);
    await expect(
      images.getByRole("button", { name: token.name, exact: true }),
    ).toHaveCount(0);
    await preview.scrollIntoViewIfNeeded();
    await capture(page, testInfo, "manual-a-after-live-snapshot");
    // Return to uploaded B; one Save now generates B and saves its returned ID
    // even though bootstrap does not yet expose the derivative.
    await source.selectOption(b.id);
    await zoom.fill("1");
    await editor.getByRole("radio", { name: "Без рамки", exact: true }).check();
    await editor
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    const card = page
      .locator(".palette-card")
      .filter({ hasText: "Страж портрета" });
    await expect(card).toBeVisible();
    await expect(card.locator("img")).toHaveAttribute("src", token.url);
    await imageDecoded(card.locator("img"), 64, 64);
    expect(fixture.writes).toHaveLength(4);
    expect(fixture.writes[2]).toEqual({
      path: `/api/assets/${b.id}/token`,
      actionId: expect.stringMatching(uuid),
      status: 201,
      body: {
        cropX: 0.5,
        cropY: 0.5,
        zoom: 1,
        frame: "NONE",
        name: "SourceB-portrait",
      },
    });
    expect(fixture.writes[3]).toEqual({
      path: "/api/token-definitions",
      actionId: expect.stringMatching(uuid),
      status: 201,
      body: {
        name: "Страж портрета",
        characterId: null,
        defaultAssetId: token.id,
        defaultWidth: 64,
        defaultHeight: 64,
        controllerMembershipIds: [],
        actionId: expect.stringMatching(uuid),
      },
    });
    expect(
      fixture.writes
        .filter((item) => item.upload)
        .every((item) => uuid.test(item.actionId ?? "")),
    ).toBe(true);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await capture(page, testInfo, "saved-derived-token");
  } finally {
    const path = testInfo.outputPath("upload-source-receipt.json");
    await writeFile(
      path,
      JSON.stringify(
        {
          writes: fixture.writes,
          reads: fixture.reads,
          background: fixture.background,
          unexpected: fixture.unexpected,
          pageErrors: fixture.pageErrors,
          evidence: fixture.evidence,
        },
        null,
        2,
      ),
    );
    await testInfo.attach("upload-source-receipt", {
      path,
      contentType: "application/json",
    });
    for (const held of fixture.heldUploads)
      await held.route.abort("blockedbyclient").catch(() => undefined);
  }
});

test("UIX-589 palette replacement and controllers commit in one PATCH with stable retry intent", async ({
  page,
}) => {
  const fixture = await installBoundary(page, true);
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await openWorkspaceSection(page, "Токены");
    const card = page
      .locator(".palette-card")
      .filter({ hasText: "Редактируемый страж" });
    await expect(card).toBeVisible();
    await expect(card.locator("img")).toHaveAttribute("src", oldToken.url);
    await card.getByRole("button", { name: "Настроить", exact: true }).click();
    const editor = page.getByRole("dialog", {
      name: "Настройка Редактируемый страж",
      exact: true,
    });
    const source = editor.getByRole("combobox", {
      name: "Исходное изображение",
      exact: true,
    });
    await expect(source).toHaveValue("");
    await source.selectOption(b.id);
    await expect(source).toHaveValue(b.id);
    await imageDecoded(editor.locator(".token-image-preview img"), 40, 60);
    await editor
      .getByRole("slider", { name: "Масштаб изображения токена", exact: true })
      .fill("2");
    await editor.locator(".token-image-preview").focus();
    await editor.locator(".token-image-preview").press("ArrowRight");
    await editor
      .getByRole("checkbox", { name: "Игрок атомарной правки", exact: true })
      .check();
    const save = editor.getByRole("button", { name: "Сохранить", exact: true });
    await save.click();
    await expect.poll(() => fixture.heldPatches.length).toBe(1);
    await expect(save).toBeDisabled();
    await expect(card.locator("img")).toHaveAttribute("src", oldToken.url);
    await expect(
      page.getByText("Токен обновлён.", { exact: true }),
    ).toHaveCount(0);
    expect(fixture.controllerWrites).toEqual([]);
    const firstPatch = fixture.heldPatches[0]!.recorded.body!;
    expect(firstPatch).toEqual({
      name: "Редактируемый страж",
      characterId: null,
      defaultAssetId: token.id,
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [ids.player],
      revision: 4,
      actionId: expect.stringMatching(uuid),
    });
    await fixture.finishPatch(false);
    await expect(editor.getByRole("alert")).toHaveText(
      "Атомарная правка отклонена",
    );
    await expect(save).toBeEnabled();
    await expect(editor).toBeVisible();
    await expect(card.locator("img")).toHaveAttribute("src", oldToken.url);
    await expect(
      page.getByText("Токен обновлён.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      editor.getByRole("checkbox", {
        name: "Игрок атомарной правки",
        exact: true,
      }),
    ).toBeChecked();
    await save.click();
    await expect.poll(() => fixture.heldPatches.length).toBe(1);
    expect(fixture.heldPatches[0]!.recorded.body).toEqual(firstPatch);
    await expect(card.locator("img")).toHaveAttribute("src", oldToken.url);
    await fixture.finishPatch(true);
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Токен обновлён." }),
    ).toHaveText("Токен обновлён.");
    await expect(card.locator("img")).toHaveAttribute("src", token.url);
    await imageDecoded(card.locator("img"), 64, 64);
    expect(fixture.writes.map((entry) => entry.path)).toEqual([
      `/api/assets/${b.id}/token`,
      `/api/token-definitions/${ids.definition}`,
      `/api/token-definitions/${ids.definition}`,
    ]);
    expect(fixture.writes[0]!.body).toEqual({
      cropX: 0.51,
      cropY: 0.5,
      zoom: 2,
      frame: "NONE",
      name: "SourceB-portrait",
    });
    expect(fixture.controllerWrites).toEqual([]);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    for (const held of fixture.heldPatches)
      await held.route.abort("blockedbyclient").catch(() => undefined);
  }
});

for (const width of [1280, 390]) {
  test(`UIX-317 image intake error association and recovery in token dialog ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 850 });
    const fixture = await installBoundary(page);
    await page.goto("/");
    await openWorkspaceSection(page, "Токены");
    await page
      .locator(".token-palette")
      .getByRole("button", { name: "Создать токен", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Новый токен",
      exact: true,
    });
    const name = dialog.getByLabel("Название", { exact: true });
    await name.fill("Черновик портрета");
    const input = dialog.getByLabel("Загрузить новое изображение", {
      exact: true,
    });
    const field = dialog.locator(".arken-upload-field").filter({
      has: page.getByLabel("Загрузить новое изображение", { exact: true }),
    });
    const picker = field.getByRole("button", {
      name: "Выбрать файл",
      exact: true,
    });
    const zone = field.getByRole("button", {
      name: "Выбрать, вставить или перетащить файл",
      exact: true,
    });
    const hint =
      "Выберите, вставьте или перетащите файл — он станет доступен в генераторе";
    const error = "Поддерживаются только PNG, JPEG и WebP.";
    for (const control of [input, picker, zone])
      await expect(control).toHaveAccessibleDescription(hint);
    const bad = {
      name: "unsupported.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    };
    await input.setInputFiles(bad);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    for (const control of [input, picker, zone])
      await expect(control).toHaveAccessibleDescription(`${hint} ${error}`);
    await expect(field.getByRole("alert")).toHaveText(error);
    await field.getByRole("alert").scrollIntoViewIfNeeded();
    const box = (await field.getByRole("alert").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(fixture.writes).toEqual([]);
    await input.setInputFiles({
      name: a.name,
      mimeType: "image/png",
      buffer: aBytes,
    });
    const source = dialog.getByRole("combobox", {
      name: "Исходное изображение",
      exact: true,
    });
    await expect(source).toHaveValue(a.id);
    await imageDecoded(dialog.locator(".token-image-preview img"), 60, 40);
    await expect(field.getByRole("alert")).toHaveCount(0);
    await expect(input).not.toHaveAttribute("aria-invalid");
    await expect(input).toHaveAccessibleDescription(hint);
    await input.setInputFiles(bad);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(source).toHaveValue(a.id);
    await expect(name).toHaveValue("Черновик портрета");
    await imageDecoded(dialog.locator(".token-image-preview img"), 60, 40);
    expect(fixture.writes.map((write) => write.path)).toEqual(["/api/assets"]);
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.unexpected).toEqual([]);
    expect(
      fixture.background.filter((entry) => entry.includes("client-logs")),
    ).toEqual([]);
    await capture(page, info, "image-intake-error");
    await info.attach("image-intake-receipt", {
      body: JSON.stringify({
        width,
        writes: fixture.writes,
        errors: fixture.pageErrors,
        background: fixture.background,
      }),
      contentType: "application/json",
    });
  });
}
