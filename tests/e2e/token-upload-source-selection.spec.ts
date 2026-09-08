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

async function installBoundary(page: Page) {
  const snapshot = initialSnapshot();
  const writes: RecordedWrite[] = [];
  const reads: string[] = [];
  const background: string[] = [];
  const unexpected: string[] = [];
  const pageErrors: string[] = [];
  const sockets = new Set<WebSocketRoute>();
  const heldUploads: Array<{ route: Route; recorded: RecordedWrite }> = [];
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
        snapshot.assets = [token, ...snapshot.assets];
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
    evidence,
    sockets,
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
      snapshot.assets = [unrelated, token, b, a];
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
    await upload.setInputFiles({
      name: a.name,
      mimeType: "image/png",
      buffer: aBytes,
    });
    const source = editor.getByLabel("Исходное изображение", { exact: true });
    await expect(source).toHaveValue(a.id);
    const preview = editor.locator(".token-image-preview");
    const previewImage = preview.locator("img");
    await imageDecoded(previewImage, 60, 40);
    const zoom = editor.getByRole("slider", {
      name: "Масштаб изображения токена",
      exact: true,
    });
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
    await expect(zoom).toHaveValue("2");
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
    await expect(zoom).toHaveValue("1");
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
    await editor
      .getByRole("button", { name: "Создать изображение токена", exact: true })
      .click();
    await expect(
      images.getByRole("button", { name: token.name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
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
    ).toHaveAttribute("aria-pressed", "true");
    await preview.scrollIntoViewIfNeeded();
    await capture(page, testInfo, "manual-a-after-live-snapshot");
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
