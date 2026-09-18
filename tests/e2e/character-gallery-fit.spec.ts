import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 360]) {
    test(`UIX-645 gallery image fit ${role} ${width}`, async ({
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
        caption:
          index === 0
            ? `Панорама_${"длиннаяподпись".repeat(12)}`
            : "Вертикальная иллюстрация",
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
        if (/^\/api\/assets\/[^/]+\/content$/.test(path)) {
          const wide = path.includes(media[0]!.assetId);
          return route.fulfill({
            contentType: "image/svg+xml",
            body: `<svg xmlns="http://www.w3.org/2000/svg" width="${wide ? 1600 : 900}" height="${wide ? 900 : 1600}" viewBox="0 0 ${wide ? 1600 : 900} ${wide ? 900 : 1600}"><rect width="100%" height="100%" fill="#365a70"/><rect x="20" y="20" width="${wide ? 1560 : 860}" height="${wide ? 860 : 1560}" fill="none" stroke="#edd9a4" stroke-width="16"/></svg>`,
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
      const trigger = page.locator(".character-media-gallery__thumb").first();
      await trigger.click();
      const viewer = page.locator(".character-media-viewer");
      const dialog = page.getByRole("dialog");
      for (const index of [0, 1]) {
        const img = viewer.locator("img");
        await expect
          .poll(() =>
            img.evaluate(
              (n) =>
                (n as HTMLImageElement).complete &&
                (n as HTMLImageElement).naturalWidth > 0,
            ),
          )
          .toBe(true);
        await expect(img).toHaveAttribute("alt", media[index]!.caption);
        const geometry = await viewer.evaluate((n) => {
          const b = n.getBoundingClientRect();
          return {
            client: n.clientWidth,
            scroll: n.scrollWidth,
            left: b.left,
            right: b.right,
            viewport: innerWidth,
          };
        });
        expect(geometry.scroll, JSON.stringify(geometry)).toBeLessThanOrEqual(
          geometry.client + 1,
        );
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(width);
        const d = await dialog.boundingBox();
        expect(d!.x).toBeGreaterThanOrEqual(0);
        expect(d!.x + d!.width).toBeLessThanOrEqual(width);
        const next = viewer.getByRole("button", {
          name: "Следующее изображение",
          exact: true,
        });
        await next.scrollIntoViewIfNeeded();
        expect(
          await next.evaluate((n) => {
            const r = n.getBoundingClientRect();
            return n.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`gallery-fit-${role}-${width}-${index}.png`),
        });
        if (index === 0) await next.click();
      }
      await page.keyboard.press("Escape");
      await expect(viewer).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
