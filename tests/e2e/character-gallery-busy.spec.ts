import type { Route } from "@playwright/test";
import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 gallery reorder busy ${role} ${width}`, async ({
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
      let pending: Route | undefined;
      const reorderCalls: string[] = [];
      const writes: string[] = [],
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        if (path.endsWith("/reorder") && request.method() === "POST") {
          reorderCalls.push(path);
          pending = route;
          return;
        }
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
      const gallery = page.locator(".character-media-gallery");
      const controls = gallery.locator(
        ".character-media-gallery__actions button",
      );
      await gallery
        .getByRole("button", { name: "Переместить ниже", exact: true })
        .first()
        .click();
      await expect.poll(() => reorderCalls.length).toBe(1);
      for (const button of await controls.all())
        await expect(button).toBeDisabled();
      await page.screenshot({
        path: info.outputPath(`gallery-busy-${role}-${width}.png`),
      });
      await pending!.fulfill({
        status: 503,
        json: { error: "BUSY_FIXTURE_REFUSAL" },
      });
      await expect(gallery.getByRole("alert")).toBeVisible();
      for (const button of await gallery
        .getByRole("button", { name: "Изменить", exact: true })
        .all())
        await expect(button).toBeEnabled();
      await expect(
        gallery
          .getByRole("button", { name: "Переместить ниже", exact: true })
          .first(),
      ).toBeEnabled();
      expect(reorderCalls).toHaveLength(1);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
