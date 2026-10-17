import { mockAuthenticatedGameCapabilities } from "./mocked-game-capabilities";
import type { CharacterDto, GameSnapshot, StatLayout } from "@arken/contracts";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { fulfillUnmocked } from "./mock-api-contract";

const characterId = "68200000-0000-4000-8000-000000000001";
const baseLayout: StatLayout = [
  {
    id: "characteristics",
    label: "Характеристики",
    rows: [
      { key: "strength", label: "Сила", source: "STAT" },
      { key: "agility", label: "Ловкость", source: "STAT" },
    ],
  },
];

function snapshotFor(role: "GM" | "PLAYER", ownerMembershipId?: string) {
  const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
  const character: CharacterDto = {
    id: characterId,
    name: "Хранитель UIX682",
    ownerMembershipId: ownerMembershipId ?? snapshot.me.id,
    controllerMembershipIds: [],
    portraitAssetId: null,
    stats: { strength: 3, agility: 2 },
    statLayout: structuredClone(baseLayout),
    skills: [],
    spells: [],
    entries: [],
    notes: "",
    backstory: "",
    inventory: [],
    resources: {
      physicalPower: { current: 8, maximum: 10 },
      magicPower: { current: 3, maximum: 5 },
      stamina: { current: 2, maximum: 4, description: "Запас сил" },
    },
    wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
    revision: 1,
    lifecycle: "ACTIVE",
    archivedAt: null,
    archivedByMembershipId: null,
  };
  snapshot.characters = [character];
  if (role === "PLAYER") {
    snapshot.me.characterId = character.id;
    snapshot.members = snapshot.members.map((member) =>
      member.id === snapshot.me.id
        ? { ...member, characterId: character.id }
        : member,
    );
  }
  return snapshot;
}

function seedAbilityResult(snapshot: GameSnapshot) {
  const threadId = "68200000-0000-4000-8000-000000000002";
  snapshot.chatThreads = [
    {
      id: threadId,
      campaignId: snapshot.campaign.id,
      type: "STREAM",
      stream: "ROLLS",
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    },
  ];
  snapshot.chatThreadStates = [
    {
      threadId,
      stream: "ROLLS",
      lastReadSequence: 0,
      latestSequence: 1,
      unreadCount: 1,
    },
  ];
  snapshot.messages = [
    {
      id: "68200000-0000-4000-8000-000000000003",
      sequence: 1,
      membershipId: snapshot.me.id,
      displayName: snapshot.me.displayName,
      characterId,
      body: "Огненная стрела",
      visibility: "PUBLIC",
      kind: "DICE",
      threadId,
      stream: "ROLLS",
      dice: null,
      skillCard: {
        version: 1,
        execution: "EXECUTED",
        entry: {
          id: "68200000-0000-4000-8000-000000000004",
          revision: 1,
          sourceCatalogEntryId: null,
          sourceRemoved: false,
          kind: "ABILITY",
          name: "Огненная стрела",
          description: "Проверка результата",
          notes: null,
        },
        actor: {
          membershipId: snapshot.me.id,
          displayName: snapshot.me.displayName,
          characterId,
          characterName: "Хранитель UIX682",
        },
        action: {
          id: "strike",
          kind: "HIT",
          label: "Удар",
          dice: "1d20",
          advantage: false,
          consumeUse: false,
        },
        formula: "1d20 + 2",
        result: {
          formula: "1d20 + 2",
          resolvedFormula: "1d20(14) + 2",
          terms: [{ notation: "1d20", rolls: [14], subtotal: 14 }],
          modifiers: [{ source: "constant", value: 2 }],
          total: 16,
          label: "Удар",
        },
        uses: null,
        visibility: "PUBLIC",
      },
      createdAt: "2026-10-11T00:00:00.000Z",
    } as GameSnapshot["messages"][number],
  ];
  snapshot.snapshotVersion += 1;
}

async function mockApi(
  page: Page,
  snapshot: GameSnapshot,
  onLayoutWrite: (path: string, body: Record<string, unknown>) => void,
  foreignPlayer = false,
) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "PATCH" && path.endsWith("/stat-layout")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      onLayoutWrite(path, body);
      if (foreignPlayer)
        return route.fulfill({
          status: 403,
          json: { error: "CHARACTER_FORBIDDEN" },
        });
      if (path === `/api/characters/${characterId}/stat-layout`) {
        const current = snapshot.characters.find(
          (item) => item.id === characterId,
        )!;
        current.statLayout = body.layout as StatLayout;
        current.revision = Number(body.revision) + 1;
        return route.fulfill({
          json: { characterId, revision: current.revision },
        });
      }
      if (path === "/api/campaign/stat-layout") {
        snapshot.campaign.statLayout = body.layout as StatLayout;
        snapshot.campaign.revision = Number(body.revision) + 1;
        snapshot.characters[0]!.statLayout = structuredClone(
          snapshot.campaign.statLayout,
        );
        return route.fulfill({
          json: { revision: snapshot.campaign.revision },
        });
      }
    }
    if (request.method() === "GET" && path === "/api/bootstrap")
      return route.fulfill({ json: snapshot });
    if (request.method() === "GET" && path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (request.method() === "GET" && path === "/api/chat/read")
      return route.fulfill({ json: { ok: true } });
    if (request.method() === "GET" && path === "/api/soundpad")
      return route.fulfill({
        json: { packs: [], playerPlaybackEnabled: true },
      });
    if (
      request.method() === "GET" &&
      path === "/api/operator/feedback/capability"
    )
      return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
    if (route.request().method() === "GET") return fulfillUnmocked(route, path);
    return route.fulfill({ status: 405, json: { error: "UNEXPECTED_WRITE" } });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") socket.send('40{"sid":"uix682"}');
    });
    socket.send(
      '0{"sid":"uix682","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
}

test("UIX-682 PLAYER owner layout CRUD/order survives reload; compact sheet is accessible at desktop and narrow widths", async ({
  page,
}, info) => {
  const snapshot = snapshotFor("PLAYER");
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApi(page, snapshot, (path, body) => writes.push({ path, body }));

  await page.setViewportSize({ width: 1280, height: 900 });
  await mockAuthenticatedGameCapabilities(page);
  await page.goto("/");
  await openWorkspaceSection(page, "Персонажи");
  const sheet = page.getByRole("article", {
    name: "Лист персонажа Хранитель UIX682",
    exact: true,
  });
  await expect(sheet).toBeVisible();
  const workspace = page.locator(
    ".character-workspace.is-single-player-character",
  );
  await expect(workspace).toBeVisible();
  await expect(
    workspace.locator(".character-workspace__body.is-single-character"),
  ).toBeVisible();

  // C02: portrait action affordance is visible by keyboard focus, not hover alone.
  const portrait = sheet.getByRole("button", {
    name: "Изменить портрет: Хранитель UIX682",
  });
  await portrait.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(portrait).toBeFocused();
  await expect(portrait.locator(".character-hero__avatar-edit")).toHaveCSS(
    "opacity",
    "1",
  );

  // C03 owner delta (11.10): wide cards put both sections on a row below
  // characteristics; narrow cards stack them. Do not restore the old layout.
  const skills = sheet.getByRole("heading", { name: "Навыки", exact: true });
  const abilities = sheet.getByRole("heading", {
    name: "Способности и заклинания",
    exact: true,
  });
  await expect(skills).toBeVisible();
  await expect(abilities).toBeVisible();
  const skillsCard = sheet.locator(".character-card--skills");
  const abilitiesCard = sheet.locator(".character-card--abilities");
  const wideSkills = (await skillsCard.boundingBox())!;
  const wideAbilities = (await abilitiesCard.boundingBox())!;
  expect(wideAbilities.y).toBeCloseTo(wideSkills.y, 0);
  expect(wideAbilities.x).toBeGreaterThanOrEqual(
    wideSkills.x + wideSkills.width,
  );
  const characteristics = (await sheet
    .locator(".character-card--stats")
    .boundingBox())!;
  expect(wideSkills.y).toBeGreaterThanOrEqual(
    characteristics.y + characteristics.height,
  );

  // C11: resource card remains a full-width, styled control on its accessible tab.
  await sheet.getByRole("tab", { name: "Инвентарь и ресурсы" }).click();
  const resourceCard = sheet.locator(
    ".character-section--resources .resource-card",
  );
  await expect(resourceCard).toBeVisible();
  const resourceWidths = await resourceCard.evaluate((node) => ({
    card: node.getBoundingClientRect().width,
    parent: node.parentElement!.getBoundingClientRect().width,
    background: getComputedStyle(node).backgroundColor,
  }));
  expect(resourceWidths.card).toBeGreaterThan(resourceWidths.parent * 0.8);
  expect(resourceWidths.background).not.toBe("rgba(0, 0, 0, 0)");

  await sheet.getByRole("tab", { name: "Показатели" }).click();

  // C14: the player sees no campaign initiative when there is no active encounter.
  await expect(page.locator(".activity-initiative-panel")).toHaveCount(0);

  // C01: owner can create, reorder, rename, and delete a character-local row.
  const statsCard = sheet.locator(".character-card--stats");
  const openRowMenu = async (row: Locator) => {
    const menu = row.locator(".stat-field__menu");
    if ((await menu.getAttribute("open")) === null)
      await menu.locator("summary").click();
    await expect(menu).toHaveAttribute("open", "");
  };
  await statsCard.getByRole("button", { name: "Добавить строку" }).click();
  let dialog = page.getByRole("dialog", {
    name: "Новая строка — Характеристики",
  });
  await dialog.getByRole("textbox", { name: "Название" }).fill("Смекалка");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.path).toBe(`/api/characters/${characterId}/stat-layout`);
  expect(writes[0]!.body.revision).toBe(1);
  const createdLayout = writes[0]!.body.layout as StatLayout;
  expect(createdLayout[0]!.rows.map((row) => row.label)).toEqual([
    "Сила",
    "Ловкость",
    "Смекалка",
  ]);
  expect(writes[0]!.body.actionId).toMatch(/^[0-9a-f-]{36}$/i);

  const newRow = statsCard
    .locator(".stat-field")
    .filter({ hasText: "Смекалка" });
  await openRowMenu(newRow);
  await newRow
    .getByRole("button", { name: "Переместить «Смекалка» выше" })
    .click();
  await expect.poll(() => writes.length).toBe(2);
  await expect(statsCard.locator(".stat-field__roll-name").nth(1)).toHaveText(
    "Смекалка",
  );

  await openRowMenu(newRow);
  await newRow
    .getByRole("button", { name: "Переименовать «Смекалка»" })
    .click();
  dialog = page.getByRole("dialog", { name: "Переименовать строку" });
  await dialog
    .getByRole("textbox", { name: "Название" })
    .fill("Смекалка героя");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => writes.length).toBe(3);
  await expect(
    statsCard.getByRole("button", { name: "Смекалка героя", exact: true }),
  ).toBeVisible();

  const renamedRow = statsCard
    .locator(".stat-field")
    .filter({ hasText: "Смекалка героя" });
  await openRowMenu(renamedRow);
  await renamedRow
    .getByRole("button", { name: "Удалить «Смекалка героя»" })
    .click();
  dialog = page.getByRole("dialog", { name: "Удалить «Смекалка героя»?" });
  await dialog.getByRole("button", { name: "Удалить" }).click();
  await expect.poll(() => writes.length).toBe(4);
  await expect(
    statsCard.getByRole("button", { name: "Смекалка героя", exact: true }),
  ).toHaveCount(0);

  await page.screenshot({ path: info.outputPath("uix682-player-desktop.png") });
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
  const narrowSkills = (await skillsCard.boundingBox())!;
  const narrowAbilities = (await abilitiesCard.boundingBox())!;
  expect(narrowAbilities.y).toBeGreaterThanOrEqual(
    narrowSkills.y + narrowSkills.height,
  );
  await page.screenshot({ path: info.outputPath("uix682-player-narrow.png") });

  const savedLayout = structuredClone(snapshot.characters[0]!.statLayout);
  await page.reload();
  await openWorkspaceSection(page, "Персонажи");
  await expect(
    page.locator(".character-card--stats .stat-field__roll-name"),
  ).toHaveText(savedLayout[0]!.rows.map((row) => row.label));
});

test("UIX-682 GM keeps campaign layout controls; non-owner PLAYER receives no layout edit affordance", async ({
  browser,
}, info) => {
  const gmPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const gmSnapshot = snapshotFor("GM");
  const gmWrites: string[] = [];
  await mockApi(gmPage, gmSnapshot, (path) => gmWrites.push(path));
  await gmPage.goto("/");
  await openWorkspaceSection(gmPage, "Персонажи");
  const gmSheet = gmPage.getByRole("article", {
    name: "Лист персонажа Хранитель UIX682",
    exact: true,
  });
  await expect(
    gmSheet
      .locator(".character-card--stats")
      .getByRole("button", { name: "Добавить строку" }),
  ).toBeVisible();
  await expect(gmPage.locator(".activity-initiative-panel")).toBeVisible();
  await gmPage.screenshot({ path: info.outputPath("uix682-gm-desktop.png") });
  await gmPage.close();

  const playerPage = await browser.newPage({
    viewport: { width: 360, height: 640 },
  });
  const foreignSnapshot = snapshotFor("PLAYER", "another-membership");
  const deniedWrites: string[] = [];
  await mockApi(
    playerPage,
    foreignSnapshot,
    (path) => deniedWrites.push(path),
    true,
  );
  await playerPage.goto("/");
  await openWorkspaceSection(playerPage, "Персонажи");
  const foreignSheet = playerPage.getByRole("article", {
    name: "Лист персонажа Хранитель UIX682",
    exact: true,
  });
  await expect(
    foreignSheet
      .locator(".character-card--stats")
      .getByRole("button", { name: "Добавить строку" }),
  ).toHaveCount(0);
  await expect(playerPage.locator(".activity-initiative-panel")).toHaveCount(0);
  await playerPage.screenshot({
    path: info.outputPath("uix682-player-foreign-narrow.png"),
  });
  expect(deniedWrites).toEqual([]);
  expect(gmWrites).toEqual([]);
  await playerPage.close();
});

test("UIX-682 ability roll result is centered in the card at desktop and narrow widths", async ({
  page,
}, info) => {
  const snapshot = snapshotFor("PLAYER");
  seedAbilityResult(snapshot);
  await mockApi(page, snapshot, () => {});
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    if (page.url() === "about:blank") await page.goto("/");
    const journal = page.locator("#compact-nav-journal");
    if (await journal.isVisible()) await journal.click();
    const card = page
      .locator(".skill-chat-card")
      .filter({ hasText: "Огненная стрела" });
    await expect(card).toBeVisible();
    const center = await card
      .locator(".skill-chat-card__result .roll-total-wrap")
      .evaluate((node) => {
        const total = node.getBoundingClientRect();
        const parent = node
          .closest(".skill-chat-card__result")!
          .getBoundingClientRect();
        return Math.abs(
          total.left + total.width / 2 - (parent.left + parent.width / 2),
        );
      });
    expect(center).toBeLessThanOrEqual(1);
    await expect(card.getByLabel("Итог броска")).toHaveText("16");
    await page.screenshot({
      path: info.outputPath(`uix682-roll-result-${viewport.width}.png`),
    });
  }
});
