import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 character rail controls ${role} ${width}`, async ({
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
      const workspace = page.locator(".character-workspace");
      const rail = workspace.getByRole("navigation", {
        name: "Персонажи кампании",
      });
      const toggle = workspace.locator(".character-rail-toggle");
      await toggle.focus();
      await toggle.press("Enter");
      await expect(toggle).toHaveAccessibleName("Развернуть список персонажей");
      await expect(toggle).toBeFocused();
      if (width === 360) await expect(rail).toBeHidden();
      else {
        await expect(rail).toBeVisible();
        const geometry = await rail.evaluate((n) => ({
          client: n.clientWidth,
          scroll: n.scrollWidth,
        }));
        expect(geometry.scroll, JSON.stringify(geometry)).toBeLessThanOrEqual(
          geometry.client + 1,
        );
        for (const b of await rail.getByRole("button").all()) {
          await expect(b).toHaveAccessibleName(/\S/);
          await b.scrollIntoViewIfNeeded();
          const box = await b.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(24);
          expect(box!.height).toBeGreaterThanOrEqual(24);
        }
      }
      await page.screenshot({
        path: info.outputPath(`rail-collapsed-${role}-${width}.png`),
      });
      await toggle.press("Enter");
      await expect(rail).toBeVisible();
      if (role === "PLAYER")
        await expect(
          rail.getByRole("button", { name: /Архив|Создать/ }),
        ).toHaveCount(0);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
