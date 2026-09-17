import type { WebSocketRoute } from "@playwright/test";
import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const role of ["GM"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 participant status controls ${role} ${width}`, async ({
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
      const playerId = "69500000-0000-4000-8000-000000000099";
      snapshot.members.push({
        id: playerId,
        role: "PLAYER",
        displayName: "Следопыт",
        characterId: null,
      });
      let socket: WebSocketRoute | undefined;
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
        socket = s;
        s.onMessage((m) => {
          if (m.toString() === "40") s.send('40{"sid":"stat-controls"}');
        });
        s.send(
          '0{"sid":"stat-controls","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
        );
      });
      await page.setViewportSize({ width, height: 850 });
      await page.goto("/");
      await openWorkspaceSection(page, "Подготовка");
      const player = page.getByRole("button", { name: /Следопыт/ });
      await expect(
        page.getByRole("heading", { name: "Игроки", exact: true }),
      ).toBeVisible();
      await expect(player).toHaveAccessibleName("Не в сети: Следопыт");
      const icon = player.locator("svg.arken-icon");
      const offlineShape = await icon.innerHTML();
      await expect(icon).toHaveAttribute("aria-hidden", "true");
      await expect(icon).toHaveAttribute("focusable", "false");
      await expect(icon).toHaveAttribute("stroke", "currentColor");
      await player.focus();
      socket!.send(
        "42" +
          JSON.stringify([
            "presence:updated",
            [{ membershipId: playerId, online: true }],
          ]),
      );
      await expect(player).toHaveAccessibleName("Онлайн: Следопыт");
      await expect(player).toBeFocused();
      expect(await icon.innerHTML()).not.toBe(offlineShape);
      await player.scrollIntoViewIfNeeded();
      const box = await player.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      await player.press("Enter");
      const rename = page.getByRole("dialog", { name: /Переименовать/ });
      await expect(rename).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(rename).toBeHidden();
      await expect(player).toBeFocused();
      socket!.send(
        "42" +
          JSON.stringify([
            "presence:updated",
            [{ membershipId: playerId, online: false }],
          ]),
      );
      await expect(player).toHaveAccessibleName("Не в сети: Следопыт");
      await expect(player).toBeFocused();
      await page.screenshot({
        path: info.outputPath(`participant-${width}.png`),
      });
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
