import { expect, test } from "./react-console-guard";
import type { Page } from "@playwright/test";
import {
  addWorldContentMediaSchema,
  createWorldContentSchema,
  updateWorldContentSchema,
  type AssetDto,
  type WorldContentDto,
  type WorldContentMediaDto,
} from "@arken/contracts";
import {
  gmSnapshot,
  playerSnapshot,
} from "../../apps/web/src/test-support/game-snapshot-fixtures";
import {
  artbookProvenance,
  type ArtbookSource,
} from "../../apps/web/src/world-artbook";
import bundledArtbook from "../../docs/content/world-artbook.json" with { type: "json" };
import { mockAuthenticatedGameCapabilities } from "./mocked-game-capabilities";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { fulfillUnmocked } from "./mock-api-contract";

const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const selectedFolder = "tests/e2e/fixtures/uix263-artbook";
const date = new Date(0).toISOString();
const artbookSource = bundledArtbook as unknown as ArtbookSource;

async function configureGmArtbook(
    page: Page,
    width: number,
    seedCanonicalDrafts = false,
  ) {
    const snapshot = gmSnapshot({
      schemaVersion: 2,
      campaign: { ...gmSnapshot().campaign, id: campaignId },
    });
    const entities = new Map<string, WorldContentDto>();
    const media = new Map<string, WorldContentMediaDto[]>();
    const assetsByAction = new Map<string, AssetDto>();
    const assetLookups: string[] = [];
    const mediaActions = new Set<string>();
    const writes: { method: string; path: string; actionId?: string }[] = [];
    const forbiddenWrites: string[] = [];
    let nextId = 1;
    if (seedCanonicalDrafts) {
      artbookSource.записи.forEach((record, index) => {
        const row: WorldContentDto = {
          id: `cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, "0")}`,
          slug: record.slug,
          type: record.type,
          subtype: null,
          name: record.name,
          aliases: [],
          summary: record.summary ?? "",
          publicText: "",
          gmOnlyText: "",
          tags: [],
          lifecycle: "DRAFT",
          coverAssetId: null,
          provenance: artbookProvenance(artbookSource, record),
          revision: 0,
          createdAt: date,
          updatedAt: date,
        };
        entities.set(row.id, row);
        media.set(row.id, []);
      });
      nextId = artbookSource.записи.length + 1;
    }
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        if (message.toString() === "40") socket.send('40{"sid":"artbook"}');
      });
      socket.send(
        '0{"sid":"artbook","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const method = request.method();
      if (method !== "GET" && pathname !== "/api/chat/read") {
        const headerActionId = request.headers()["x-action-id"];
        let bodyActionId: string | undefined;
        if (!headerActionId) {
          const payload: unknown = request.postDataJSON?.();
          bodyActionId =
            typeof payload === "object" &&
            payload !== null &&
            "actionId" in payload &&
            typeof payload.actionId === "string"
              ? payload.actionId
              : undefined;
        }
        const actionId = headerActionId ?? bodyActionId;
        writes.push({ method, path: pathname, actionId });
      }
      if (pathname === "/api/bootstrap")
        return route.fulfill({ json: snapshot });
      if (pathname === "/api/soundpad")
        return route.fulfill({
          json: { packs: [], playerPlaybackEnabled: true },
        });
      if (pathname === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (pathname === "/api/world-content" && method === "GET")
        return route.fulfill({ json: [...entities.values()] });
      const uploadLookup = pathname.match(
        /^\/api\/assets\/upload-actions\/([^/]+)$/,
      );
      if (uploadLookup && method === "GET") {
        const actionId = decodeURIComponent(uploadLookup[1]!);
        assetLookups.push(actionId);
        const asset = assetsByAction.get(actionId);
        return asset
          ? route.fulfill({ json: asset })
          : route.fulfill({ status: 404, json: { error: "ASSET_NOT_FOUND" } });
      }
      if (pathname === "/api/world-content" && method === "POST") {
        const body = createWorldContentSchema.parse(request.postDataJSON());
        const prior = [...entities.values()].find(
          (item) => item.slug === body.slug,
        );
        if (prior)
          return route.fulfill({
            status: 409,
            json: { error: "WORLD_CONTENT_SLUG_CONFLICT" },
          });
        const provenance = body.provenance;
        if (!provenance)
          return route.fulfill({
            status: 400,
            json: { error: "ARTBOOK_PROVENANCE_REQUIRED" },
          });
        const row: WorldContentDto = {
          id: `cccccccc-cccc-4ccc-8ccc-${String(nextId++).padStart(12, "0")}`,
          slug: body.slug,
          type: body.type,
          subtype: null,
          name: body.name,
          aliases: [],
          summary: body.summary ?? "",
          publicText: "",
          gmOnlyText: "",
          tags: [],
          lifecycle: "DRAFT",
          coverAssetId: null,
          provenance,
          revision: 0,
          createdAt: date,
          updatedAt: date,
        };
        entities.set(row.id, row);
        media.set(row.id, []);
        return route.fulfill({ status: 201, json: row });
      }
      const match = pathname.match(
        /^\/api\/world-content\/([^/]+)(?:\/(media|lifecycle))?$/,
      );
      if (match && method === "GET") {
        const row = entities.get(match[1]!);
        if (match[2] === "media")
          return route.fulfill({ json: media.get(match[1]!) ?? [] });
        return row
          ? route.fulfill({ json: row })
          : route.fulfill({
              status: 404,
              json: { error: "WORLD_CONTENT_NOT_FOUND" },
            });
      }
      if (match && method === "PATCH" && !match[2]) {
        const row = entities.get(match[1]!);
        if (!row)
          return route.fulfill({
            status: 404,
            json: { error: "WORLD_CONTENT_NOT_FOUND" },
          });
        const body = updateWorldContentSchema.parse(request.postDataJSON());
        const { actionId: _actionId, revision: _revision, ...patch } = body;
        Object.assign(row, patch, {
          revision: row.revision + 1,
          updatedAt: new Date().toISOString(),
        });
        return route.fulfill({ json: row });
      }
      if (match && method === "POST" && match[2] === "media") {
        const body = addWorldContentMediaSchema.parse(request.postDataJSON());
        const entity = entities.get(match[1]!);
        const condition = body.importPrecondition;
        if (
          !entity ||
          !condition ||
          entity.lifecycle !== "DRAFT" ||
          entity.revision !== condition.expectedRevision ||
          entity.slug !== condition.slug ||
          entity.type !== condition.type ||
          entity.name !== condition.name ||
          entity.summary !== condition.summary ||
          JSON.stringify(entity.provenance) !==
            JSON.stringify(condition.provenance)
        )
          return route.fulfill({
            status: 409,
            json: { error: "IMPORT_PRECONDITION_FAILED" },
          });
        if (mediaActions.has(body.actionId))
          return route.fulfill({ status: 200, json: { duplicate: true } });
        const list = media.get(match[1]!) ?? [];
        const duplicate = list.find((item) => item.assetId === body.assetId);
        if (duplicate)
          return route.fulfill({
            status: 409,
            json: { error: "WORLD_CONTENT_MEDIA_ALREADY_ATTACHED" },
          });
        const row = {
          id: crypto.randomUUID(),
          worldContentId: match[1],
          assetId: body.assetId,
          caption: body.caption ?? null,
          ordering: list.length,
          createdAt: date,
        };
        list.push(row);
        media.set(match[1]!, list);
        mediaActions.add(body.actionId);
        return route.fulfill({ status: 201, json: row });
      }
      if (pathname === "/api/assets" && method === "POST") {
        const actionId = request.headers()["x-action-id"]!;
        let asset = assetsByAction.get(actionId);
        if (!asset) {
          asset = {
            id: `dddddddd-dddd-4ddd-8ddd-${String(nextId++).padStart(12, "0")}`,
            kind: "IMAGE",
            name: "Artbook image",
            mimeType: "image/webp",
            sizeBytes: 10,
            width: 1,
            height: 1,
            durationSeconds: null,
            url: "/mock.webp",
            createdAt: date,
          };
          assetsByAction.set(actionId, asset);
        }
        return route.fulfill({
          status:
            writes.filter((item) => item.path === "/api/assets").length >
            assetsByAction.size
              ? 200
              : 201,
          json: asset,
        });
      }
      if (pathname === "/api/client-logs")
        return route.fulfill({ json: { ok: true } });
      if (pathname === "/api/chat/read")
        return route.fulfill({ json: { ok: true } });
      if (method !== "GET") {
        forbiddenWrites.push(`${method} ${pathname}`);
        return route.fulfill({
          status: 405,
          json: { error: "UNEXPECTED_MUTATION" },
        });
      }
      return fulfillUnmocked(route, pathname);
    });

    await page.setViewportSize({ width, height: 850 });
    await mockAuthenticatedGameCapabilities(page);
    await page.goto("/");
    async function openImporter() {
      await openWorkspaceSection(page, "Редактор мира");
      await page
        .getByRole("button", { name: "Импорт артбука", exact: true })
        .click();
    }
    return {
      entities,
      media,
      assetsByAction,
      assetLookups,
      writes,
      forbiddenWrites,
      openImporter,
    };
}

for (const width of [390, 1280]) {
  test(`UIX-263 GM imports 78 artbook text records as DRAFT and resumes idempotently at ${width}px`, async ({ page }) => {
    const { entities, writes, forbiddenWrites, openImporter } =
      await configureGmArtbook(page, width);
    await openImporter();
    await page
      .getByRole("button", { name: "1. Предварительный просмотр текста" })
      .click();
    await expect(page.getByText(/Создать: 78; уже совпадает: 0/)).toBeVisible();
    expect(writes).toHaveLength(0);
    await page
      .getByLabel(
        /Я проверил preview и подтверждаю создание только отсутствующих записей/,
      )
      .check();
    await page
      .getByRole("button", { name: "2. Подтвердить создание DRAFT" })
      .click();
    const textReport = page.getByLabel("Отчёт импорта");
    await expect(textReport).toContainText(
      /artbook-amber.*created, этап create/,
    );
    expect(entities.size).toBe(78);
    expect(
      [...entities.values()].every(
        (item) =>
          item.lifecycle === "DRAFT" &&
          item.provenance.editorialApprovalStatus === "PENDING",
      ),
    ).toBe(true);
    expect(
      writes.filter(
        (item) => item.path === "/api/world-content" && item.method === "POST",
      ),
    ).toHaveLength(78);
    expect(writes.some((item) => item.path === "/api/assets")).toBe(false);
    expect(writes.some((item) => item.path.endsWith("/media"))).toBe(false);
    expect(writes.some((item) => item.path.endsWith("/lifecycle"))).toBe(
      false,
    );
    await page.reload();
    await openImporter();
    await page
      .getByRole("button", { name: "1. Предварительный просмотр текста" })
      .click();
    await expect(page.getByText(/Создать: 0; уже совпадает: 78/)).toBeVisible();
    expect(
      writes.filter(
        (item) => item.path === "/api/world-content" && item.method === "POST",
      ),
    ).toHaveLength(78);
    expect(forbiddenWrites).toEqual([]);
  });
}

for (const width of [390, 1280]) {
  test(`UIX-263 GM imports mapped media idempotently from canonical DRAFTs at ${width}px`, async ({ page }) => {
    const {
      entities,
      media,
      assetsByAction,
      assetLookups,
      writes,
      forbiddenWrites,
      openImporter,
    } = await configureGmArtbook(page, width, true);
    expect(entities.size).toBe(78);
    expect(
      [...entities.values()].every(
        (item) =>
          item.lifecycle === "DRAFT" &&
          item.revision === 0 &&
          item.coverAssetId === null &&
          item.provenance.editorialApprovalStatus === "PENDING",
      ),
    ).toBe(true);
    expect([...media.values()].every((items) => items.length === 0)).toBe(true);
    expect(assetsByAction.size).toBe(0);
    expect(writes).toEqual([]);
    await openImporter();
    const folder = page.getByLabel(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    );
    await folder.setInputFiles(selectedFolder);
    await expect(page.getByText(/Предложено 2 из/)).toBeVisible();
    expect(writes.filter((item) => item.path === "/api/assets")).toHaveLength(
      0,
    );
    await page.getByLabel(/Я проверил каждое показанное сопоставление/).check();
    await page
      .getByRole("button", { name: "4. Подтвердить сопоставления и загрузку" })
      .click();
    await expect
      .poll(() => {
        const current = [...entities.values()].find(
          (item) => item.slug === "artbook-amber",
        );
        return current ? (media.get(current.id)?.length ?? 0) : 0;
      })
      .toBe(1);
    const firstMediaReport = page.getByLabel("Отчёт импорта");
    const amber = [...entities.values()].find(
      (item) => item.slug === "artbook-amber",
    )!;
    expect(amber.coverAssetId).toBeTruthy();
    expect(media.get(amber.id)).toHaveLength(1);
    await expect(firstMediaReport).toContainText(
      /artbook-amber.*created, этап cover-attach/,
    );
    await expect(firstMediaReport).toContainText(
      /artbook-amber.*created, этап gallery-attach/,
    );
    const writeCount = writes.length;

    await page.reload();
    await openImporter();
    await page
      .getByLabel("3. Предложить сопоставления файлов (папка «Артбук»)")
      .setInputFiles(selectedFolder);
    await expect(page.getByText(/Предложено 2 из/)).toBeVisible();
    await page.getByLabel(/Я проверил каждое показанное сопоставление/).check();
    await page
      .getByRole("button", { name: "4. Подтвердить сопоставления и загрузку" })
      .click();
    await expect.poll(() => media.get(amber.id)?.length ?? 0).toBe(1);
    const reloadedMediaReport = page.getByLabel("Отчёт импорта");
    await expect(reloadedMediaReport).toContainText(
      /artbook-amber.*matched, этап reconcile/,
    );
    expect(media.get(amber.id)).toHaveLength(1);
    expect(amber.coverAssetId).toBeTruthy();
    expect(
      writes.filter(
        (item) => item.path.endsWith("/media") && item.method === "POST",
      ),
    ).toHaveLength(1);
    expect(writes.filter((item) => item.path === "/api/assets")).toHaveLength(
      2,
    );
    expect(assetsByAction.size).toBe(2);
    expect([...assetsByAction.keys()]).toHaveLength(2);
    expect(writes.length).toBe(writeCount);
    expect(assetLookups).toHaveLength(4);
    expect(assetLookups.slice(2)).toEqual(assetLookups.slice(0, 2));
    expect(forbiddenWrites).toEqual([]);
  });
}

for (const width of [390, 1280]) {
  test(`UIX-263 PLAYER cannot see importer or issue import writes at ${width}px`, async ({
    page,
  }) => {
    const snapshot = playerSnapshot({
      schemaVersion: 2,
      campaign: { ...playerSnapshot().campaign, id: campaignId },
    });
    const worldReads: string[] = [];
    const worldWrites: string[] = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (
        pathname === "/api/world-content" ||
        pathname.startsWith("/api/world-content/")
      ) {
        (request.method() === "GET" ? worldReads : worldWrites).push(
          `${request.method()} ${pathname}`,
        );
      }
      if (pathname === "/api/bootstrap")
        return route.fulfill({ json: snapshot });
      if (pathname === "/api/soundpad")
        return route.fulfill({
          json: { packs: [], playerPlaybackEnabled: true },
        });
      if (pathname === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (pathname === "/api/world-content") return route.fulfill({ json: [] });
      if (pathname === "/api/client-logs" || pathname === "/api/chat/read")
        return route.fulfill({ json: { ok: true } });
      if (request.method() !== "GET")
        return route.fulfill({
          status: 405,
          json: { error: "UNEXPECTED_MUTATION" },
        });
      return fulfillUnmocked(route, pathname);
    });
    await page.setViewportSize({ width, height: 850 });
    await mockAuthenticatedGameCapabilities(page);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Импорт артбука", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Артбук Аркен-Хара", { exact: true }),
    ).toHaveCount(0);
    expect(worldWrites).toEqual([]);
    expect(worldReads).toEqual([]);
  });
}
