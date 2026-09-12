import type {
  AssetDto,
  GameSnapshot,
  WorldContentDto,
  WorldMapLocationKind,
} from "@arken/contracts";
import { writeFile } from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

// Real App/navigation/Gravity controls, isolated HTTP responses only. These
// cases do not prove backend authorization, persistence, image generation,
// historical-data translation or the broad "all screens are Russian" AC.
const ids = {
  campaign: "41700000-0000-4000-8000-000000000001",
  member: "41700000-0000-4000-8000-000000000002",
  scene: "41700000-0000-4000-8000-000000000003",
  map: "41700000-0000-4000-8000-000000000004",
  image: "41700000-0000-4000-8000-000000000005",
  token: "41700000-0000-4000-8000-000000000006",
  content: "41700000-0000-4000-8000-000000000007",
  createdContent: "41700000-0000-4000-8000-000000000008",
  createdLocation: "41700000-0000-4000-8000-000000000009",
};
const date = "2026-09-08T00:00:00.000Z";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const sourceImage: AssetDto = {
  id: ids.image,
  kind: "IMAGE",
  name: "Elminster.png",
  url: `/api/assets/${ids.image}/content`,
  mimeType: "image/png",
  sizeBytes: png.length,
  width: 1,
  height: 1,
  durationSeconds: null,
  createdAt: date,
};
const locationCases: Array<{
  kind: WorldMapLocationKind;
  label: string;
  name: string;
}> = [
  { kind: "SETTLEMENT", label: "Поселение", name: "Waterdeep" },
  { kind: "LANDMARK", label: "Ориентир", name: "The Yawning Portal" },
  { kind: "REGION", label: "Регион", name: "Sword Coast" },
  { kind: "OTHER", label: "Другое", name: "Undermountain" },
];
const publishedContent: WorldContentDto = {
  id: ids.content,
  slug: "waterdeep",
  type: "LOCATION",
  subtype: null,
  name: "Waterdeep",
  aliases: ["City of Splendors"],
  summary: "Город на Побережье Мечей.",
  publicText: "The Yawning Portal",
  gmOnlyText: "Авторская заметка мастера.",
  tags: ["SwordCoast"],
  lifecycle: "PUBLISHED",
  coverAssetId: null,
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

function copySnapshot(): GameSnapshot {
  const locations = locationCases.map((item, index) => ({
    id: `41700000-0000-4000-8000-00000000001${index}`,
    mapId: ids.map,
    name: item.name,
    kind: item.kind,
    summary: "Авторское описание локации.",
    visibility: "PUBLIC" as const,
    x: 0.2 + index * 0.15,
    y: 0.5,
    revision: 0,
    sceneIds: [],
  }));
  const snapshot = gmSnapshot({
    schemaVersion: 2,
    assets: [{ ...sourceImage }],
    scenes: [
      {
        id: ids.scene,
        name: "Начальная сцена",
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
    worldMaps: {
      maps: [
        {
          id: ids.map,
          name: "Faerun",
          scope: "REGION",
          visibility: "CAMPAIGN",
          lifecycle: "DRAFT",
          backgroundAssetId: null,
          revision: 0,
        },
      ],
      locations,
      gmLocations: locations.map((location) => ({ ...location, gmNotes: "" })),
      partyPosition: null,
    },
  });
  snapshot.campaign.id = ids.campaign;
  snapshot.campaign.name = "Проверка русских подписей";
  snapshot.me.id = ids.member;
  snapshot.members = [snapshot.me];
  return snapshot;
}

type RecordedWrite = {
  method: string;
  path: string;
  body: Record<string, unknown>;
  actionId: string | null;
};

async function textGeometry(target: Locator) {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const rect = (value: DOMRect) => ({
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
    });
    const bounds = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const clipAncestors: Array<{ tag: string; className: string }> = [];
    const fixedBoundaries: string[] = [];
    // Fixed workspace windows escape the sidebar's overflow unless an ancestor
    // establishes their containing block. Keep clipping inside the window;
    // do not intersect viewport-fixed content with an unrelated sidebar box.
    const fixedContainingBlock = (element: Element): Element | null => {
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          style.transform !== "none" ||
          style.perspective !== "none" ||
          style.filter !== "none" ||
          style.backdropFilter !== "none" ||
          /(layout|paint|strict|content)/.test(style.contain) ||
          /(transform|perspective|filter)/.test(style.willChange) ||
          style.contentVisibility === "auto"
        )
          return parent;
      }
      return null;
    };
    // Include actual scrolling/clipping ancestors, not only viewport bounds.
    // A native input's internal scrollport can exclude its padding in Firefox.
    // It clips the text, not the control's own border box. Native text fit is
    // checked separately below; outer clipping starts at its actual parent.
    for (
      let parent: Element | null =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement
          ? element.parentElement
          : element;
      parent;
    ) {
      const style = getComputedStyle(parent);
      const parentBox = parent.getBoundingClientRect();
      if (
        /(auto|scroll|hidden|clip)/.test(
          `${style.overflowX} ${style.overflowY}`,
        )
      )
        clipAncestors.push({
          tag: parent.tagName,
          className: parent.className,
        });
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        bounds.left = Math.max(bounds.left, parentBox.left + parent.clientLeft);
        bounds.right = Math.min(
          bounds.right,
          parentBox.left + parent.clientLeft + parent.clientWidth,
        );
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        bounds.top = Math.max(bounds.top, parentBox.top + parent.clientTop);
        bounds.bottom = Math.min(
          bounds.bottom,
          parentBox.top + parent.clientTop + parent.clientHeight,
        );
      }
      if (style.position === "fixed") {
        fixedBoundaries.push(parent.className);
        parent = fixedContainingBlock(parent);
      } else {
        parent = parent.parentElement;
      }
    }
    const inside = (value: DOMRect) =>
      value.left >= bounds.left - 1 &&
      value.right <= bounds.right + 1 &&
      value.top >= bounds.top - 1 &&
      value.bottom <= bounds.bottom + 1;
    const textRects: DOMRect[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      textRects.push(
        ...Array.from(range.getClientRects()).filter(
          (value) => value.width > 0 && value.height > 0,
        ),
      );
    }
    // Native controls do not expose their painted text as DOM Range rectangles.
    // Record a font-width fit check and retain the screenshot for visual review.
    const nativeText =
      element instanceof HTMLSelectElement
        ? element.selectedOptions[0]?.textContent?.trim()
        : element instanceof HTMLInputElement
          ? element.value || element.placeholder
          : undefined;
    let nativeTextFits: boolean | null = null;
    if (nativeText !== undefined) {
      const style = getComputedStyle(element);
      const context = document.createElement("canvas").getContext("2d");
      if (context) {
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        nativeTextFits =
          context.measureText(nativeText).width <=
          element.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight);
      }
    }
    const hit = document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    );
    const interactive = element.matches(
      "button, input, select, [role='button'], [role='listitem']",
    );
    return {
      box: rect(box),
      viewport: { width: innerWidth, height: innerHeight },
      clipBounds: bounds,
      clipAncestors,
      fixedBoundaries,
      text: nativeText ?? (element as HTMLElement).innerText.trim(),
      textRects: textRects.map(rect),
      nativeTextFits,
      boxInside: inside(box),
      textInside: textRects.every(inside),
      hitValid: Boolean(
        hit &&
        (element.contains(hit) || (!interactive && hit.contains(element))),
      ),
    };
  });
}

type CopyEvidence = {
  phase: string;
  geometry: Awaited<ReturnType<typeof textGeometry>>;
};

async function captureCopy(
  page: Page,
  testInfo: TestInfo,
  evidence: CopyEvidence[],
  phase: string,
  target: Locator,
  screenshot = true,
) {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  let geometry = await textGeometry(target);
  try {
    await expect
      .poll(async () => {
        geometry = await textGeometry(target);
        return geometry.boxInside && geometry.hitValid;
      })
      .toBe(true);
  } finally {
    evidence.push({ phase, geometry });
    if (screenshot) {
      const path = testInfo.outputPath(`${phase}.png`);
      await page.screenshot({ path });
      await testInfo.attach(phase, { path, contentType: "image/png" });
    }
  }
  expect(geometry.text.length, phase).toBeGreaterThan(0);
  expect(geometry.textInside, `${phase}: text clipped`).toBe(true);
  if (geometry.nativeTextFits !== null)
    expect(geometry.nativeTextFits, `${phase}: native text width`).toBe(true);
  else
    expect(geometry.textRects.length, `${phase}: painted text`).toBeGreaterThan(
      0,
    );
}

async function attachCopyReceipts(
  testInfo: TestInfo,
  mock: Awaited<ReturnType<typeof installCopyApi>>,
) {
  const path = testInfo.outputPath("copy-receipts.json");
  await writeFile(
    path,
    JSON.stringify(
      {
        writes: mock.writes,
        blockedWrites: mock.blockedWrites,
        expectedBlockedBackgroundWrite: "POST /api/chat/read",
        pageErrors: mock.pageErrors,
        evidence: mock.evidence,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("copy-receipts", {
    path,
    contentType: "application/json",
  });
}

async function installCopyApi(page: Page) {
  const snapshot = copySnapshot();
  const content = [structuredClone(publishedContent)];
  const writes: RecordedWrite[] = [];
  const blockedWrites: string[] = [];
  const pageErrors: string[] = [];
  const evidence: CopyEvidence[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Neither transport can connect to a real campaign alongside the mock.
  await page.routeWebSocket("**/socket.io/**", (socket) => socket.close());
  await page.route("**/socket.io/**", (route) =>
    route.abort("blockedbyclient"),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === "GET" || method === "HEAD") {
      if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
      if (path === "/api/world-content")
        return route.fulfill({ json: content });
      const entity = content.find(
        (item) => path === `/api/world-content/${item.id}`,
      );
      if (entity) return route.fulfill({ json: entity });
      if (
        [ids.image, ids.token].some(
          (id) => path === `/api/assets/${id}/content`,
        )
      )
        return route.fulfill({ contentType: "image/png", body: png });
      // Unrelated read endpoints (access, gallery, relations) are empty here.
      return route.fulfill({ json: [] });
    }
    const allowed =
      method === "POST" &&
      [
        "/api/world-maps/locations",
        "/api/world-content",
        `/api/assets/${ids.image}/token`,
      ].includes(path);
    if (!allowed) {
      blockedWrites.push(`${method} ${path}`);
      return route.abort("blockedbyclient");
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    writes.push({
      method,
      path,
      body,
      actionId: await request.headerValue("x-action-id"),
    });
    if (path === "/api/world-maps/locations") {
      const location = {
        id: ids.createdLocation,
        mapId: String(body.mapId),
        name: String(body.name),
        kind: body.kind as WorldMapLocationKind,
        summary: String(body.summary),
        visibility: "GM_ONLY" as const,
        x: Number(body.x),
        y: Number(body.y),
        revision: 0,
        sceneIds: [],
      };
      snapshot.worldMaps!.locations.push(location);
      snapshot.worldMaps!.gmLocations!.push({
        ...location,
        gmNotes: String(body.gmNotes),
      });
      snapshot.snapshotVersion += 1;
      return route.fulfill({ json: {} });
    }
    if (path === "/api/world-content") {
      const created: WorldContentDto = {
        ...publishedContent,
        id: ids.createdContent,
        name: String(body.name),
        slug: String(body.slug),
        aliases: [],
        tags: [],
        summary: "",
        publicText: "",
        gmOnlyText: "",
        lifecycle: "DRAFT",
        revision: 0,
      };
      content.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    // This is a DTO response stub, not actual image transformation/storage.
    const generated: AssetDto = {
      ...sourceImage,
      id: ids.token,
      kind: "TOKEN",
      name: String(body.name),
      url: `/api/assets/${ids.token}/content`,
    };
    snapshot.assets.push(generated);
    snapshot.snapshotVersion += 1;
    return route.fulfill({ status: 201, json: generated });
  });
  return { writes, blockedWrites, pageErrors, evidence };
}

for (const width of [1280, 390]) {
  test(`UIX-417 Russian world copy: map list, card and location form ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const mock = await installCopyApi(page);
    const capture = (phase: string, target: Locator, screenshot = true) =>
      captureCopy(page, testInfo, mock.evidence, phase, target, screenshot);
    try {
      await page.goto("/");
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
      await openWorkspaceSection(page, "Карты мира");
      const workspace = page.getByRole("dialog", {
        name: "Карты мира",
        exact: true,
      });
      await expect(
        workspace.getByText("Сначала загрузите карту в разделе «Файлы».", {
          exact: true,
        }),
      ).toBeVisible();
      await capture(
        "map-upload-guidance",
        workspace.getByText("Сначала загрузите карту в разделе «Файлы».", {
          exact: true,
        }),
      );
      await expect(
        workspace.getByText(
          "Выберите файл карты и подтвердите фон перед публикацией.",
          { exact: true },
        ),
      ).toBeVisible();
      const list = workspace.getByRole("list", { name: "Список локаций" });
      const card = workspace.locator(".world-map-location-card");
      for (const { name, label, kind: locationKind } of locationCases) {
        const item = list.getByRole("listitem").filter({ hasText: name });
        await expect(item.getByText(name, { exact: true })).toBeVisible();
        await expect(item.getByText(label, { exact: true })).toBeVisible();
        await capture(
          `map-list-${locationKind.toLowerCase()}`,
          item,
          locationKind === "SETTLEMENT",
        );
        await item.click();
        await expect(
          card.getByRole("heading", { name, exact: true }),
        ).toBeVisible();
        await expect(card.getByText(label, { exact: true })).toBeVisible();
        await capture(
          `map-card-${locationKind.toLowerCase()}`,
          card.getByText(label, { exact: true }),
          locationKind === "OTHER",
        );
      }
      await workspace
        .getByRole("button", { name: "Добавить локацию", exact: true })
        .click();
      const form = page.getByRole("dialog", {
        name: "Новая локация",
        exact: true,
      });
      const kind = form.getByRole("combobox", { name: "Тип", exact: true });
      await expect(kind.locator("option")).toHaveText([
        "Поселение",
        "Ориентир",
        "Регион",
        "Другое",
      ]);
      await kind.selectOption({ label: "Ориентир" });
      await expect(kind).toHaveValue("LANDMARK");
      await capture("map-location-kind", kind);
      await form
        .getByRole("textbox", { name: "Название", exact: true })
        .fill("High Forest Gate");
      await form
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect(form).toBeHidden();
      await expect.poll(() => mock.writes.length).toBe(1);
      expect(mock.writes[0]).toEqual({
        method: "POST",
        path: "/api/world-maps/locations",
        actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        body: {
          actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          mapId: ids.map,
          name: "High Forest Gate",
          kind: "LANDMARK",
          summary: "",
          gmNotes: "",
          visibility: "GM_ONLY",
          x: 0.5,
          y: 0.5,
        },
      });
      const created = list
        .getByRole("listitem")
        .filter({ hasText: "High Forest Gate" });
      await expect(
        created.getByText("Ориентир", { exact: true }),
      ).toBeVisible();
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
      // Same known App bootstrap background write as UIX-502: still blocked,
      // merely classified separately. No other unexpected mutation is allowed.
      expect(
        mock.blockedWrites.filter((write) => write !== "POST /api/chat/read"),
      ).toEqual([]);
      expect(mock.pageErrors).toEqual([]);
    } finally {
      await attachCopyReceipts(testInfo, mock);
    }
  });

  test(`UIX-417 Russian world copy: world editor, reader and token generator ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const mock = await installCopyApi(page);
    const capture = (phase: string, target: Locator, screenshot = true) =>
      captureCopy(page, testInfo, mock.evidence, phase, target, screenshot);
    try {
      await page.goto("/");
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
      await openWorkspaceSection(page, "Редактор мира");
      const editor = page.getByRole("dialog", {
        name: "Редактор мира",
        exact: true,
      });
      await expect(
        editor.getByPlaceholder("фракция, порт", { exact: true }),
      ).toBeVisible();
      await capture(
        "world-editor-tags",
        editor.getByPlaceholder("фракция, порт", { exact: true }),
      );
      await editor
        .locator(".world-content-workspace__row")
        .filter({ hasText: "Waterdeep" })
        .click();
      await expect(
        editor.getByRole("heading", { name: "Waterdeep", exact: true }),
      ).toBeVisible();
      await expect(editor.getByText("Версия 7", { exact: true })).toBeVisible();
      await capture(
        "world-editor-version",
        editor.getByText("Версия 7", { exact: true }),
      );
      await expect(
        editor.getByRole("textbox", {
          name: "Алиасы (через запятую)",
          exact: true,
        }),
      ).toHaveValue("City of Splendors");
      await editor
        .getByRole("button", { name: "Создать сущность", exact: true })
        .click();
      const create = page.getByRole("dialog", {
        name: "Новая сущность энциклопедии",
        exact: true,
      });
      await expect(
        create.getByText("Создаётся как черновик.", { exact: true }),
      ).toBeVisible();
      await capture(
        "world-create-draft",
        create.getByText("Создаётся как черновик.", { exact: true }),
      );
      await create
        .getByRole("textbox", { name: "Название", exact: true })
        .fill("Baldur's Gate");
      // The associated help text joins the field's accessible name only while invalid.
      const slug = create
        .locator("label")
        .filter({ hasText: /^\s*Идентификатор/ })
        .getByRole("textbox");
      await capture(
        "world-create-identifier",
        slug.locator("xpath=ancestor::label[1]"),
      );
      await slug.fill("INVALID SLUG");
      await create
        .getByRole("button", { name: "Создать", exact: true })
        .click();
      await expect(
        create.getByText(
          "Идентификатор должен содержать строчные латинские буквы, цифры и дефисы между словами.",
          { exact: true },
        ),
      ).toBeVisible();
      await capture(
        "world-identifier-error",
        create.getByText(
          "Идентификатор должен содержать строчные латинские буквы, цифры и дефисы между словами.",
          { exact: true },
        ),
      );
      expect(mock.writes).toEqual([]);
      await slug.fill("baldurs-gate");
      await create
        .getByRole("button", { name: "Создать", exact: true })
        .click();
      await expect(create).toBeHidden();
      await expect(
        editor.getByRole("heading", { name: "Baldur's Gate", exact: true }),
      ).toBeVisible();
      await expect(editor.getByText("Версия 0", { exact: true })).toBeVisible();
      await expect.poll(() => mock.writes.length).toBe(1);
      expect(mock.writes[0]).toEqual({
        method: "POST",
        path: "/api/world-content",
        actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        body: {
          actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          name: "Baldur's Gate",
          slug: "baldurs-gate",
          type: "LOCATION",
          subtype: null,
          aliases: [],
          tags: [],
        },
      });
      await editor
        .getByRole("button", { name: "Закрыть окно", exact: true })
        .click();
      await expect(editor).toBeHidden();
      await openWorkspaceSection(page, "Справочник мира");
      const reader = page.getByRole("dialog", {
        name: "Справочник мира",
        exact: true,
      });
      await expect(
        reader.getByPlaceholder("фракция, порт", { exact: true }),
      ).toBeVisible();
      await capture(
        "world-reader-tags",
        reader.getByPlaceholder("фракция, порт", { exact: true }),
      );
      await expect(
        reader.getByText("Waterdeep", { exact: true }),
      ).toBeVisible();
      await reader
        .getByRole("button", { name: "Закрыть окно", exact: true })
        .click();
      await expect(reader).toBeHidden();
      await openWorkspaceSection(page, "Токены");
      await page
        .getByRole("button", { name: "Создать токен", exact: true })
        .click();
      const tokenEditor = page.getByRole("dialog", {
        name: "Новый токен",
        exact: true,
      });
      const generator = tokenEditor.locator(".token-image-generator");
      await expect(
        generator.getByText("Из изображения", { exact: true }),
      ).toBeVisible();
      await capture(
        "token-from-image",
        generator.getByText("Из изображения", { exact: true }),
      );
      const source = generator.getByRole("combobox", {
        name: "Исходное изображение",
        exact: true,
      });
      await expect(source).toHaveValue(ids.image);
      await expect(source.locator("option:checked")).toHaveText(
        "Elminster.png",
      );
      await generator
        .getByRole("button", { name: "Сбросить", exact: true })
        .click();
      const generate = generator.getByRole("button", {
        name: "Создать изображение токена",
        exact: true,
      });
      await capture("token-generate-button", generate);
      await generate.click();
      await expect.poll(() => mock.writes.length).toBe(2);
      expect(mock.writes[1]).toEqual({
        method: "POST",
        path: `/api/assets/${ids.image}/token`,
        actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        body: {
          cropX: 0.5,
          cropY: 0.5,
          zoom: 1,
          frame: "NONE",
          name: "Elminster",
        },
      });
      await expect(
        tokenEditor
          .getByRole("group", { name: "Изображение токена из файлов" })
          .getByRole("button", { name: "Elminster", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      // No token definition, placement, publication or real upload is submitted.
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
      expect(
        mock.blockedWrites.filter((write) => write !== "POST /api/chat/read"),
      ).toEqual([]);
      expect(mock.pageErrors).toEqual([]);
    } finally {
      await attachCopyReceipts(testInfo, mock);
    }
  });
}
