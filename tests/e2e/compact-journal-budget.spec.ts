import { randomUUID } from "node:crypto";
import { type Locator, type Page } from "@playwright/test";
import { type GameSnapshot } from "@arken/contracts";
import { expect, test } from "./campaign-fixture";
import {
  PANEL_HEIGHT_LIMITS,
  panelHeightStorageKey,
} from "../../apps/web/src/panel-height-preference";

const CONTROLS = ".activity-feed__controls";
const LIST = "#activity-message-list";
const OUTER = ".panel-scroll.chat-scroll";

async function bootstrap(page: Page): Promise<GameSnapshot> {
  const response = await page.request.get("/api/bootstrap");
  await expect(response).toBeOK();
  return response.json() as Promise<GameSnapshot>;
}

async function enterAsPlayer(page: Page, gmToken: string) {
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  const character = (await bootstrap(page)).characters[0];
  expect(character).toBeTruthy();
  const response = await page.request.post("/api/invites", {
    data: {
      actionId: randomUUID(),
      characterId: character.id,
      label: "Игрок compact budget",
      expiresInHours: 1,
    },
  });
  await expect(response).toBeOK();
  const invite = (await response.json()) as { url: string };
  await expect(await page.request.post("/api/auth/logout")).toBeOK();
  await page.goto(new URL(invite.url).pathname);
  await page.getByLabel("Имя", { exact: true }).fill("Игрок compact budget");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect((await bootstrap(page)).me.role).toBe("PLAYER");
}

async function addMessages(page: Page, count = 18) {
  let lastBody = "";
  for (let index = 0; index < count; index += 1) {
    lastBody = `Compact budget ${index}: запись журнала с достаточной длиной для переполнения.`;
    await expect(
      await page.request.post("/api/chat", {
        data: {
          actionId: randomUUID(),
          stream: "TABLE",
          body: lastBody,
        },
      }),
    ).toBeOK();
  }
  return lastBody;
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function assertCompactBudget(
  page: Page,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.locator("#compact-nav-journal").click();
  const controls = page.getByRole("region", {
    name: "Быстрые броски и ресурсы",
  });
  const list = page.locator(LIST);
  const compose = page.locator(".chat-compose");
  const nav = page.getByRole("navigation", { name: "Основные области" });
  const outer = page.locator(OUTER);
  await expect(controls).toBeVisible();
  await expect(list).toBeVisible();
  await expect(compose).toBeVisible();

  await expect(page.locator("details.resource-counters")).toHaveAttribute(
    "open",
    "",
  );
  const [controlsBox, listBox, composeBox, navBox, outerBox] =
    await Promise.all([
      rect(controls),
      rect(list),
      rect(compose),
      rect(nav),
      rect(outer),
    ]);
  expect(
    listBox.height,
    "UIX624_JOURNAL_VISIBLE_BUDGET: log must keep 160px",
  ).toBeGreaterThanOrEqual(160);
  expect(
    listBox.y,
    "UIX624_JOURNAL_VISIBLE_BUDGET: log inside outer top",
  ).toBeGreaterThanOrEqual(outerBox.y - 1);
  expect(
    listBox.y + listBox.height,
    "UIX624_JOURNAL_VISIBLE_BUDGET: log inside outer bottom",
  ).toBeLessThanOrEqual(outerBox.y + outerBox.height + 1);
  expect(
    listBox.y,
    "UIX624_JOURNAL_VISIBLE_BUDGET: log follows controls",
  ).toBeGreaterThanOrEqual(controlsBox.y + controlsBox.height - 1);
  expect(
    listBox.y + listBox.height,
    "UIX624_JOURNAL_VISIBLE_BUDGET: log above composer",
  ).toBeLessThanOrEqual(composeBox.y + 1);
  expect(
    composeBox.y + composeBox.height,
    "UIX624_JOURNAL_VISIBLE_BUDGET: composer above nav",
  ).toBeLessThanOrEqual(navBox.y + 1);
  expect(
    await page.locator(OUTER).evaluate((node) => node.scrollTop),
    "UIX624_JOURNAL_VISIBLE_BUDGET: outer scroll stays zero",
  ).toBe(0);
  const logScroll = await list.evaluate((node) => ({
    overflow: node.scrollHeight - node.clientHeight,
    bottom: node.scrollHeight - node.clientHeight - node.scrollTop,
  }));
  expect(
    logScroll.overflow,
    "UIX624_JOURNAL_VISIBLE_BUDGET: real log overflow",
  ).toBeGreaterThan(200);
  expect(
    logScroll.bottom,
    "UIX624_JOURNAL_VISIBLE_BUDGET: newest entry visible",
  ).toBeLessThanOrEqual(4);

  await controls.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() => controls.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  for (const target of [
    page.locator(".resource-counters__summary"),
    page.locator(".activity-quick-rolls .g-button").last(),
  ]) {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible();
    const box = await rect(target);
    const port = await rect(controls);
    const marker = "UIX624_JOURNAL_VISIBLE_BUDGET: reachable 44px target";
    expect(box.width, marker).toBeGreaterThanOrEqual(44);
    expect(box.height, marker).toBeGreaterThanOrEqual(44);
    expect(box.y, marker).toBeGreaterThanOrEqual(port.y - 1);
    expect(box.y + box.height, marker).toBeLessThanOrEqual(
      port.y + port.height + 1,
    );
    expect(box.x, marker).toBeGreaterThanOrEqual(port.x - 1);
    expect(box.x + box.width, marker).toBeLessThanOrEqual(
      port.x + port.width + 1,
    );
  }
}

async function preparePlayerJournal(page: Page, gmToken: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterAsPlayer(page, gmToken);
  const lastBody = await addMessages(page);
  const snapshot = await bootstrap(page);
  await page.evaluate(
    ({ key, height }) => {
      localStorage.setItem(key, String(height));
    },
    {
      key: panelHeightStorageKey(
        "quickRolls",
        snapshot.campaign.id,
        snapshot.me.id,
      ),
      height: PANEL_HEIGHT_LIMITS.max,
    },
  );
  await page.reload();
  await expect(page.getByText(lastBody, { exact: true })).toBeAttached();
  await expect(page.locator(".quick-roll-panel")).toHaveAttribute(
    "style",
    new RegExp(`height:\\s*${PANEL_HEIGHT_LIMITS.max}px`),
  );
}

for (const viewport of [
  { width: 650, height: 698 },
  { width: 360, height: 640 },
] as const) {
  test(
    `PLAYER ${viewport.width}x${viewport.height}: UIX624_JOURNAL_VISIBLE_BUDGET`,
    async ({ page, gmToken }) => {
      await preparePlayerJournal(page, gmToken);
      await assertCompactBudget(page, viewport);
    },
  );
}

test("desktop 1280x900 preserves journal flex layout", async ({
  page,
  gmToken,
}) => {
  await preparePlayerJournal(page, gmToken);
  await expect(page.locator("#activity-sidebar")).toBeVisible();
  await expect(page.locator(LIST)).toBeVisible();
  await expect(page.locator(".chat-compose")).toBeVisible();
  await expect(page.locator(CONTROLS)).toHaveCSS("display", "contents");
  expect(
    (await rect(page.locator(LIST))).height,
    "DESKTOP_LOG_MINIMUM_160",
  ).toBeGreaterThanOrEqual(160);
  const [listBox, composeBox, outerBox] = await Promise.all([
    rect(page.locator(LIST)),
    rect(page.locator(".chat-compose")),
    rect(page.locator(OUTER)),
  ]);
  expect(listBox.y).toBeGreaterThanOrEqual(outerBox.y - 1);
  expect(listBox.y + listBox.height).toBeLessThanOrEqual(composeBox.y + 1);
  expect(composeBox.y + composeBox.height).toBeLessThanOrEqual(
    outerBox.y + outerBox.height + 1,
  );
});
