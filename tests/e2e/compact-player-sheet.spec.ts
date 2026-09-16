import type { CharacterDto } from "@arken/contracts";
import type { Route } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { playerSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
const character: CharacterDto = {
  id: "64500000-0000-4000-8000-000000000001",
  name: "Арина, хранительница переправы",
  ownerMembershipId: "member-under-test",
  controllerMembershipIds: [],
  portraitAssetId: null,
  stats: { strength: 4 },
  skills: [],
  spells: [],
  entries: [],
  notes: "",
  backstory: "Берегла переправу до начала экспедиции.",
  inventory: [],
  resources: {},
  wallet: { gold: 12, silver: 8, copper: 4, sp: 2 },
  revision: 1,
  lifecycle: "ACTIVE",
  archivedAt: null,
  archivedByMembershipId: null,
};

test("UIX-624 PLAYER sheet targets and pending backstory survive journal and rotation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const snapshot = playerSnapshot({ characters: [character] });
  snapshot.me.characterId = character.id;
  snapshot.campaign.statLayout = [
    {
      id: "characteristics",
      label: "Характеристики",
      rows: [{ key: "strength", label: "Сила", source: "STAT" }],
    },
  ];
  const patches: Record<string, unknown>[] = [];
  const unexpected: string[] = [];
  let held: Route | undefined;
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "PATCH" &&
      path === `/api/characters/${character.id}`
    ) {
      patches.push(request.postDataJSON());
      held = route;
      return;
    }
    if (request.method() !== "GET" && path !== "/api/client-logs") {
      unexpected.push(`${request.method()} ${path}`);
      return route.fulfill({
        status: 405,
        json: { error: "READ_ONLY_FIXTURE" },
      });
    }
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") socket.send('40{"sid":"sheet-socket"}');
    });
    socket.send(
      '0{"sid":"sheet-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  try {
    await page.goto("/");
    const sheetNav = page.getByRole("button", {
      name: "Персонаж",
      exact: true,
    });
    await sheetNav.click();
    const sheet = page.locator('.character-workspace[data-compact="true"]');
    await expect(
      sheet.getByRole("heading", { name: character.name, exact: true }),
    ).toBeVisible();
    const failures: object[] = [];
    for (const size of [
      { width: 360, height: 640 },
      { width: 640, height: 360 },
    ]) {
      await page.setViewportSize(size);
      for (const control of await sheet
        .locator("button:visible, summary:visible")
        .all()) {
        if (await control.isDisabled()) continue;
        await control.scrollIntoViewIfNeeded();
        const m = await control.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return {
            label: node.getAttribute("aria-label") || node.textContent?.trim(),
            width: r.width,
            height: r.height,
            hit: node.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            ),
          };
        });
        if (m.width < 44 || m.height < 44 || !m.hit)
          failures.push({ viewport: size, ...m });
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(size.width);
    }
    const disclosure = sheet
      .locator("details.subsection")
      .filter({ has: page.locator("summary", { hasText: /^Предыстория$/ }) });
    const summary = disclosure.locator("summary");
    await summary.focus();
    await summary.press("Enter");
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
    await summary.press("Space");
    await expect(disclosure).not.toHaveAttribute("open", "");
    await summary.click();
    const story = sheet.getByRole("textbox", {
      name: "Предыстория",
      exact: true,
    });
    const draft =
      "Арина ищет пропавших путников. Этот текст ещё ожидает сохранения.";
    await story.fill(draft);
    await summary.click();
    await expect(disclosure).not.toHaveAttribute("open", "");
    await expect(story).toBeHidden();
    await expect.poll(() => patches.length).toBe(1);
    await summary.press("Enter");
    await expect(story).toHaveValue(draft);
    await expect(summary).toBeFocused();
    await page.getByRole("button", { name: "Журнал", exact: true }).click();
    await expect.poll(() => patches.length).toBe(1);
    await expect(sheet).toBeHidden();
    await page.setViewportSize({ width: 360, height: 640 });
    await sheetNav.click();
    await expect(story).toHaveValue(draft);
    const layout = await story.evaluate((node) => {
      if (!(node instanceof HTMLTextAreaElement)) {
        throw new Error("Expected character story textarea");
      }
      const nodes: Array<{
        className: string;
        width: number;
        scrollWidth: number;
        clientWidth: number;
      }> = [];
      for (let e: HTMLElement | null = node; e; e = e.parentElement) {
        nodes.push({
          className: e.className,
          width: e.getBoundingClientRect().width,
          scrollWidth: e.scrollWidth,
          clientWidth: e.clientWidth,
        });
        if (e.classList.contains("character-workspace")) break;
      }
      return { right: node.getBoundingClientRect().right, nodes };
    });
    expect(layout.right, JSON.stringify(layout)).toBeLessThanOrEqual(360);
    expect(
      layout.nodes.filter((node) => node.scrollWidth > node.clientWidth + 1),
      "No hidden horizontal overflow inside the sheet",
    ).toEqual([]);
    expect(patches[0]).toMatchObject({ backstory: draft });
    expect(unexpected).toEqual([]);
    await testInfo.attach("sheet-target-failures", {
      body: JSON.stringify(failures, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath("player-sheet-360.png"),
    });
    expect(failures).toEqual([]);
  } finally {
    if (held)
      await held
        .fulfill({ json: { ...character, ...patches[0], revision: 2 } })
        .catch(() => {});
  }
});
