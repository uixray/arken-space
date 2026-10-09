import { expect, test, type Page } from "@playwright/test";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import { PLAYER_THEMES } from "../../apps/web/src/design-system/player-themes";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

const characterName =
  "Александра Невероятно-Длинная, Хранительница Семнадцати Королевств";
const rollsThreadId = "uix674-visual-rolls";

function visualSnapshot(
  role: "GM" | "PLAYER",
  theme: "light" | "forest",
): GameSnapshot {
  const snapshot = buildGameSnapshot(role);
  const character: CharacterDto = {
    id: "uix674-visual-character",
    name: characterName,
    ownerMembershipId: snapshot.me.id,
    controllerMembershipIds: [],
    portraitAssetId: null,
    stats: { enduranceRegen: 3, manaRegen: 2 },
    skills: [],
    spells: [],
    notes: "",
    backstory: "",
    inventory: [],
    resources: {
      physicalPower: { current: 14, maximum: 10 },
      magicPower: { current: 8, maximum: 6 },
    },
    wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
    entries: [],
    revision: 1,
    lifecycle: "ACTIVE",
    archivedAt: null,
    archivedByMembershipId: null,
  };
  snapshot.characters = [character];
  if (role === "PLAYER") snapshot.me.characterId = character.id;
  snapshot.members = snapshot.members.map((member) =>
    member.id === snapshot.me.id
      ? { ...member, characterId: role === "PLAYER" ? character.id : null }
      : member,
  );
  const createdAt = "2026-10-09T09:00:00.000Z";
  snapshot.chatThreads = [
    {
      id: rollsThreadId,
      campaignId: snapshot.campaign.id,
      type: "STREAM",
      stream: "ROLLS",
      createdAt,
      updatedAt: createdAt,
    },
  ];
  snapshot.messages = (
    [
      [
        "advantage",
        "Чистый бросок стогранника · преимущество",
        "ADVANTAGE",
        24,
      ],
      [
        "disadvantage",
        "Чистый бросок стогранника · помеха",
        "DISADVANTAGE",
        72,
      ],
    ] as const
  ).map(([id, body, rollMode, roll]) => ({
    id: `uix674-${id}`,
    sequence: id === "advantage" ? 1 : 2,
    membershipId: snapshot.me.id,
    displayName: snapshot.me.displayName,
    characterId: character.id,
    body,
    visibility: "PUBLIC" as const,
    kind: "DICE" as const,
    threadId: rollsThreadId,
    stream: "ROLLS" as const,
    dice: {
      formula: "1d100",
      resolvedFormula: "1d100",
      terms: [{ notation: "1d100", rolls: [roll], subtotal: roll }],
      modifiers: [],
      total: roll,
      rollMode,
    },
    createdAt,
  }));
  snapshot.personalTheme = {
    scopeKey: snapshot.me.id,
    selectedThemeId: theme,
    defaultThemeId: "forest",
    revision: 0,
    publishedThemes: [...PLAYER_THEMES],
  };
  return snapshot;
}

async function mockReadOnlyApp(page: Page, snapshot: GameSnapshot) {
  const unexpectedWrites: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === "/api/chat/read")
      return route.fulfill({ json: { ok: true } });
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      unexpectedWrites.push(`${request.method()} ${path}`);
      return route.fulfill({
        status: 405,
        json: { error: "READ_ONLY_FIXTURE" },
      });
    }
    if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
    if (path === "/api/me/theme")
      return route.fulfill({ json: snapshot.personalTheme });
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({
        status: 403,
        json: { error: "OPERATOR_REQUIRED" },
      });
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") socket.send('40{"sid":"uix674-visual"}');
    });
    socket.send(
      '0{"sid":"uix674-visual-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  return unexpectedWrites;
}

for (const role of ["GM", "PLAYER"] as const) {
  for (const width of [1077, 390]) {
    for (const theme of ["forest", "light"] as const) {
      test(`UIX-674 activity rolls, character truncation, and resource palette ${role} ${width}px ${theme}`, async ({
        page,
      }) => {
        const height = width === 390 ? 844 : 918;
        await page.setViewportSize({ width, height });
        const snapshot = visualSnapshot(role, theme);
        const unexpectedWrites = await mockReadOnlyApp(page, snapshot);
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute(
          "data-player-theme",
          theme,
        );
        if (width === 390)
          await page
            .getByRole("navigation", { name: "Основные области" })
            .getByRole("button", { name: "Журнал", exact: true })
            .click();

        const activity = page.locator("#chat-panel-activity");
        await expect(activity).toBeVisible();
        const picker = activity.locator(".activity-character-picker");
        await expect(picker).toBeVisible();
        if (role === "PLAYER") {
          const name = picker.locator("strong");
          await expect(name).toHaveText(characterName);
          const clipping = await name.evaluate((node) => ({
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
            overflow: getComputedStyle(node).textOverflow,
            whiteSpace: getComputedStyle(node).whiteSpace,
          }));
          expect(clipping.clientWidth).toBeGreaterThan(0);
          expect(clipping.scrollWidth).toBeGreaterThan(clipping.clientWidth);
          expect(clipping.overflow).toBe("ellipsis");
          expect(clipping.whiteSpace).toBe("nowrap");
        } else {
          const control = picker.locator(".g-select");
          const value = control.locator(".arken-select__value");
          await expect(value).toHaveText(characterName);
          const clipping = await value.evaluate((node) => ({
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
            overflow: getComputedStyle(node).textOverflow,
            whiteSpace: getComputedStyle(node).whiteSpace,
            right: node.getBoundingClientRect().right,
            pickerRight: node
              .closest(".activity-character-picker")!
              .getBoundingClientRect().right,
          }));
          expect(clipping.clientWidth).toBeGreaterThan(0);
          expect(clipping.scrollWidth).toBeGreaterThan(clipping.clientWidth);
          expect(clipping.overflow).toBe("ellipsis");
          expect(clipping.whiteSpace).toBe("nowrap");
          expect(clipping.right).toBeLessThanOrEqual(clipping.pickerRight);
        }
        expect(
          await picker.evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);

        const pureRolls = activity.locator(".roll-result--pure");
        await expect(pureRolls).toHaveCount(2);
        for (const [suffix, badge] of [
          ["преимущество", "Преимущество"],
          ["помеха", "Помеха"],
        ] as const) {
          const roll = pureRolls.filter({ hasText: suffix });
          await expect(roll).toHaveCount(1);
          await expect(roll.locator(".roll-details__heading")).toHaveText(
            "Чистый бросок стогранника",
          );
          await expect(roll.locator(".roll-mode-badge")).toHaveText(badge);
          const formula = roll.locator(
            ".roll-details__math > small:first-child",
          );
          await expect(formula).toHaveText("1d100");
          await expect(formula).toHaveCSS("text-align", "left");
        }

        const counters = activity.locator("details.resource-counters");
        for (const [label, fillColor, overflowColor] of [
          ["Выносливость", "rgb(225, 184, 65)", "rgb(154, 114, 18)"],
          ["Мана", "rgb(65, 143, 223)", "rgb(23, 87, 158)"],
        ] as const) {
          const bar = counters.getByRole("progressbar", {
            name: `Уровень: ${label}`,
          });
          await expect(bar.locator(".resource-bar__fill")).toHaveCSS(
            "background-color",
            fillColor,
          );
          await expect(bar.locator(".resource-bar__overflow")).toHaveCSS(
            "background-color",
            overflowColor,
          );
        }
        expect(unexpectedWrites).toEqual([]);
      });
    }
  }
}
