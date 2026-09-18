import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 gallery navigation ${role} ${width}`, async ({
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
      const media = [0, 1].map((index) => ({
        id: `69500000-0000-4000-8000-00000000001${index}`,
        campaignId: snapshot.campaign.id,
        characterId: character.id,
        assetId: `69500000-0000-4000-8000-00000000002${index}`,
        category: "CHARACTER_ART",
        caption: `Изображение ${index + 1}`,
        ordering: index,
        visibility: "OWNER_GM",
        relatedEntityId: null,
        uploadedByMembershipId: snapshot.me.id,
        detachedAt: null,
        revision: 1,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }));
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
        if (path === `/api/characters/${character.id}/media`)
          return route.fulfill({ json: media });
        if (/^\/api\/assets\/[^/]+\/content$/.test(path))
          return route.fulfill({
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64",
            ),
          });
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
      const trigger = page.getByRole("button", {
        name: "Открыть в полном размере: Изображение 1",
        exact: true,
      });
      await trigger.click();
      const viewer = page.locator(".character-media-viewer");
      const next = viewer.getByRole("button", {
        name: "Следующее изображение",
        exact: true,
      });
      await expect(viewer.getByRole("img")).toHaveAttribute(
        "alt",
        "Изображение 1",
      );
      await next.focus();
      await next.press("Enter");
      await expect(viewer.getByRole("img")).toHaveAttribute(
        "alt",
        "Изображение 2",
      );
      await expect(next).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(viewer.getByRole("img")).toHaveAttribute(
        "alt",
        "Изображение 1",
      );
      await expect(next).toBeFocused();
      for (const b of await viewer.getByRole("button").all()) {
        await expect(b.locator("svg.arken-icon")).toHaveCount(1);
        await expect(b.locator("svg")).toHaveAttribute("aria-hidden", "true");
        await expect(b.locator("svg")).toHaveAttribute("focusable", "false");
        const box = await b.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
        expect(box!.height).toBeGreaterThanOrEqual(width === 360 ? 44 : 24);
      }
      await page.keyboard.press("ArrowRight");
      await expect(viewer.getByRole("img")).toHaveAttribute(
        "alt",
        "Изображение 2",
      );
      await expect(next).toBeFocused();
      await page.screenshot({
        path: info.outputPath(`gallery-${role}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(viewer).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
