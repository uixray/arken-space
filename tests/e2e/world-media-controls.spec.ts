import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const width of [1280, 360])
  test(`UIX-645 world media controls ${width}`, async ({ page }, testInfo) => {
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
    const media: Record<string, unknown>[] = [0, 1].map((index) => ({
      id: `69100000-0000-4000-8000-00000000009${index}`,
      worldContentId: id,
      assetId: snapshot.assets[index]!.id,
      caption:
        index === 0 ? `Башня_${"длиннаяподпись".repeat(12)}` : "Вид с реки",
      ordering: index,
      createdAt: date,
    }));
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
    await open();
    const owner = page.getByRole("dialog", {
      name: "Редактор мира",
      exact: true,
    });
    const grid = owner.locator(".world-content-workspace__media-grid");
    await expect(grid.locator("li")).toHaveCount(2);
    await grid.scrollIntoViewIfNeeded();
    const geometry = await grid.evaluate((n) => ({
      client: n.clientWidth,
      scroll: n.scrollWidth,
    }));
    expect(geometry.scroll, JSON.stringify(geometry)).toBeLessThanOrEqual(
      geometry.client + 1,
    );
    const rows = grid.locator("li");
    await expect(
      rows
        .first()
        .getByRole("button", { name: "Переместить выше", exact: true }),
    ).toBeDisabled();
    await expect(
      rows
        .last()
        .getByRole("button", { name: "Переместить ниже", exact: true }),
    ).toBeDisabled();
    for (const b of await grid.getByRole("button").all()) {
      await expect(b).toHaveAccessibleName(/\S/);
      await b.scrollIntoViewIfNeeded();
      const box = await b.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
      expect(box!.height).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
      if (await b.isEnabled())
        expect(
          await b.evaluate((n) => {
            const r = n.getBoundingClientRect();
            return n.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
        ).toBe(true);
      for (const svg of await b.locator("svg.arken-icon").all()) {
        await expect(svg).toHaveAttribute("aria-hidden", "true");
        await expect(svg).toHaveAttribute("focusable", "false");
        await expect(svg).toHaveAttribute("stroke", "currentColor");
      }
    }
    await expect(grid.locator("svg.arken-icon")).toHaveCount(4);
    await testInfo.attach("media-geometry", {
      body: JSON.stringify({ width, geometry }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath(`world-media-${width}.png`),
    });
    expect(writes).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
