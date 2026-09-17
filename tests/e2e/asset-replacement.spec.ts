import { deflateSync } from "node:zlib";
import type { Route } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
function makePng(width: number, height: number, rgb: [number, number, number]) {
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

const originalPng = makePng(1, 1, [30, 60, 90]);
const png = makePng(1, 1, [180, 80, 40]);
for (const width of [1280, 390]) {
  test(`UIX-293 replacement review conflict retry and success ${width}`, async ({
    page,
  }, info) => {
    const current = gmSnapshot({ schemaVersion: 2 });
    const id = "f1be0001-1111-4111-8111-111111111111";
    const asset = {
      id,
      kind: "IMAGE" as const,
      name: "Карта зала.png",
      mimeType: "image/png",
      sizeBytes: png.length,
      width: 1,
      height: 1,
      durationSeconds: null,
      url: `/api/assets/${id}/content`,
      createdAt: new Date(0).toISOString(),
    };
    current.assets = [asset];
    let activeBytes = originalPng;
    let version = `"${"a".repeat(64)}"`,
      heads = 0,
      gets = 0;
    const pending: Route[] = [],
      commands: { version: string; action: string; body: string }[] = [],
      errors: string[] = [],
      unexpected: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!["GET", "HEAD"].includes(route.request().method())) {
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        unexpected.push(`${route.request().method()} ${path}`);
        return route.abort();
      }
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      return route.fulfill({ json: [] });
    });
    await page.route("**/api/bootstrap", (route) =>
      route.fulfill({ json: current }),
    );
    await page.route(`**/api/assets/${id}/usage`, (route) =>
      route.fulfill({
        json: {
          asset,
          inUse: true,
          usages: [
            {
              kind: "SCENE",
              entityId: "scene",
              label: "Сцена",
              location: "Зал крепости",
            },
          ],
          hiddenUsageCount: 0,
          canDelete: false,
          deletionBlockedReason: "ASSET_IN_USE",
        },
      }),
    );
    await page.route(`**/api/assets/${id}/content*`, (route) => {
      const req = route.request();
      if (req.method() === "HEAD") {
        heads++;
        return route.fulfill({ headers: { etag: version } });
      }
      if (req.method() === "PUT") {
        commands.push({
          version: req.headers()["if-match"],
          action: req.headers()["x-action-id"],
          body: req.postDataBuffer()?.toString("base64") ?? "",
        });
        pending.push(route);
        return;
      }
      gets++;
      return route.fulfill({
        contentType: "image/png",
        headers: { etag: version, "cache-control": "private, no-cache" },
        body: activeBytes,
      });
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((m) => {
        if (m.toString() === "40") socket.send('40{"sid":"replace"}');
      });
      socket.send(
        '0{"sid":"replace-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await openWorkspaceSection(page, "Файлы");
    const files = page.getByRole("dialog", { name: "Файлы", exact: true });
    const preview = files.getByRole("img", { name: `Превью: ${asset.name}` });
    await expect(preview).toBeVisible();
    await expect
      .poll(() =>
        preview.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    const dialog = page.getByRole("dialog", {
      name: `Заменить файл «${asset.name}»`,
      exact: true,
    });
    const open = async () => {
      await files
        .getByRole("button", { name: "Заменить файл", exact: true })
        .click();
      await expect(dialog).toBeVisible();
    };
    const review = async () => {
      await dialog
        .getByLabel("Новое изображение", { exact: true })
        .setInputFiles({
          name: "новая-карта.png",
          mimeType: "image/png",
          buffer: png,
        });
      await expect(dialog.locator("img")).toBeVisible();
      await expect
        .poll(() =>
          dialog
            .locator("img")
            .evaluate((node) => (node as HTMLImageElement).naturalWidth),
        )
        .toBe(1);
      await dialog
        .getByRole("button", { name: "Проверить замену", exact: true })
        .click();
      await expect(dialog.getByText("Сцена · Зал крепости")).toBeVisible();
    };
    try {
      await open();
      await review();
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(commands).toHaveLength(0);
      await open();
      await review();
      const approve = dialog.getByRole("button", {
        name: "Подтвердить замену",
        exact: true,
      });
      await approve.click();
      await expect.poll(() => pending.length).toBe(1);
      await expect(
        dialog.getByRole("button", { name: "Отмена", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      version = `"${"b".repeat(64)}"`;
      await pending.shift()!.fulfill({
        status: 409,
        json: { error: "ASSET_VERSION_CONFLICT", message: "Файл изменён" },
      });
      await expect(dialog.getByRole("alert")).toContainText("Файл уже изменён");
      await expect(approve).toHaveCount(0);
      await expect(
        dialog.getByText("новая-карта.png", { exact: true }),
      ).toBeVisible();
      await dialog
        .getByRole("button", { name: "Проверить замену", exact: true })
        .click();
      await expect(approve).toBeVisible();
      await approve.click();
      await expect.poll(() => pending.length).toBe(1);
      await pending.shift()!.abort("failed");
      await expect(dialog.getByRole("alert")).toContainText(
        "Не удалось связаться с сервером",
      );
      const beforeRetryHeads = heads,
        beforeSuccessGets = gets;
      await dialog
        .getByRole("button", { name: "Повторить замену", exact: true })
        .click();
      await expect.poll(() => pending.length).toBe(1);
      expect(heads).toBe(beforeRetryHeads);
      version = `"${"c".repeat(64)}"`;
      activeBytes = png;
      asset.url = `/api/assets/${id}/content?v=${version.slice(1, -1)}`;
      await pending
        .shift()!
        .fulfill({ json: { asset, version, replayed: true } });
      await expect(dialog.getByRole("status")).toContainText("Файл заменён");
      expect(commands).toHaveLength(3);
      expect(commands[0].version).toBe(`"${"a".repeat(64)}"`);
      expect(commands[1].version).toBe(`"${"b".repeat(64)}"`);
      expect(commands[1].action).not.toBe(commands[0].action);
      expect(commands[2].action).toBe(commands[1].action);
      expect(commands[2].version).toBe(commands[1].version);
      // Multipart boundaries can differ; compare the actual uploaded PNG bytes.
      for (const command of commands)
        expect(Buffer.from(command.body, "base64").includes(png)).toBe(true);
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await dialog
        .getByRole("button", { name: "Закрыть", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(preview).toBeVisible();
      await expect.poll(() => gets).toBeGreaterThan(beforeSuccessGets);
      await expect
        .poll(() =>
          preview.evaluate((node) => {
            const c = document.createElement("canvas");
            c.width = 1;
            c.height = 1;
            const ctx = c.getContext("2d")!;
            ctx.drawImage(node as HTMLImageElement, 0, 0);
            return [...ctx.getImageData(0, 0, 1, 1).data];
          }),
        )
        .toEqual([180, 80, 40, 255]);
      await page.screenshot({
        path: info.outputPath("replacement-complete.png"),
      });
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
      await info.attach("replacement-receipt", {
        body: JSON.stringify({
          width,
          heads,
          gets,
          beforeSuccessGets,
          previewSrc: await preview.getAttribute("src"),
          previewPixel: await preview.evaluate((node) => {
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(node as HTMLImageElement, 0, 0);
            return [...ctx.getImageData(0, 0, 1, 1).data];
          }),
          expectedNewPixel: [180, 80, 40, 255],
          commands: commands.map(({ version, action }) => ({
            version,
            action,
          })),
          errors,
          unexpected,
        }),
        contentType: "application/json",
      });
    } finally {
      for (const route of pending)
        await route
          .fulfill({ status: 503, json: { error: "TEST_CLEANUP" } })
          .catch(() => undefined);
    }
  });
}
