import type { Page } from "@playwright/test";
import type { GameSnapshot } from "@arken/contracts";
import { PLAYER_THEMES } from "../../apps/web/src/design-system/player-themes";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { expect, test } from "./react-console-guard";

test.use({ actionTimeout: 10_000 });

const tableThreadId = "31700000-0000-4000-8000-000000000010";
const rollsThreadId = "31700000-0000-4000-8000-000000000011";

function surfaceSnapshot(role: "GM" | "PLAYER"): GameSnapshot {
  const snapshot = buildGameSnapshot(role);
  const baseMessage = {
    membershipId: snapshot.me.id,
    displayName: snapshot.me.displayName,
    characterId: null,
    visibility: "PUBLIC" as const,
    createdAt: "2026-09-19T08:00:00.000Z",
  };
  snapshot.scenes = [
    {
      id: "31700000-0000-4000-8000-000000000012",
      name: "Проверка тем",
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
  ];
  snapshot.chatThreads = [
    {
      id: tableThreadId,
      campaignId: snapshot.campaign.id,
      type: "STREAM",
      stream: "TABLE",
      createdAt: baseMessage.createdAt,
      updatedAt: baseMessage.createdAt,
    },
    {
      id: rollsThreadId,
      campaignId: snapshot.campaign.id,
      type: "STREAM",
      stream: "ROLLS",
      createdAt: baseMessage.createdAt,
      updatedAt: baseMessage.createdAt,
    },
  ];
  snapshot.chatThreadStates = [
    {
      threadId: tableThreadId,
      stream: "TABLE",
      lastReadSequence: 1,
      latestSequence: 1,
      unreadCount: 0,
    },
    {
      threadId: rollsThreadId,
      stream: "ROLLS",
      lastReadSequence: 3,
      latestSequence: 3,
      unreadCount: 0,
    },
  ];
  const diceMessage = (
    id: string,
    sequence: number,
    body: string,
    roll: 1 | 20,
  ): GameSnapshot["messages"][number] => ({
    ...baseMessage,
    id,
    sequence,
    body,
    kind: "DICE",
    threadId: rollsThreadId,
    stream: "ROLLS",
    dice: {
      formula: "1d20",
      resolvedFormula: "1d20",
      terms: [{ notation: "1d20", rolls: [roll], subtotal: roll }],
      modifiers: [],
      total: roll,
    },
  });
  snapshot.messages = [
    {
      ...baseMessage,
      id: "31700000-0000-4000-8000-000000000013",
      sequence: 1,
      body: "Сообщение стола читается в активной теме.",
      kind: "TEXT",
      threadId: tableThreadId,
      stream: "TABLE",
      dice: null,
    },
    diceMessage(
      "31700000-0000-4000-8000-000000000014",
      2,
      "Естественная единица",
      1,
    ),
    diceMessage(
      "31700000-0000-4000-8000-000000000015",
      3,
      "Естественная двадцатка",
      20,
    ),
  ];
  snapshot.personalTheme = {
    scopeKey: snapshot.me.id,
    selectedThemeId: null,
    defaultThemeId: "forest",
    revision: 0,
    publishedThemes: [...PLAYER_THEMES],
  };
  return snapshot;
}

async function mockSurfaceApp(page: Page, snapshot: GameSnapshot) {
  const writes: string[] = [];
  const reads: { threadId: string; sequence: number; actionId: string }[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    // Opening the real journal acknowledges visible messages. Mock only that
    // expected read cursor, while still rejecting every game/theme mutation.
    if (request.method() === "POST" && path === "/api/chat/read") {
      const input = request.postDataJSON() as (typeof reads)[number];
      reads.push(input);
      return route.fulfill({
        json: {
          campaignId: snapshot.campaign.id,
          threadId: input.threadId,
          lastReadSequence: input.sequence,
          updatedAt: "2026-09-19T08:00:01.000Z",
        },
      });
    }
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${path}`);
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
      return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40")
        socket.send('40{"sid":"theme-surfaces"}');
    });
    socket.send(
      '0{"sid":"theme-surfaces-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  return { writes, reads };
}

async function openThemeDialog(page: Page) {
  await page.locator(".account-menu > summary").click();
  await page.getByRole("button", { name: "Оформление", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Оформление", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const role of ["GM", "PLAYER"] as const) {
  for (const width of [1280, 390]) {
    test(`UIX-317 themed chat rolls and settings surfaces ${role} ${width}`, async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 850 });
      const snapshot = surfaceSnapshot(role);
      const { writes, reads } = await mockSurfaceApp(page, snapshot);

      for (const theme of [
        ...PLAYER_THEMES.map(({ id, name }) => ({ id, name })),
        { id: "system", name: "Системное оформление" },
      ]) {
        snapshot.personalTheme!.selectedThemeId = theme.id;
        await page.goto("/");
        await expect(page.locator(".map-viewport")).toBeVisible();
        if (theme.id === "system")
          await expect(page.locator("html")).not.toHaveAttribute(
            "data-player-theme",
          );
        else
          await expect(page.locator("html")).toHaveAttribute(
            "data-player-theme",
            theme.id,
          );

        // Desktop already exposes the activity journal alongside the map.
        // Compact has a real primary navigation button rather than a desktop
        // workspace row / “Разделы” dialog.
        if (width === 390) {
          await page
            .getByRole("navigation", { name: "Основные области" })
            .getByRole("button", { name: "Журнал", exact: true })
            .click();
        }
        const tableMessage = page.getByText(
          "Сообщение стола читается в активной теме.",
          { exact: true },
        );
        await expect(tableMessage).toBeVisible();
        // This is a rendered-ink guard, not a claim of measured WCAG contrast.
        await expect(tableMessage).not.toHaveCSS("color", "rgba(0, 0, 0, 0)");
        const failure = page.locator(".roll-result--critical-failure");
        const success = page.locator(".roll-result--critical-success");
        await expect(failure).toContainText("Критический провал");
        await expect(success).toContainText("Критический успех");
        await expect(failure.locator(".roll-critical-label")).toBeVisible();
        await expect(success.locator(".roll-critical-label")).toBeVisible();
        if (theme.id === "light") {
          // Measure the actual critical text against its opaque light card.
          // This intentionally does not certify arbitrary media/alpha surfaces.
          const ratios = await page
            .locator(".roll-result :is(.roll-critical-label, .roll-total)")
            .evaluateAll((nodes) => {
              const rgb = (value: string) => {
                const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
                if (!match) throw new Error(`Expected opaque sRGB: ${value}`);
                return match.slice(1).map(Number);
              };
              const luminance = (color: number[]) =>
                color.reduce((sum, channel, index) => {
                  const s = channel / 255;
                  const linear =
                    s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                  return sum + linear * [0.2126, 0.7152, 0.0722][index];
                }, 0);
              return nodes.map((node) => {
                const card = node.closest(".roll-result")!;
                const background = getComputedStyle(card).backgroundColor;
                const foreground = getComputedStyle(node).color;
                for (
                  let current: Element | null = node;
                  current;
                  current = current.parentElement
                ) {
                  const style = getComputedStyle(current);
                  if (
                    Number(style.opacity) !== 1 ||
                    style.filter !== "none" ||
                    style.backdropFilter !== "none" ||
                    style.mixBlendMode !== "normal" ||
                    style.maskImage !== "none"
                  )
                    throw new Error("Unsupported text compositing");
                  if (
                    (current === card || card.contains(current)) &&
                    (style.backgroundImage !== "none" ||
                      (current !== card &&
                        style.backgroundColor !== "rgba(0, 0, 0, 0)"))
                  )
                    throw new Error("Unsupported critical text backing");
                }
                const a = luminance(rgb(foreground));
                const b = luminance(rgb(background));
                return {
                  text: node.textContent,
                  foreground,
                  background,
                  ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
                };
              });
            });
          expect(ratios).toHaveLength(4);
          await info.attach("light-critical-text-contrast", {
            body: JSON.stringify(ratios),
            contentType: "application/json",
          });
          for (const measured of ratios)
            expect(
              measured.ratio,
              measured.text ?? "critical text",
            ).toBeGreaterThanOrEqual(4.5);
        }
        await info.attach(`theme-journal-${role}-${width}-${theme.id}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });

        const dialog = await openThemeDialog(page);
        const select = dialog.getByRole("combobox", {
          name: "Тема",
          exact: true,
        });
        await select.click();
        const visibleName =
          theme.id === "classic-v1" ? "Прежнее оформление" : theme.name;
        // The controlled option appends “сейчас” / “по умолчанию” markers.
        const option = page.getByRole("option", {
          name: new RegExp(
            `^${visibleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: —|$)`,
          ),
        });
        await expect(option).toBeVisible();
        const hit = await option.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const target = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return target === node || node.contains(target);
        });
        expect(hit).toBe(true);
        const popup = page.locator(".arken-form-select-popup");
        // Layer values live on the actual portal wrappers, not the semantic
        // content nodes (whose computed z-index is correctly "auto").
        const [dialogZ, popupZ] = await Promise.all([
          dialog.evaluate((node) => {
            const wrapper = node.closest(".g-modal");
            if (!wrapper) throw new Error("Missing modal layer wrapper");
            return Number(getComputedStyle(wrapper).zIndex);
          }),
          popup.evaluate((node) => {
            const wrapper = node.closest("[data-floating-ui-status]");
            if (!wrapper) throw new Error("Missing popup layer wrapper");
            return Number(getComputedStyle(wrapper).zIndex);
          }),
        ]);
        expect(dialogZ).toBeGreaterThan(0);
        expect(popupZ).toBeGreaterThan(dialogZ);
        await page.keyboard.press("Escape");
        await expect(select).toBeFocused();
        await info.attach(`theme-surfaces-${role}-${width}-${theme.id}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      }

      expect(writes).toEqual([]);
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) {
        expect([tableThreadId, rollsThreadId]).toContain(read.threadId);
        expect(read.sequence).toBe(read.threadId === tableThreadId ? 1 : 3);
        expect(read.actionId).toMatch(/^[a-f0-9-]{36}$/i);
      }
      await info.attach("expected-journal-read-cursors", {
        body: JSON.stringify(reads),
        contentType: "application/json",
      });
    });
  }
}
