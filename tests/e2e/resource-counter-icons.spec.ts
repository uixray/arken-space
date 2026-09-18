import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 resource counter controls ${role} ${width}`, async ({
      page,
    }, info) => {
      const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
      const character: CharacterDto = {
        id: "69500000-0000-4000-8000-000000000001",
        name: "Хранитель",
        ownerMembershipId: snapshot.me.id,
        controllerMembershipIds: [],
        portraitAssetId: null,
        stats: { enduranceRegen: 3, manaRegen: 2 },
        skills: [],
        spells: [],
        entries: [],
        notes: "",
        backstory: "",
        inventory: [],
        resources: {
          physicalPower: { current: 10, maximum: 10 },
          magicPower: { current: 0, maximum: 6 },
        },
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
      if (width === 360) await page.locator("#compact-nav-journal").click();
      const counters = page.locator("details.resource-counters");
      await expect(counters).toBeVisible();
      const summary = counters.locator("summary");
      if (!(await counters.evaluate((n) => n.hasAttribute("open"))))
        await summary.click();
      const measurements: object[] = [];
      await expect(counters.locator("svg.arken-icon")).toHaveCount(4);
      await expect(
        counters.getByRole("button", {
          name: "Восстановить 3: Выносливость",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        counters.getByRole("button", {
          name: "Восстановить 2: Мана",
          exact: true,
        }),
      ).toBeEnabled();
      for (const label of ["Выносливость", "Мана"]) {
        const input = counters.getByRole("spinbutton", {
          name: `Очки: ${label}`,
          exact: true,
        });
        await expect(input).toHaveValue(label === "Мана" ? "0" : "10");
        const minus = counters.getByRole("button", {
          name: `Потратить одно очко: ${label}`,
          exact: true,
        });
        const plus = counters.getByRole("button", {
          name: `Вернуть одно очко: ${label}`,
          exact: true,
        });
        if (label === "Мана") {
          await expect(minus).toBeDisabled();
          await expect(plus).toBeEnabled();
        } else {
          await expect(minus).toBeEnabled();
          await expect(plus).toBeDisabled();
        }
      }
      for (const button of await counters.getByRole("button").all()) {
        await expect(button).toHaveAccessibleName(/\S/);
        await button.scrollIntoViewIfNeeded();
        const m = await button.evaluate((node) => {
          const b = node.getBoundingClientRect();
          return {
            label: node.getAttribute("aria-label"),
            width: b.width,
            height: b.height,
            hit: node.contains(
              document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2),
            ),
            inViewport: b.left >= 0 && b.right <= innerWidth,
          };
        });
        measurements.push(m);
        expect(m.width).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
        expect(m.height).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
        expect(m.inViewport).toBe(true);
        if (await button.isEnabled())
          expect(m.hit, JSON.stringify(m)).toBe(true);
        for (const icon of await button.locator("svg.arken-icon").all()) {
          await expect(icon).toHaveAttribute("aria-hidden", "true");
          await expect(icon).toHaveAttribute("focusable", "false");
          await expect(icon).toHaveAttribute("stroke", "currentColor");
        }
      }
      // A real sequential traversal from the section summary, not per-control focus.
      await summary.focus();
      const reachable = counters.locator("button:enabled,input:enabled");
      for (const control of await reachable.all()) {
        await page.keyboard.press("Tab");
        await expect(control).toBeFocused();
        expect(await control.evaluate((n) => n.matches(":focus-visible"))).toBe(
          true,
        );
      }
      await summary.focus();
      await summary.press("Enter");
      await expect(counters.locator(".resource-counters__list")).toBeHidden();
      await summary.press("Enter");
      await expect(counters.locator(".resource-counters__list")).toBeVisible();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      await info.attach("resource-controls", {
        body: JSON.stringify({ role, width, measurements, writes, errors }),
        contentType: "application/json",
      });
      await page.screenshot({
        path: info.outputPath(`resource-controls-${role}-${width}.png`),
      });
    });
  }
