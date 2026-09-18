import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 quick roll privacy ${role} ${width}`, async ({
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

      const secret = page
        .locator(".dice-tray-panel")
        .getByRole("button", { name: "Только мастеру", exact: true });
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
      if (width === 360) await page.locator("#compact-nav-journal").click();
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
      const disclosure = quick.getByRole("button", {
        name: "Броски характеристик",
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
      await page.screenshot({
        path: info.outputPath(`private-quickroll-${role}-${width}.png`),
      });
      if (width === 360) await page.locator("#compact-nav-map").click();
      await expect(secret).toHaveAttribute("aria-pressed", "true");
      await secret.focus();
      await secret.press("Space");
      await expect(secret).toHaveAttribute("aria-pressed", "false");
      if (width === 360) await page.locator("#compact-nav-journal").click();
      await expect(warning).toHaveCount(0);
      await expect(
        quick.getByRole("button", { name: "Сила", exact: true }),
      ).toBeVisible();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
