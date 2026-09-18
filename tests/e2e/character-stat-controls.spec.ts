import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 character stat controls ${role} ${width}`, async ({
      page,
    }, info) => {
      const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
      const character: CharacterDto = {
        id: "69500000-0000-4000-8000-000000000001",
        name: "Хранитель",
        ownerMembershipId: snapshot.me.id,
        controllerMembershipIds: [],
        portraitAssetId: null,
        stats: {},
        skills: [],
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
        return route.fulfill({ json: [] });
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
      await page.goto("/");
      await openWorkspaceSection(page, "Персонажи");
      const sheet = page.getByRole("article", {
        name: "Лист персонажа Хранитель",
        exact: true,
      });
      const card = sheet.locator(".character-card--stats");
      const row = card.locator(".stat-field").first();
      const label = (await row
        .locator(":scope > span:first-child")
        .textContent())!.trim();
      await row.scrollIntoViewIfNeeded();
      await expect(row.locator("input")).toHaveAccessibleName(label);
      const measurements: object[] = [];
      for (const button of await row.getByRole("button").all()) {
        await expect(button).toHaveAccessibleName(/\S/);
        await button.scrollIntoViewIfNeeded();
        const m = await button.evaluate((node) => {
          const b = node.getBoundingClientRect();
          return {
            label: node.getAttribute("aria-label") || node.textContent?.trim(),
            width: b.width,
            height: b.height,
            hit: node.contains(
              document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2),
            ),
          };
        });
        measurements.push(m);
        expect(m.width).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
        expect(m.height).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
        if (await button.isEnabled())
          expect(m.hit, JSON.stringify(m)).toBe(true);
        for (const icon of await button.locator("svg.arken-icon").all()) {
          await expect(icon).toHaveAttribute("aria-hidden", "true");
          await expect(icon).toHaveAttribute("focusable", "false");
          await expect(icon).toHaveAttribute("stroke", "currentColor");
        }
      }
      if (role === "GM") {
        const rename = row.getByRole("button", {
          name: `Переименовать «${label}»`,
          exact: true,
        });
        await rename.focus();
        await rename.press("Enter");
        const dialog = page.getByRole("dialog", {
          name: "Переименовать строку",
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("textbox", { name: "Название", exact: true }),
        ).toHaveValue(label);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(rename).toBeFocused();
        const remove = row.getByRole("button", {
          name: `Удалить «${label}»`,
          exact: true,
        });
        await remove.click();
        const confirmation = page.getByRole("dialog", {
          name: `Удалить «${label}»?`,
          exact: true,
        });
        await expect(confirmation).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(confirmation).toBeHidden();
        await expect(remove).toBeFocused();
      } else {
        await expect(
          card.getByRole("button", {
            name: /Переименовать|Переместить|Удалить|Добавить строку/,
          }),
        ).toHaveCount(0);
      }
      await info.attach("stat-controls", {
        body: JSON.stringify({
          role,
          width,
          label,
          measurements,
          writes,
          errors,
        }),
        contentType: "application/json",
      });
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`stat-controls-${role}-${width}.png`),
      });
    });
  }
