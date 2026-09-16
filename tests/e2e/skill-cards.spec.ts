import { writeFile } from "node:fs/promises";
import { type Page } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import type { GameSnapshot } from "@arken/contracts";
import { openWorkspaceSection } from "./workspace-nav-helper";

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
      paused: false,
      battleActive: false,
      battleCounter: 0,
      statLayout: [],
      initiative: [],
      battleZone: null,
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
        controllerMembershipIds: [],
        portraitAssetId: null,
        lifecycle: "ACTIVE" as const,
        archivedAt: null,
        archivedByMembershipId: null,
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
    tokens: [],
    tokenDefinitions: [],
    fogReveals: [],
    messages: messages as GameSnapshot["messages"],
    characterIdentities: [],
    audioTracks: [],
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
  await openWorkspaceSection(page, "Персонажи");
  await expect(page.locator(".character-action-card")).toBeVisible();
}

for (const width of [1280, 360]) {
  test(`an owner executes an active ability once and its decremented card survives reload at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
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
    await expect(page.locator(".character-action-card__uses")).toHaveText(
      "1/2",
    );

    await page.getByRole("button", { name: "Закрыть персонажей" }).click();
    if (width === 360) await page.locator("#compact-nav-journal").click();
    await page.locator("#chat-tab-activity").click();
    const card = page
      .locator(".skill-chat-card")
      .filter({ hasText: "Arcane Shot" });
    await expect(card).toHaveCount(1);
    expect(
      await card.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await expect(card.locator(".skill-chat-card__uses")).toContainText(
      /2.*1\/2/,
    );
    await expect(card.locator(".skill-chat-card__result > strong")).toHaveText(
      "16",
    );

    await page.reload();
    if (width === 360) await page.locator("#compact-nav-journal").click();
    await page.locator("#chat-tab-activity").click();
    await expect(
      page.locator(".skill-chat-card").filter({ hasText: "Arcane Shot" }),
    ).toHaveCount(1);
    await openWorkspaceSection(page, "Персонажи");
    await expect(page.locator(".character-action-card__uses")).toHaveText(
      "1/2",
    );
  });
}

for (const width of [960, 360]) {
  test(`sharing is passive and a deleted-source card remains keyboard-safe at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
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
    await page
      .locator(".character-action-card__controls button")
      .last()
      .click();
    await expect.poll(() => postCount).toBe(1);
    await expect(page.locator(".character-action-card__uses")).toHaveText(
      "2/2",
    );

    await page.getByRole("button", { name: "Закрыть персонажей" }).click();
    await page.locator("#compact-nav-journal").click();
    await page.locator("#chat-tab-activity").click();
    const card = page
      .locator(".skill-chat-card")
      .filter({ hasText: "Quiet Veil" });
    await expect(card).toHaveCount(1);
    await expect(card.locator(".skill-chat-card__result")).toHaveCount(0);
    await expect(card.locator(".skill-chat-card__uses")).toContainText(
      /2.*2\/2/,
    );
    expect(
      await card.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);

    const details = card.locator("button");
    await details.scrollIntoViewIfNeeded();
    const box = await details.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await details.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(
      card.locator(".skill-chat-card__details .muted"),
    ).toBeVisible();
  });
}

for (const owner of ["edit", "picker", "setup"] as const) {
  for (const width of [1280, 360]) {
    test(`catalog ${owner} conditional dropdown registry ${width}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 800 });
      const current = snapshotFor(entry("Проверочная способность"));
      current.me.role = "GM";
      current.members = current.members.map((member) => ({
        ...member,
        role: "GM",
      }));
      current.campaign.statLayout = [
        {
          id: "characteristics",
          label: "Характеристики",
          rows: [{ key: "strength", label: "Сила", source: "STAT" }],
        },
      ];
      const unexpected: string[] = [];
      const clientLogs: unknown[] = [];
      await page.route("**/api/**", (route) => {
        const request = route.request();
        if (new URL(request.url()).pathname === "/api/client-logs") {
          clientLogs.push(request.postDataJSON());
          return route.fulfill({ json: { ok: true } });
        }
        if (request.method() !== "GET")
          unexpected.push(
            `${request.method()} ${new URL(request.url()).pathname}`,
          );
        return route.fulfill({ json: [] });
      });
      await page.routeWebSocket(/\/socket\.io\//, (socket) => socket.close());
      await mockApp(page, () => current);
      await page.goto("/");
      await openCharacterWorkspace(page);
      if (owner === "edit") {
        await page
          .getByRole("button", { name: "Редактировать", exact: true })
          .click();
      } else if (owner === "picker") {
        await page
          .getByRole("button", { name: "+ Добавить способность…", exact: true })
          .click();
        await page
          .getByRole("button", { name: "+ Создать новую запись", exact: true })
          .click();
      } else {
        await openWorkspaceSection(page, "Подготовка");
        await page
          .getByRole("button", { name: "Общий каталог", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Добавить навык или способность",
            exact: true,
          })
          .click();
      }
      const dialog = page.getByRole("dialog", {
        name:
          owner === "edit"
            ? "Редактирование Проверочная способность"
            : "Новая запись каталога",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const form = dialog.getByRole("form", {
        name:
          owner === "edit"
            ? "Редактирование записи каталога"
            : "Новая запись каталога",
      });
      if (owner !== "edit") {
        await form
          .getByRole("checkbox", {
            name: "Ограничить количество использований",
          })
          .check();
        await form
          .getByRole("button", { name: "Добавить бросок", exact: true })
          .click();
      }
      const description = form.getByRole("textbox", {
        name: "Описание",
        exact: true,
      });
      await description.scrollIntoViewIfNeeded();
      const initialText = await description.inputValue();
      const initialHeight = (await description.boundingBox())!.height;
      expect(initialHeight).toBeGreaterThanOrEqual(28);
      await description.fill(
        Array.from({ length: 12 }, (_, i) => `Строка описания ${i + 1}`).join(
          "\n",
        ),
      );
      await expect
        .poll(async () => (await description.boundingBox())!.height)
        .toBeGreaterThan(initialHeight + 100);
      await description.fill(initialText);
      await expect
        .poll(async () => (await description.boundingBox())!.height)
        .toBeLessThanOrEqual(initialHeight + 2);
      async function choose(
        trigger: import("@playwright/test").Locator,
        text: string,
      ) {
        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
        const list = page.getByRole("listbox");
        await expect(list).toBeVisible();
        const option = list.getByRole("option", { name: text, exact: true });
        await option.scrollIntoViewIfNeeded();
        expect(
          await option.evaluate((node) => {
            const r = node.getBoundingClientRect();
            return node.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
        ).toBe(true);
        await option.click();
        await expect(list).toBeHidden();
        await expect(trigger).toContainText(text);
        await trigger.click();
        await expect(list).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(list).toBeHidden();
        await expect(trigger).toBeFocused();
        await expect(dialog).toBeVisible();
      }
      await choose(
        form.getByRole("combobox", { name: "Тип", exact: true }).first(),
        "Навык",
      );
      await choose(
        form.getByRole("combobox", { name: "Перезарядка", exact: true }),
        "В неделю",
      );
      const action = form.getByRole("group", { name: "Бросок 1", exact: true });
      await choose(
        action.getByRole("combobox", { name: "Тип", exact: true }),
        "Урон",
      );
      const source = action.getByRole("combobox", {
        name: "Источник модификатора",
        exact: true,
      });
      await choose(source, "Характеристика");
      await choose(
        action.getByRole("combobox", { name: "Характеристика", exact: true }),
        "Сила",
      );
      await form
        .getByRole("button", { name: "Добавить значение", exact: true })
        .click();
      await form
        .getByRole("textbox", { name: "Ключ", exact: true })
        .fill("power");
      await choose(source, "Значение записи");
      await choose(
        action.getByRole("combobox", { name: "Ключ значения", exact: true }),
        "power",
      );
      const resource = action.getByRole("combobox", {
        name: "Ресурс",
        exact: true,
      });
      await resource.scrollIntoViewIfNeeded();
      await resource.click();
      const resourceLabel = (
        await page.getByRole("listbox").getByRole("option").nth(1).innerText()
      ).trim();
      await page.keyboard.press("Escape");
      await choose(resource, resourceLabel);
      await form.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(dialog).toBeHidden();
      if (owner === "edit")
        await expect(page.locator(".character-action-card")).toContainText(
          "Проверочная способность",
        );
      const receipt = testInfo.outputPath("catalog-receipts.json");
      await writeFile(
        receipt,
        JSON.stringify({ owner, width, clientLogs, unexpected }, null, 2),
      );
      await testInfo.attach("catalog-receipts", {
        path: receipt,
        contentType: "application/json",
      });
      // Preserve diagnostics and fail the runtime gate; never suppress observer errors.
      expect(clientLogs).toEqual([]);
      expect(unexpected).toEqual([]);
    });
  }
}
