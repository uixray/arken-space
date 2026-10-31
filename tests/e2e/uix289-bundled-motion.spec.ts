import type {
  ChatMessageDto,
  ChatReadCursorDto,
  DiceResult,
  GameSnapshot,
  SkillCardSnapshot,
} from "@arken/contracts";
import type { Page } from "@playwright/test";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { expect, test } from "./react-console-guard";
import { fulfillUnmocked } from "./mock-api-contract";
import { installMockedChatTransport } from "./mocked-chat-app";

const STYLE_FRAME_ID = "11111111-2222-4333-8444-555555555555";
const FRAME_PREFIX = "/assets/frames/";

type CriticalKind = "success" | "failure";

function criticalMessage(
  id: string,
  sequence: number,
  kind: CriticalKind,
  skill = false,
): ChatMessageDto {
  const natural = kind === "success" ? 20 : 1;
  const dice: DiceResult = {
    formula: "1d20+5",
    resolvedFormula: "1d20+5",
    terms: [{ notation: "1d20", rolls: [natural], subtotal: natural }],
    modifiers: [{ source: "5", value: 5 }],
    total: natural + 5,
    semanticOutcome: {
      kind: kind === "success" ? "CRITICAL_SUCCESS" : "CRITICAL_FAILURE",
      keptNaturalD20: natural,
    },
  };
  const skillCard: SkillCardSnapshot | undefined = skill
    ? {
        version: 1,
        execution: "EXECUTED",
        entry: {
          id: "skill-1",
          revision: 1,
          sourceCatalogEntryId: null,
          kind: "SKILL",
          name: "Test skill",
          description: "",
          notes: null,
        },
        actor: {
          membershipId: "member-under-test",
          displayName: "Test participant",
          characterId: "character-under-test",
          characterName: "Test actor",
        },
        action: {
          id: "action-1",
          kind: "CUSTOM",
          label: "Test action",
          dice: "1d20+5",
          advantage: false,
          consumeUse: false,
        },
        formula: "1d20+5",
        result: dice,
        uses: null,
        visibility: "PUBLIC",
      }
    : undefined;
  const message: ChatMessageDto = {
    id,
    sequence,
    membershipId: "member-under-test",
    displayName: "Test participant",
    characterId: null,
    body: skill ? "Test skill action" : "Test roll",
    visibility: "PUBLIC",
    kind: "DICE",
    threadId: "thread-under-test",
    stream: "ROLLS",
    dice,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
  };
  if (skillCard) message.skillCard = skillCard;
  return message;
}

function textMessage(
  id: string,
  sequence: number,
  body = "Newest ordinary message",
): ChatMessageDto {
  return {
    id,
    sequence,
    membershipId: "member-under-test",
    displayName: "Test participant",
    characterId: null,
    body,
    visibility: "PUBLIC",
    kind: "TEXT",
    threadId: "thread-under-test",
    stream: "TABLE",
    dice: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
  };
}

function snapshotWith(
  messages: GameSnapshot["messages"],
  snapshotVersion = messages.length,
) {
  return buildGameSnapshot("GM", {
    schemaVersion: 2,
    snapshotVersion,
    messages,
  });
}

async function installStrictAppFixture(
  page: Page,
  getSnapshot: () => GameSnapshot,
  requests: string[],
  unexpectedWrites: string[],
  styleRequests: string[],
) {
  let emitSnapshot: ((snapshot: GameSnapshot) => void) | null = null;
  let resolveSocketReady!: () => void;
  const socketReady = new Promise<void>((resolve) => {
    resolveSocketReady = resolve;
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(FRAME_PREFIX)) requests.push(url.pathname);
    if (url.pathname === `/api/assets/${STYLE_FRAME_ID}/content`)
      styleRequests.push(url.pathname + url.search);
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;
    if (
      pathname === "/api/assets/" + STYLE_FRAME_ID + "/content" &&
      request.method() === "GET" &&
      (searchParams.size === 0 ||
        (searchParams.size === 1 && searchParams.get("variant") === "poster"))
    ) {
      const variant = searchParams.get("variant");
      return route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${variant === "poster" ? "#5e8d78" : "#447777"}"/></svg>`,
      });
    }
    const storyQueryKeys = [...searchParams.keys()].sort().join(",");
    if (pathname === "/api/story/posts") {
      const validStoryRead =
        request.method() === "GET" &&
        searchParams.get("limit") === "50" &&
        searchParams.getAll("limit").length === 1 &&
        [...searchParams.keys()].every((key) =>
          ["limit", "cursor", "era"].includes(key),
        ) &&
        storyQueryKeys.split(",").includes("limit");
      if (!validStoryRead) {
        unexpectedWrites.push(
          `${request.method()} ${pathname}?${url.searchParams.toString()}`,
        );
        return route.fulfill({
          status: 400,
          json: { error: "INVALID_UIX289_STORY_READ" },
        });
      }
      return route.fulfill({ json: { posts: [], nextCursor: null, eras: [] } });
    }
    if (pathname === "/api/chat/read" && request.method() === "POST") {
      const body: unknown = request.postDataJSON();
      if (
        typeof body === "object" &&
        body !== null &&
        "actionId" in body &&
        typeof body.actionId === "string" &&
        "threadId" in body &&
        typeof body.threadId === "string" &&
        "sequence" in body &&
        typeof body.sequence === "number"
      ) {
        const cursor: ChatReadCursorDto = {
          campaignId: "campaign-under-test",
          threadId: body.threadId,
          lastReadSequence: body.sequence,
          updatedAt: new Date(0).toISOString(),
        };
        return route.fulfill({ json: cursor });
      }
    }
    if (request.method() !== "GET") {
      unexpectedWrites.push(`${request.method()} ${pathname}`);
      return route.fulfill({
        status: 405,
        json: { error: "UNEXPECTED_WRITE_IN_UIX289_FIXTURE" },
      });
    }
    return fulfillUnmocked(route, pathname);
  });
  await installMockedChatTransport(page, {
    getSnapshot,
    socketId: "uix289-bundled-motion",
    onSocket: (socket) => {
      emitSnapshot = (snapshot) =>
        socket.send('42["game:snapshot",' + JSON.stringify(snapshot) + "]");
    },
    onReady: resolveSocketReady,
  });
  return {
    pushSnapshot(snapshot: GameSnapshot) {
      if (!emitSnapshot) throw new Error("App socket is not connected");
      emitSnapshot(snapshot);
    },
    socketReady,
  };
}

async function openActivity(page: Page, width: number, reduced = false) {
  await page.setViewportSize({ width, height: 850 });
  await page.emulateMedia({
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  if (width <= 500 && (await page.locator("#compact-nav-journal").isVisible()))
    await page.locator("#compact-nav-journal").click();
  await expect(page.locator("#chat-panel-activity")).toBeVisible();
  await expect(page.locator("#activity-message-list")).toBeVisible();
}

async function settleRenderedUi(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function revealAllHistory(page: Page, messageCount: number) {
  const articles = page.locator("#activity-message-list article");
  let visible = await articles.count();
  while (visible < messageCount) {
    await page.getByRole("button", { name: "Показать больше" }).click();
    visible = Math.min(messageCount, visible + 10);
    await expect(articles).toHaveCount(visible);
  }
}

async function startApp(
  page: Page,
  initial: GameSnapshot,
  width: number,
  reduced: boolean,
) {
  let currentSnapshot = initial;
  const requests: string[] = [];
  const unexpectedWrites: string[] = [];
  const styleRequests: string[] = [];
  const socketFixture = await installStrictAppFixture(
    page,
    () => currentSnapshot,
    requests,
    unexpectedWrites,
    styleRequests,
  );
  await page.setViewportSize({ width, height: 850 });
  await page.emulateMedia({
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await page.goto("/");
  await socketFixture.socketReady;
  await openActivity(page, width, reduced);
  await settleRenderedUi(page);
  return {
    requests,
    unexpectedWrites,
    styleRequests,
    pushSnapshot: socketFixture.pushSnapshot,
    replaceSnapshot(snapshot: GameSnapshot) {
      currentSnapshot = snapshot;
    },
  };
}

function appendHistory(count: number) {
  return Array.from({ length: count }, (_, index) =>
    textMessage(
      `history-${index}`,
      index + 1,
      `History entry ${index} ${"long entry ".repeat(12)}`,
    ),
  );
}

test("UIX-289 historical critical frames never request while newest displayed entry is ordinary text", async ({
  page,
}) => {
  const history = [criticalMessage("old-success", 1, "success")];
  history.push(...appendHistory(26));
  history.push(textMessage("newest-text", 40));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await startApp(page, snapshotWith(history), 1280, false);
  await expect(page.locator("#chat-message-newest-text")).toContainText(
    "Newest ordinary message",
  );
  await revealAllHistory(page, history.length);
  await expect(page.locator("#chat-message-old-success")).toBeVisible();
  await page.locator("#activity-message-list").evaluate((node) => {
    node.scrollTop = 0;
  });
  await settleRenderedUi(page);
  await expect(
    page.locator('#activity-message-list img[src^="/assets/frames/"]'),
  ).toHaveCount(0);
  expect(fixture.requests).toEqual([]);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test("UIX-289 fresh reduced-motion critical card remains readable without bundled request", async ({
  page,
}) => {
  const fixture = await startApp(
    page,
    snapshotWith([criticalMessage("reduced-critical", 1, "success")]),
    390,
    true,
  );
  await expect(
    page.locator("#chat-message-reduced-critical .roll-total"),
  ).toHaveText("25");
  await expect(
    page.locator("#chat-message-reduced-critical .roll-critical-label"),
  ).toHaveText("Крит. успех");
  await expect(
    page.locator("#chat-message-reduced-critical .outcome-frame img"),
  ).toHaveCount(0);
  expect(fixture.requests).toEqual([]);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test("UIX-289 newest dice becomes history while refreshed skill critical owns the only active frame", async ({
  page,
}) => {
  const first = snapshotWith([criticalMessage("first-roll", 1, "success")]);
  const fixture = await startApp(page, first, 1280, false);
  const firstImage = page.locator(
    "#chat-message-first-roll .outcome-frame--active img",
  );
  await expect(firstImage).toHaveAttribute(
    "src",
    `${FRAME_PREFIX}critical-success.png`,
  );
  await expect
    .poll(() =>
      firstImage.evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(224);

  fixture.pushSnapshot(
    snapshotWith(
      [
        criticalMessage("first-roll", 1, "success"),
        criticalMessage("new-skill", 2, "failure", true),
      ],
      2,
    ),
  );
  const skill = page.locator("#chat-message-new-skill");
  const activeImages = page.locator(
    "#activity-message-list .outcome-frame--active img",
  );
  await expect(skill.locator(".skill-chat-card")).toBeVisible();
  await expect(skill.locator(".roll-critical-label")).toHaveText(
    "Критический провал",
  );
  await expect(skill.locator('[aria-label="Итог броска"]')).toHaveText("6");
  await expect(activeImages).toHaveCount(1);
  await expect(activeImages).toHaveAttribute(
    "src",
    `${FRAME_PREFIX}critical-failure.png`,
  );
  await expect
    .poll(() =>
      activeImages.evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(224);
  await expect(
    page.locator("#chat-message-first-roll .outcome-frame img"),
  ).toHaveCount(0);

  fixture.replaceSnapshot(
    snapshotWith([
      criticalMessage("first-roll", 1, "success"),
      criticalMessage("new-skill", 2, "failure", true),
      criticalMessage("ordinary-failure", 3, "failure"),
      criticalMessage("latest-skill", 4, "success", true),
    ]),
  );
  await page.reload();
  await openActivity(page, 1280);
  const latestSkill = page.locator("#chat-message-latest-skill");
  await expect(latestSkill.locator(".roll-critical-label")).toHaveText(
    "Критический успех",
  );
  await expect(latestSkill.locator('[aria-label="Итог броска"]')).toHaveText(
    "25",
  );
  await expect(
    latestSkill.locator(".outcome-frame--active img"),
  ).toHaveAttribute("src", `${FRAME_PREFIX}critical-success.png`);
  const ordinaryFailure = page.locator("#chat-message-ordinary-failure");
  await expect(ordinaryFailure.locator(".roll-critical-label")).toHaveText(
    "Крит. провал",
  );
  await expect(ordinaryFailure.locator(".roll-total")).toHaveText("6");
  await expect(ordinaryFailure.locator(".outcome-frame img")).toHaveCount(0);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test("UIX-289 real message-list clipping detaches and then restores the eligible frame", async ({
  page,
}) => {
  const messages = [
    ...appendHistory(28),
    criticalMessage("clipped-latest", 30, "success"),
  ];
  const fixture = await startApp(page, snapshotWith(messages), 390, true);
  const list = page.locator("#activity-message-list");
  await revealAllHistory(page, messages.length);
  const frame = page.locator("#chat-message-clipped-latest .outcome-frame");
  const latest = frame.locator("img");
  const intersections = () =>
    frame.evaluate((node) => {
      const list = document.querySelector("#activity-message-list");
      if (!list) throw new Error("Activity message list is unavailable");
      const frameRect = node.getBoundingClientRect();
      const intersects = (
        first: DOMRect,
        second: { left: number; top: number; right: number; bottom: number },
      ) =>
        Math.min(first.right, second.right) >
          Math.max(first.left, second.left) &&
        Math.min(first.bottom, second.bottom) > Math.max(first.top, second.top);
      const listRect = list.getBoundingClientRect();
      return {
        list: intersects(frameRect, listRect),
        viewport: intersects(frameRect, {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
        }),
      };
    });

  await expect
    .poll(() => list.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(0);
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect
    .poll(() =>
      list.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect.poll(intersections).toEqual({ list: true, viewport: true });
  await expect(latest).toHaveCount(0);
  expect(fixture.requests).toEqual([]);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(latest).toHaveAttribute(
    "src",
    `${FRAME_PREFIX}critical-success.png`,
  );
  await expect
    .poll(() => latest.evaluate((img: HTMLImageElement) => img.currentSrc))
    .toMatch(/\/assets\/frames\/critical-success\.png$/);
  await expect
    .poll(() => latest.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(224);

  await list.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect.poll(intersections).toEqual({ list: false, viewport: false });
  await expect(latest).toHaveCount(0);

  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect.poll(intersections).toEqual({ list: true, viewport: true });
  const resumed = page.locator(
    "#chat-message-clipped-latest .outcome-frame img",
  );
  await expect(resumed).toHaveAttribute(
    "src",
    `${FRAME_PREFIX}critical-success.png`,
  );
  await expect
    .poll(() => resumed.evaluate((img: HTMLImageElement) => img.currentSrc))
    .toMatch(/\/assets\/frames\/critical-success\.png$/);
  await expect
    .poll(() => resumed.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(224);
  expect(fixture.requests).toContain(`${FRAME_PREFIX}critical-success.png`);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test("UIX-289 live reduced-motion change removes and resumes the current image without hiding critical text", async ({
  page,
}) => {
  const fixture = await startApp(
    page,
    snapshotWith([criticalMessage("live-motion", 1, "success")]),
    1280,
    true,
  );
  const card = page.locator("#chat-message-live-motion");
  await expect(card.locator(".roll-total")).toHaveText("25");
  await expect(card.locator(".roll-critical-label")).toHaveText("Крит. успех");
  await expect(card.locator(".outcome-frame img")).toHaveCount(0);
  await page.getByRole("button", { name: "Свернуть боковую панель" }).click();
  await expect(page.locator("#activity-sidebar")).toBeHidden();
  await page.getByRole("button", { name: "Развернуть боковую панель" }).click();
  await expect(page.locator("#activity-sidebar")).toBeVisible();
  await expect(card.locator(".roll-critical-label")).toHaveText("Крит. успех");
  await expect(card.locator(".outcome-frame img")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(card.locator(".outcome-frame img")).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(card.locator(".outcome-frame img")).toHaveCount(0);
  await expect(card.locator(".roll-total")).toHaveText("25");
  await expect(card.locator(".roll-critical-label")).toHaveText("Крит. успех");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(card.locator(".outcome-frame img")).toHaveCount(1);
  const resumed = card.locator(".outcome-frame img");
  await expect
    .poll(() => resumed.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(224);
  await expect(card.locator(".outcome-frame img")).toHaveCount(0, {
    timeout: 4000,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(card.locator(".outcome-frame img")).toHaveCount(0);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test("UIX-289 one bundled-frame 404 latches a readable fallback without retry loops", async ({
  page,
}) => {
  let failedRequests = 0;
  const failedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${FRAME_PREFIX}critical-failure.png`) &&
      response.status() === 404,
  );
  await page.route("**/assets/frames/critical-failure.png", async (route) => {
    failedRequests++;
    await route.fulfill({ status: 404, body: "missing fixture asset" });
  });
  const fixture = await startApp(
    page,
    snapshotWith([criticalMessage("missing-frame", 1, "failure")]),
    1280,
    false,
  );
  await failedResponse;
  const card = page.locator("#chat-message-missing-frame");
  await expect(card.locator(".roll-total")).toHaveText("6");
  await expect(card.locator(".roll-critical-label")).toHaveText("Крит. провал");
  await expect(card.locator(".outcome-frame img")).toHaveCount(0);
  await expect.poll(() => failedRequests).toBe(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await settleRenderedUi(page);
  expect(failedRequests).toBe(1);
  expect(fixture.requests).toEqual([`${FRAME_PREFIX}critical-failure.png`]);
  expect(fixture.unexpectedWrites).toEqual([]);
});

test("UIX-289 styleFrame uses the shared bounded lifecycle and static history/reduced fallback", async ({
  page,
}) => {
  const makeStyledRoll = (id: string, sequence: number) => {
    const message = criticalMessage(id, sequence, "success");
    const dice: DiceResult = {
      formula: "1d6",
      resolvedFormula: "1d6",
      terms: [{ notation: "1d6", rolls: [4], subtotal: 4 }],
      modifiers: [],
      total: 4,
      styleFrame: { assetId: STYLE_FRAME_ID, source: "PLAYER" },
    };
    return { ...message, dice };
  };
  const fixture = await startApp(
    page,
    snapshotWith([
      makeStyledRoll("styled-old", 1),
      makeStyledRoll("styled-new", 2),
    ]),
    390,
    true,
  );
  const history = page.locator(
    "#chat-message-styled-old .outcome-frame--style-history img",
  );
  const active = page.locator(
    "#chat-message-styled-new .outcome-frame--style-active img",
  );
  await expect(history).toHaveAttribute(
    "src",
    `/api/assets/${STYLE_FRAME_ID}/content?variant=poster`,
  );
  await expect(active).toHaveAttribute(
    "src",
    `/api/assets/${STYLE_FRAME_ID}/content?variant=poster`,
  );
  expect(fixture.styleRequests).not.toContain(`/api/assets/${STYLE_FRAME_ID}/content`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(active).toHaveAttribute(
    "src",
    `/api/assets/${STYLE_FRAME_ID}/content`,
  );
  await expect
    .poll(() => active.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(96);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => active.evaluate((img: HTMLImageElement) => img.currentSrc))
    .toContain(`/${STYLE_FRAME_ID}/content?variant=poster`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(active).toHaveAttribute(
    "src",
    `/api/assets/${STYLE_FRAME_ID}/content`,
  );
  // Observe resumed playback before waiting for exhaustion; the preceding
  // reduced-motion poster alone must not satisfy this deadline assertion.
  await expect(active).toHaveAttribute(
    "src",
    `/api/assets/${STYLE_FRAME_ID}/content?variant=poster`,
    { timeout: 4000 },
  );
  const animatedRequests = fixture.styleRequests.filter(
    (url) => url === `/api/assets/${STYLE_FRAME_ID}/content`,
  ).length;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await settleRenderedUi(page);
  await expect(active).toHaveAttribute(
    "src",
    `/api/assets/${STYLE_FRAME_ID}/content?variant=poster`,
  );
  expect(fixture.styleRequests.filter(
    (url) => url === `/api/assets/${STYLE_FRAME_ID}/content`,
  )).toHaveLength(animatedRequests);
  expect(fixture.requests).toEqual([]);
  expect(fixture.unexpectedWrites).toEqual([]);
});

function compositeFrameMessage(mixed: boolean): ChatMessageDto {
  const base = criticalMessage("single-owner", 1, "success", true);
  if (!base.skillCard) throw new Error("Missing composite skill fixture");
  const naturals = mixed ? [13, 1, 20] : [13, 14, 15];
  return {
    ...base,
    dice: null,
    skillCard: {
      ...base.skillCard,
      entry: { ...base.skillCard.entry, kind: "ABILITY" },
      action: null,
      formula: null,
      result: null,
      rolls: naturals.map((natural, index) => ({
        action: {
          id: `batch-action-${index}`,
          kind: "CUSTOM",
          label: `Batch roll ${index}`,
          dice: "1d20+5",
          advantage: false,
          consumeUse: false,
        },
        formula: "1d20+5",
        result: {
          formula: "1d20+5",
          resolvedFormula: "1d20+5",
          terms: [{ notation: "1d20", rolls: [natural], subtotal: natural }],
          modifiers: [{ source: "5", value: 5 }],
          total: natural + 5,
          semanticOutcome: {
            kind:
              natural === 1
                ? "CRITICAL_FAILURE"
                : natural === 20
                  ? "CRITICAL_SUCCESS"
                  : "NORMAL",
            keptNaturalD20: natural,
          },
          styleFrame: { assetId: STYLE_FRAME_ID, source: "PLAYER" },
        },
      })),
    },
  };
}

for (const width of [390, 1280]) {
  for (const mixed of [false, true]) {
    test(`UIX-289 one ${mixed ? "critical" : "style"} owner survives history/reload at ${width}px`, async ({ page }) => {
      const message = compositeFrameMessage(mixed);
      const fixture = await startApp(page, snapshotWith([message]), width, true);
      const card = page.locator("#chat-message-single-owner");
      const rows = card.locator(".skill-chat-card__roll");
      const expectedTotals = mixed ? ["18", "6", "25"] : ["18", "19", "20"];
      const ownerIndex = mixed ? 1 : 0;
      const animatedSelector = `.outcome-frame img[src^="${FRAME_PREFIX}"], .outcome-frame img[src="/api/assets/${STYLE_FRAME_ID}/content"]`;
      const animated = card.locator(animatedSelector);
      await expect(rows).toHaveCount(3);
      await expect(card.locator(".roll-total__value")).toHaveText(expectedTotals);
      await expect(animated).toHaveCount(0);
      expect(fixture.requests).toEqual([]);
      expect(fixture.styleRequests).not.toContain(`/api/assets/${STYLE_FRAME_ID}/content`);
      await rows.nth(ownerIndex).scrollIntoViewIfNeeded();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(animated).toHaveCount(1);
      await expect(rows.nth(ownerIndex).locator(animatedSelector)).toHaveCount(1);
      await expect(animated).toHaveAttribute(
        "src",
        mixed
          ? `${FRAME_PREFIX}critical-failure.png`
          : `/api/assets/${STYLE_FRAME_ID}/content`,
      );
      await expect
        .poll(() => animated.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBe(mixed ? 224 : 96);
      // Exhaustion cannot promote the later critical/style result.
      await expect(animated).toHaveCount(0, { timeout: 4000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await settleRenderedUi(page);
      await expect(animated).toHaveCount(0);
      expect(fixture.requests).not.toContain(`${FRAME_PREFIX}critical-success.png`);

      const withText = snapshotWith([message, textMessage("after-batch", 2)], 2);
      fixture.replaceSnapshot(withText);
      fixture.pushSnapshot(withText);
      await expect(page.locator("#chat-message-after-batch")).toBeVisible();
      await expect(card.locator(".roll-total__value")).toHaveText(expectedTotals);
      await expect(animated).toHaveCount(0);
      await page.reload();
      await openActivity(page, width, true);
      await expect(card.locator(".roll-total__value")).toHaveText(expectedTotals);
      await expect(animated).toHaveCount(0);
      // Replacing the latest TEXT by the persisted batch on reload gives it
      // a fresh mount budget, with the same deterministic result owner.
      fixture.replaceSnapshot(snapshotWith([message], 3));
      await page.reload();
      await openActivity(page, width, true);
      await rows.nth(ownerIndex).scrollIntoViewIfNeeded();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(animated).toHaveCount(1);
      await expect(rows.nth(ownerIndex).locator(animatedSelector)).toHaveCount(1);
      await expect(card.locator(".roll-total__value")).toHaveText(expectedTotals);
      expect(fixture.requests).not.toContain(`${FRAME_PREFIX}critical-success.png`);
      expect(fixture.unexpectedWrites).toEqual([]);
    });
  }
}
