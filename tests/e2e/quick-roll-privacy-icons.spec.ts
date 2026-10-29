import { mockAuthenticatedGameCapabilities } from "./mocked-game-capabilities";
import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { fulfillUnmocked } from "./mock-api-contract";
import { PLAYER_THEMES } from "../../apps/web/src/design-system/player-themes";

for (const role of ["GM", "PLAYER"] as const)
  for (const [width, themeId] of [
    [1280, "fire"],
    [800, "light"],
    [360, "forest"],
  ] as const) {
    test(`UIX-645 quick roll privacy ${role} ${width} ${themeId}`, async ({
      page,
    }, info) => {
      const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
      snapshot.personalTheme = {
        scopeKey: snapshot.me.id,
        selectedThemeId: themeId,
        defaultThemeId: "forest",
        revision: 0,
        publishedThemes: [...PLAYER_THEMES],
      };
      const longAbilityName =
        "Гиперпространственное переплетение древних защитных рун и созвездий";
      const character: CharacterDto = {
        id: "69500000-0000-4000-8000-000000000001",
        name: "Хранитель",
        ownerMembershipId: snapshot.me.id,
        controllerMembershipIds: [],
        portraitAssetId: null,
        stats: {},
        statLayout: structuredClone(snapshot.campaign.statLayout),
        skills: [],
        spells: [],
        entries: [
          {
            id: "69500000-0000-4000-8000-000000000002",
            kind: "ABILITY",
            name: longAbilityName,
            description: "Подготовленное действие для проверки переноса.",
            sourceCatalogEntryId: null,
            revision: 1,
            data: {
              activation: { consumeUse: false },
              usageCost: null,
              rollActions: [],
            },
          },
        ],
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
      snapshot.me.characterId = character.id;
      snapshot.members = snapshot.members.map((m) =>
        m.id === snapshot.me.id ? { ...m, characterId: character.id } : m,
      );
      const writes: string[] = [],
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        if (request.method() !== "GET") {
          writes.push(`${request.method()} ${path}`);
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
        return fulfillUnmocked(route, path);
      });
      await page.routeWebSocket(/\/socket\.io\//, (s) => {
        s.onMessage((m) => {
          if (m.toString() === "40") s.send('40{"sid":"stat-controls"}');
        });
        s.send(
          '0{"sid":"stat-controls","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
        );
      });
      await page.setViewportSize({ width, height: 850 });
      await mockAuthenticatedGameCapabilities(page);
      await page.goto("/");

      const secret = page
        .locator(".dice-tray-panel")
        .getByRole("button", { name: "Только мастеру", exact: true });
      const diceButtons = page.locator(
        ".dice-tray-panel__toolbar > button:has(svg.dice-shape-icon)",
      );
      await expect(diceButtons).toHaveCount(8);
      const diceLayout = await diceButtons.evaluateAll((buttons) => {
        const shapes = buttons.map(
          (button) => button.querySelector("svg.dice-shape-icon")!.innerHTML,
        );
        return {
          uniqueShapes: new Set(shapes).size,
          labelsFit: buttons.every((button) => {
            const control = button.getBoundingClientRect();
            const label = button
              .querySelector(".dice-tray-panel__label")!
              .getBoundingClientRect();
            return label.left >= control.left && label.right <= control.right;
          }),
        };
      });
      expect(diceLayout.uniqueShapes).toBe(8);
      expect(diceLayout.labelsFit).toBe(true);
      await expect(secret).toHaveAttribute("aria-pressed", "false");
      await secret.focus();
      await secret.press("Space");
      await expect(secret).toHaveAttribute("aria-pressed", "true");
      await expect(secret).toBeFocused();
      const icon = secret.locator("svg.arken-icon");
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute("aria-hidden", "true");
      await expect(icon).toHaveAttribute("focusable", "false");
      await expect(icon).toHaveAttribute("stroke", "currentColor");
      const box = await secret.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
      expect(box!.height).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
      if (width < 1024) await page.locator("#compact-nav-journal").click();
      const quick = page.getByRole("region", {
        name: "Панель быстрых бросков",
        exact: true,
      });
      const warning = quick.getByRole("status");
      await expect(warning).toHaveText("Броски уйдут только мастеру");
      await expect(warning.locator("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      const statsTab = quick.getByRole("tab", { name: "Статы", exact: true });
      const skillsTab = quick.getByRole("tab", { name: "Скилы", exact: true });
      await expect(statsTab).toHaveAttribute("aria-selected", "true");
      await expect(skillsTab).toHaveAttribute("aria-selected", "false");
      await skillsTab.click();
      await expect(skillsTab).toHaveAttribute("aria-selected", "true");
      await expect(statsTab).toHaveAttribute("aria-selected", "false");
      await statsTab.click();
      const disclosure = quick.getByRole("button", {
        name: "Статы и скилы",
        exact: true,
      });
      await disclosure.focus();
      await disclosure.press("Enter");
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      await expect(warning).toBeHidden();
      await expect(
        quick.getByRole("button", { name: "Сила", exact: true }),
      ).toHaveCount(0);
      await disclosure.press("Enter");
      await expect(warning).toBeVisible();
      await expect(disclosure).toBeFocused();
      const composer = page.getByRole("textbox", {
        name: "Сообщение или бросок",
        exact: true,
      });
      await composer.fill("Черновик сохранён при подготовке действия");
      await skillsTab.click();
      const longAbility = quick.getByText(longAbilityName, { exact: true });
      await expect(longAbility).toBeVisible();
      await quick
        .getByRole("button", { name: /^Подготовить активацию:/ })
        .click();
      const preparedSlot = page.locator(".activity-prepared-actions-slot");
      const prepared = preparedSlot.locator(".quick-roll-prepared-action");
      await expect(prepared).toContainText(longAbilityName);
      const layout = await quick
        .locator(".quick-roll-panel__ability-group .quick-roll-panel__entry")
        .filter({ hasText: longAbilityName })
        .evaluate((entry) => {
          const entryBox = entry.getBoundingClientRect();
          const panelBox = entry
            .closest(".quick-roll-panel")!
            .getBoundingClientRect();
          return {
            left: entryBox.left,
            right: entryBox.right,
            panelLeft: panelBox.left,
            panelRight: panelBox.right,
            scrollWidth: entry.scrollWidth,
            clientWidth: entry.clientWidth,
          };
        });
      const noHorizontalPanelOverflow = await quick.evaluate(
        (panel) => panel.scrollWidth <= panel.clientWidth + 1,
      );
      expect(layout.left).toBeGreaterThanOrEqual(layout.panelLeft - 1);
      expect(layout.right).toBeLessThanOrEqual(layout.panelRight + 1);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
      expect(noHorizontalPanelOverflow).toBe(true);
      const preparedBox = await prepared.boundingBox();
      const composerBox = await page.locator(".chat-compose").boundingBox();
      expect(preparedBox).not.toBeNull();
      expect(composerBox).not.toBeNull();
      const preparedBottom = preparedBox!.y + preparedBox!.height;
      expect(preparedBottom).toBeLessThan(composerBox!.y);
      expect(composerBox!.y - preparedBottom).toBeGreaterThan(0);
      await disclosure.press("Enter");
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      await expect(prepared).toBeVisible();
      await expect(composer).toHaveValue(
        "Черновик сохранён при подготовке действия",
      );
      await disclosure.press("Enter");
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await page.screenshot({
        path: info.outputPath(`private-quickroll-${role}-${width}.png`),
      });
      await statsTab.click();
      if (width < 1024) await page.locator("#compact-nav-map").click();
      await expect(secret).toHaveAttribute("aria-pressed", "true");
      await secret.focus();
      await secret.press("Space");
      await expect(secret).toHaveAttribute("aria-pressed", "false");
      if (width < 1024) await page.locator("#compact-nav-journal").click();
      await expect(warning).toHaveCount(0);
      await expect(
        quick.getByRole("button", { name: "Сила", exact: true }),
      ).toBeVisible();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
