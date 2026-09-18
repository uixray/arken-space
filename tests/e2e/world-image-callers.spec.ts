import { type Locator } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const width of [1280, 390])
  test(`UIX-644 world image caller isolation ${width}`, async ({
    page,
  }, testInfo) => {
    const snapshot = buildGameSnapshot("GM", { schemaVersion: 2 });
    const date = new Date(0).toISOString(),
      id = "69100000-0000-4000-8000-000000000001";
    snapshot.assets = Array.from({ length: 14 }, (_, i) => ({
      id: `69100000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
      kind: "IMAGE" as const,
      name: `Иллюстрация ${String(i + 1).padStart(2, "0")}`,
      mimeType: "image/svg+xml",
      sizeBytes: 128,
      width: 64,
      height: 64,
      durationSeconds: null,
      url: `/api/assets/test-${i}/content`,
      createdAt: date,
    }));
    const entity = {
      id,
      slug: "tower",
      type: "LOCATION",
      subtype: null,
      name: "Башня",
      aliases: [],
      summary: "",
      publicText: "",
      gmOnlyText: "",
      tags: [],
      lifecycle: "PUBLISHED",
      coverAssetId: null as string | null,
      provenance: {
        sourceUrl: null,
        sourceExternalId: null,
        retrievedAt: null,
        rawContentHash: null,
        attribution: null,
        rightsReviewStatus: null,
        editorialApprovalStatus: null,
      },
      revision: 7,
      createdAt: date,
      updatedAt: date,
    };
    const media: Record<string, unknown>[] = [];
    const writes: {
        method: string;
        path: string;
        body: Record<string, unknown>;
      }[] = [],
      unexpected: string[] = [],
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.routeWebSocket(/\/socket\.io\//, (s) => {
      s.onMessage((m) => {
        if (m.toString() === "40") s.send('40{"sid":"images"}');
      });
      s.send(
        '0{"sid":"images","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.route("**/api/**", async (route) => {
      const r = route.request(),
        path = new URL(r.url()).pathname,
        method = r.method();
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      if (method === "GET") {
        if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
        if (path === "/api/story/posts")
          return route.fulfill({ json: { posts: [], nextCursor: null } });
        if (path === "/api/world-content")
          return route.fulfill({ json: [entity] });
        if (path === `/api/world-content/${id}`)
          return route.fulfill({ json: entity });
        if (path === `/api/world-content/${id}/media`)
          return route.fulfill({ json: media });
        if (path.endsWith("/content"))
          return route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#637d72"/></svg>',
          });
        return route.fulfill({ json: [] });
      }
      if (path === "/api/chat/read")
        return route.fulfill({ json: { ok: true } });
      if (method === "PATCH" && path === `/api/world-content/${id}`) {
        const body = r.postDataJSON();
        writes.push({ method, path, body });
        Object.assign(entity, body, { revision: entity.revision + 1 });
        return route.fulfill({ json: entity });
      }
      if (method === "POST" && path === `/api/world-content/${id}/media`) {
        const body = r.postDataJSON();
        writes.push({ method, path, body });
        const item = {
          id: "69100000-0000-4000-8000-000000000090",
          worldContentId: id,
          assetId: body.assetId,
          caption: body.caption,
          ordering: 0,
          createdAt: date,
        };
        media.push(item);
        return route.fulfill({ json: item });
      }
      unexpected.push(`${method} ${path}`);
      return route.fulfill({
        status: 405,
        json: { error: "UNEXPECTED_MUTATION" },
      });
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    async function open() {
      await openWorkspaceSection(page, "Редактор мира");
      await page
        .locator(".world-content-workspace__row")
        .filter({ hasText: "Башня" })
        .click();
    }
    async function hit(tile: Locator) {
      await tile.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          tile.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
        )
        .toBe(true);
      await tile.click();
    }
    await open();
    const owner = page.getByRole("dialog", {
      name: "Редактор мира",
      exact: true,
    });
    const cover = owner.getByRole("group", { name: "Обложка", exact: true });
    const gallery = owner.getByRole("group", {
      name: "Файл для прикрепления к галерее",
      exact: true,
    });
    await cover.getByRole("textbox").fill("14");
    const chosen = cover.getByRole("button", {
      name: "Иллюстрация 14",
      exact: true,
    });
    await hit(chosen);
    await expect(chosen).toHaveAttribute("aria-pressed", "true");
    await expect(
      gallery.getByRole("button", { name: "Выберите файл…", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(writes).toEqual([]);
    await page.keyboard.press("ArrowLeft");
    await expect(
      cover.getByRole("button", { name: "Без обложки", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(chosen).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(chosen).toHaveAttribute("aria-pressed", "true");
    await owner.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      method: "PATCH",
      body: { coverAssetId: snapshot.assets[13].id, revision: 7 },
    });
    await gallery.getByRole("textbox").fill("03");
    const attachment = gallery.getByRole("button", {
      name: "Иллюстрация 03",
      exact: true,
    });
    await hit(attachment);
    await expect(attachment).toHaveAttribute("aria-pressed", "true");
    await expect(chosen).toHaveAttribute("aria-pressed", "true");
    await owner.getByPlaceholder("Подпись (необязательно)").fill("Вид башни");
    await owner
      .getByRole("button", { name: "Прикрепить", exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toMatchObject({
      method: "POST",
      body: { assetId: snapshot.assets[2].id, caption: "Вид башни" },
    });
    await expect(
      gallery.getByRole("button", { name: "Выберите файл…", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(owner.getByPlaceholder("Подпись (необязательно)")).toHaveValue(
      "",
    );
    await page.reload();
    await open();
    await expect(
      cover.getByRole("button", { name: "Иллюстрация 14", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(owner.getByText("Вид башни", { exact: true })).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    await testInfo.attach("world-image-receipt", {
      body: JSON.stringify({ width, writes, unexpected, errors }),
      contentType: "application/json",
    });
  });
