import { expect, test, type Page } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";

const ids = {
  campaign: "11111111-1111-4111-8111-111111111111",
  membership: "22222222-2222-4222-8222-222222222222",
  character: "33333333-3333-4333-8333-333333333333",
  entry: "44444444-4444-4444-8444-444444444444",
  tableThread: "55555555-5555-4555-8555-555555555555",
  storyThread: "66666666-6666-4666-8666-666666666666",
  rollsThread: "77777777-7777-4777-8777-777777777777",
};

const stats = {
  strength: 1,
  agility: 2,
  endurance: 1,
  vitality: 1,
  knowledge: 1,
  intelligence: 1,
  willpower: 1,
  charisma: 1,
};

function entry(
  name: string,
  uses = 2,
  sourceCatalogEntryId: string | null = null,
) {
  return {
    id: ids.entry,
    sourceCatalogEntryId,
    kind: "ABILITY" as const,
    name,
    description: `${name} description`,
    revision: 3,
    data: {
      rollActions: [
        {
          id: "strike",
          kind: "HIT" as const,
          label: "Strike",
          dice: "1d20",
          modifiers: [{ type: "CONSTANT" as const, value: 2 }],
          order: 0,
          advantage: false,
          consumeUse: true,
        },
      ],
      uses: { current: uses, max: 2, recharge: "DAY" as const },
    },
  };
}

function snapshotFor(
  characterEntry: ReturnType<typeof entry>,
  messages: unknown[] = [],
): GameSnapshot {
  return {
    campaign: {
      id: ids.campaign,
      name: "Skill cards",
      day: 1,
      battleActive: false,
      battleCounter: 0,
      revision: 0,
    },
    me: {
      id: ids.membership,
      role: "PLAYER",
      displayName: "Owner",
      characterId: ids.character,
    },
    members: [
      {
        id: ids.membership,
        role: "PLAYER",
        displayName: "Owner",
        characterId: ids.character,
      },
    ],
    characters: [
      {
        id: ids.character,
        name: "Aster",
        ownerMembershipId: ids.membership,
        portraitAssetId: null,
        stats,
        skills: [],
        spells: [],
        notes: "",
        backstory: "",
        inventory: [],
        resources: {},
        wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
        entries: [characterEntry],
        revision: 1,
      },
    ],
    catalogEntries: [],
    scenes: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        name: "Scene",
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
    tokens: [],
    tokenDefinitions: [],
    fogReveals: [],
    messages: messages as GameSnapshot["messages"],
    chatThreads: [
      {
        id: ids.tableThread,
        campaignId: ids.campaign,
        type: "STREAM",
        stream: "TABLE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: ids.storyThread,
        campaignId: ids.campaign,
        type: "STREAM",
        stream: "STORY",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: ids.rollsThread,
        campaignId: ids.campaign,
        type: "STREAM",
        stream: "ROLLS",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    chatThreadStates: [
      {
        threadId: ids.tableThread,
        stream: "TABLE",
        lastReadSequence: 0,
        latestSequence: 0,
        unreadCount: 0,
      },
      {
        threadId: ids.storyThread,
        stream: "STORY",
        lastReadSequence: 0,
        latestSequence: 0,
        unreadCount: 0,
      },
      {
        threadId: ids.rollsThread,
        stream: "ROLLS",
        lastReadSequence: 0,
        latestSequence: messages.length,
        unreadCount: 0,
      },
    ],
    assets: [],
    audio: {
      assetId: null,
      playing: false,
      positionSeconds: 0,
      loop: false,
      startedAt: null,
      revision: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    snapshotVersion: messages.length,
    schemaVersion: 2,
    buildVersion: "test",
    buildRevision: "test",
    serverTime: "2026-01-01T00:00:00.000Z",
  };
}

function skillMessage(
  name: string,
  execution: "EXECUTED" | "SHARED",
  sourceCatalogEntryId: string | null,
  sequence: number,
) {
  const executed = execution === "EXECUTED";
  return {
    id: `message-${sequence}`,
    sequence,
    membershipId: ids.membership,
    displayName: "Owner",
    characterId: ids.character,
    body: name,
    visibility: "PUBLIC" as const,
    kind: "DICE" as const,
    threadId: ids.rollsThread,
    stream: "ROLLS" as const,
    dice: null,
    skillCard: {
      version: 1,
      execution,
      entry: {
        id: ids.entry,
        revision: 3,
        sourceCatalogEntryId,
        sourceRemoved: sourceCatalogEntryId !== null,
        kind: "ABILITY",
        name,
        description: `${name} description`,
        notes: null,
      },
      actor: {
        membershipId: ids.membership,
        displayName: "Owner",
        characterId: ids.character,
        characterName: "Aster",
      },
      action: executed
        ? {
            id: "strike",
            kind: "HIT",
            label: "Strike",
            dice: "1d20",
            advantage: false,
            consumeUse: true,
          }
        : null,
      formula: executed ? "1d20 + 2" : null,
      result: executed
        ? {
            formula: "1d20 + 2",
            resolvedFormula: "1d20(14) + 2",
            terms: [{ notation: "1d20", rolls: [14], subtotal: 14 }],
            modifiers: [{ source: "constant", value: 2 }],
            total: 16,
            label: "Strike",
          }
        : null,
      uses: { before: 2, after: executed ? 1 : 2, max: 2, recharge: "DAY" },
      visibility: "PUBLIC",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

async function mockApp(page: Page, getSnapshot: () => GameSnapshot) {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getSnapshot()),
    }),
  );
  await page.route("**/api/player-access", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/chat/read", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        campaignId: ids.campaign,
        threadId: ids.rollsThread,
        lastReadSequence: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    }),
  );
}

async function openCharacterWorkspace(page: Page) {
  await page.locator(".workspace-menu summary").click();
  await page.locator(".workspace-menu__content > button").first().click();
  await expect(page.locator(".character-action-card")).toBeVisible();
}

test("an owner executes an active ability once and its decremented card survives reload", async ({
  page,
}) => {
  let current = snapshotFor(entry("Arcane Shot"));
  let postCount = 0;
  await mockApp(page, () => current);
  await page.route(
    `**/api/characters/${ids.character}/catalog/${ids.entry}/roll`,
    async (route) => {
      postCount += 1;
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toMatchObject({
        entryRevision: 3,
        rollActionId: "strike",
        visibility: "PUBLIC",
      });
      expect(route.request().postDataJSON().mode).toBeUndefined();
      current = snapshotFor(entry("Arcane Shot", 1), [
        skillMessage("Arcane Shot", "EXECUTED", null, 1),
      ]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    },
  );

  await page.goto("/");
  await openCharacterWorkspace(page);
  await page.locator(".character-action-card__action button").click();
  await expect.poll(() => postCount).toBe(1);
  await expect(page.locator(".character-action-card__uses")).toHaveText("1/2");

  await page.locator(".character-workspace__header > button").click();
  await page.locator("#chat-tab-rolls").click();
  const card = page
    .locator(".skill-chat-card")
    .filter({ hasText: "Arcane Shot" });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".skill-chat-card__uses")).toContainText(/2.*1\/2/);
  await expect(card.locator(".skill-chat-card__result > strong")).toHaveText(
    "16",
  );

  await page.reload();
  await page.locator("#chat-tab-rolls").click();
  await expect(
    page.locator(".skill-chat-card").filter({ hasText: "Arcane Shot" }),
  ).toHaveCount(1);
  await page.locator(".workspace-menu summary").click();
  await page.locator(".workspace-menu__content > button").first().click();
  await expect(page.locator(".character-action-card__uses")).toHaveText("1/2");
});

test("sharing is passive and a deleted-source card remains keyboard-safe at 960px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 900 });
  let current = snapshotFor(entry("Quiet Veil", 2, "deleted-catalog-entry"));
  let postCount = 0;
  await mockApp(page, () => current);
  await page.route(
    `**/api/characters/${ids.character}/catalog/${ids.entry}/roll`,
    async (route) => {
      postCount += 1;
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        mode: "SHARE",
        entryRevision: 3,
        visibility: "PUBLIC",
      });
      expect(body.rollActionId).toBeUndefined();
      current = snapshotFor(entry("Quiet Veil", 2, "deleted-catalog-entry"), [
        skillMessage("Quiet Veil", "SHARED", "deleted-catalog-entry", 1),
      ]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    },
  );

  await page.goto("/");
  await openCharacterWorkspace(page);
  await page.locator(".character-action-card__controls button").last().click();
  await expect.poll(() => postCount).toBe(1);
  await expect(page.locator(".character-action-card__uses")).toHaveText("2/2");

  await page.locator(".character-workspace__header > button").click();
  await page.locator("#chat-tab-rolls").click();
  const card = page
    .locator(".skill-chat-card")
    .filter({ hasText: "Quiet Veil" });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".skill-chat-card__result")).toHaveCount(0);
  await expect(card.locator(".skill-chat-card__uses")).toContainText(/2.*2\/2/);
  expect(
    await card.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  const details = card.locator("button");
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator(".skill-chat-card__details .muted")).toBeVisible();
});
