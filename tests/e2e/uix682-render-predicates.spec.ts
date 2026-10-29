import type { Page } from "@playwright/test";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { mockAuthenticatedGameCapabilities } from "./mocked-game-capabilities";
import { fulfillUnmocked } from "./mock-api-contract";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

/**
 * UIX-682 C05, C06, C07, C19: render predicates that were only checked in
 * source. Each assertion measures the rendered geometry the owner described
 * and fails if the rule behind it is removed.
 */
const characterId = "68250000-0000-4000-8000-000000000001";
const threadId = "68250000-0000-4000-8000-000000000002";
const widths = [1280, 360] as const;

function playerSnapshot(): GameSnapshot {
  const snapshot = buildGameSnapshot("PLAYER", { schemaVersion: 2 });
  snapshot.campaign.statLayout = [
    ...snapshot.campaign.statLayout.filter((group) => group.id !== "skills"),
    {
      id: "skills",
      label: "Навыки",
      rows: [{ key: "strength", label: "Скрытность", source: "STAT" }],
    },
  ];
  const character: CharacterDto = {
    id: characterId,
    name: "Хранитель UIX682",
    ownerMembershipId: snapshot.me.id,
    controllerMembershipIds: [],
    portraitAssetId: null,
    stats: { strength: 0 },
    statLayout: structuredClone(snapshot.campaign.statLayout),
    skills: [
      { key: "lore", name: "Знание преданий", rank: 1, formula: "1d20" },
    ],
    spells: [],
    entries: [],
    notes: "",
    backstory: "",
    inventory: [],
    resources: {},
    wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
    revision: 1,
    lifecycle: "ACTIVE",
    archivedAt: null,
    archivedByMembershipId: null,
  };
  snapshot.characters = [character];
  snapshot.me.characterId = characterId;
  snapshot.members = snapshot.members.map((member) =>
    member.id === snapshot.me.id ? { ...member, characterId } : member,
  );
  // C05: a characteristic roll with a zero bonus — the formula is the only
  // item on its math row.
  snapshot.chatThreads = [
    {
      id: threadId,
      campaignId: snapshot.campaign.id,
      type: "STREAM",
      stream: "ROLLS",
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    },
  ];
  snapshot.chatThreadStates = [
    {
      threadId,
      stream: "ROLLS",
      lastReadSequence: 1,
      latestSequence: 1,
      unreadCount: 0,
    },
  ];
  snapshot.messages = [
    {
      id: "68250000-0000-4000-8000-000000000003",
      sequence: 1,
      membershipId: snapshot.me.id,
      displayName: snapshot.me.displayName,
      characterId,
      body: "Сила",
      visibility: "PUBLIC",
      kind: "DICE",
      threadId,
      stream: "ROLLS",
      dice: {
        formula: "1d20",
        resolvedFormula: "1d20",
        terms: [{ notation: "1d20", rolls: [12], subtotal: 12 }],
        modifiers: [],
        total: 12,
      } as GameSnapshot["messages"][number]["dice"],
      createdAt: "2026-10-17T00:00:00.000Z",
    },
  ];
  return snapshot;
}

async function openApp(page: Page, snapshot: GameSnapshot, width: number) {
  const writes: string[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/chat/read") return route.fulfill({ json: { ok: true } });
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 405, json: { error: "READ_ONLY" } });
    }
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
    return fulfillUnmocked(route, path);
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => socket.close());
  await page.setViewportSize({ width, height: 900 });
  await mockAuthenticatedGameCapabilities(page);
  await page.goto("/");
  return writes;
}

for (const width of widths) {
  test(`UIX-682 C05 and C19 render in the player activity at ${width}px`, async ({
    page,
  }, info) => {
    const writes = await openApp(page, playerSnapshot(), width);
    if (width < 768)
      await page.getByRole("button", { name: "Журнал", exact: true }).click();

    // C05: the lone formula sits on the left of its math row.
    const math = page.locator(".roll-details__math").first();
    await expect(math).toBeVisible();
    const formula = await math.evaluate((row) => {
      const small = row.querySelector("small")!;
      const style = getComputedStyle(row);
      const box = row.getBoundingClientRect();
      return {
        rowLeft: box.left + Number.parseFloat(style.paddingLeft),
        rowRight: box.right - Number.parseFloat(style.paddingRight),
        left: small.getBoundingClientRect().left,
        right: small.getBoundingClientRect().right,
        text: small.textContent?.trim(),
      };
    });
    expect(formula.text).toBe("1d20");
    expect(formula.left - formula.rowLeft).toBeLessThan(4);
    expect(formula.rowRight - formula.right).toBeGreaterThan(8);

    // C19: the skill rows and the character's skills are separate groups
    // with visible space between them.
    const panel = page.locator(".quick-roll-panel");
    await panel.getByRole("tab", { name: "Статы", exact: true }).click();
    const statsPanel = panel.getByRole("tabpanel", {
      name: "Статы",
    });
    await expect(
      statsPanel.getByRole("button", { name: /^Скрытность\s*0$/ }),
    ).toBeVisible();
    await expect(
      statsPanel.getByRole("button", { name: /^Знание преданий\s*1$/ }),
    ).toBeVisible();
    const gap = await statsPanel.evaluate((node) => {
      const groups = [...node.querySelectorAll(".activity-quick-rolls")];
      return groups.length === 2
        ? groups[1]!.getBoundingClientRect().top -
            groups[0]!.getBoundingClientRect().bottom
        : null;
    });
    expect(gap).not.toBeNull();
    expect(gap!).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: info.outputPath(`activity-${width}.png`) });
    expect(writes).toEqual([]);
  });

  test(`UIX-682 C06 and C07 render in the catalog entry form at ${width}px`, async ({
    page,
  }, info) => {
    const writes = await openApp(
      page,
      buildGameSnapshot("GM", { schemaVersion: 2 }),
      width,
    );
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
    const form = page.getByRole("form", { name: "Новая запись каталога" });
    await expect(form).toBeVisible();
    await form
      .getByRole("button", { name: "Дополнительные настройки", exact: true })
      .click();

    // C06: the checkbox and its text share one line.
    const toggle = form
      .locator("label.arken-checkbox")
      .filter({ hasText: "Ограничить количество использований" });
    await toggle.scrollIntoViewIfNeeded();
    const line = await toggle.evaluate((label) => {
      const box = label.querySelector("input")!.getBoundingClientRect();
      const range = document.createRange();
      const textNode = [...label.querySelectorAll("*"), label]
        .flatMap((node) => [...node.childNodes])
        .find(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            node.textContent!.includes("Ограничить"),
        )!;
      range.selectNodeContents(textNode);
      const text = range.getBoundingClientRect();
      return {
        boxCenter: box.top + box.height / 2,
        textCenter: text.top + text.height / 2,
        boxRight: box.right,
        textLeft: text.left,
      };
    });
    expect(Math.abs(line.boxCenter - line.textCenter)).toBeLessThan(6);
    expect(line.textLeft).toBeGreaterThan(line.boxRight);

    // C07: the roll fieldset keeps its content off the edges.
    const kind = form.getByRole("combobox", { name: "Тип записи" });
    await kind.click();
    await page
      .getByRole("option", { name: "Способность / заклинание", exact: true })
      .click();
    const rolls = form.locator("fieldset", {
      has: page.locator("legend", { hasText: /^Броски$/ }),
    });
    await rolls.scrollIntoViewIfNeeded();
    const padding = await rolls.evaluate((node) => {
      const style = getComputedStyle(node);
      return [
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
      ].map((value) => Number.parseFloat(value));
    });
    for (const side of padding) expect(side).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: info.outputPath(`catalog-${width}.png`) });
    expect(writes).toEqual([]);
  });
}
