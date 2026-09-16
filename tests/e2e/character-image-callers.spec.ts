import { type Locator } from "@playwright/test";
import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 390])
    test(`UIX-644 character image callers ${role} ${width}`, async ({
      page,
    }, testInfo) => {
      const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
      const id = "69200000-0000-4000-8000-000000000001";
      const character: CharacterDto = {
        id,
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
        resources: { Заря: { current: 3, maximum: 5, recoverable: true } },
        wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
        revision: 1,
        lifecycle: "ACTIVE",
        archivedAt: null,
        archivedByMembershipId: null,
      };
      snapshot.characters = [character];
      snapshot.me.characterId = id;
      snapshot.members = snapshot.members.map((m) =>
        m.id === snapshot.me.id ? { ...m, characterId: id } : m,
      );
      snapshot.assets = [
        { kind: "PORTRAIT" as const, name: "Портрет хранителя" },
        { kind: "IMAGE" as const, name: "Знак зари" },
      ].map((a, i) => ({
        ...a,
        id: `69200000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
        mimeType: "image/svg+xml",
        sizeBytes: 128,
        width: 64,
        height: 64,
        durationSeconds: null,
        url: `/api/assets/image-${i}/content`,
        createdAt: new Date(0).toISOString(),
      }));
      const writes: { path: string; body: Record<string, unknown> }[] = [],
        unexpected: string[] = [],
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.routeWebSocket(/\/socket\.io\//, (s) => {
        s.onMessage((m) => {
          if (m.toString() === "40") s.send('40{"sid":"character-images"}');
        });
        s.send(
          '0{"sid":"character-images","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
        );
      });
      await page.route("**/api/**", async (route) => {
        const r = route.request(),
          path = new URL(r.url()).pathname;
        if (path === "/api/operator/feedback/capability")
          return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
        if (r.method() === "GET") {
          if (path === "/api/bootstrap")
            return route.fulfill({ json: snapshot });
          if (path === "/api/story/posts")
            return route.fulfill({ json: { posts: [], nextCursor: null } });
          if (path.endsWith("/content"))
            return route.fulfill({
              contentType: "image/svg+xml",
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#637d72"/></svg>',
            });
          return route.fulfill({ json: [] });
        }
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        if (
          r.method() === "PATCH" &&
          [`/api/characters/${id}`, `/api/characters/${id}/counters`].includes(
            path,
          )
        ) {
          const body = r.postDataJSON();
          writes.push({ path, body });
          Object.assign(character, body, { revision: character.revision + 1 });
          return route.fulfill({ json: character });
        }
        unexpected.push(`${r.method()} ${path}`);
        return route.fulfill({
          status: 405,
          json: { error: "UNEXPECTED_MUTATION" },
        });
      });
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await openWorkspaceSection(page, "Персонажи");
      const sheet = page.getByRole("article", {
        name: "Лист персонажа Хранитель",
        exact: true,
      });
      const portrait = sheet.getByRole("group", {
        name: "Портрет персонажа",
        exact: true,
      });
      const resource = sheet.getByRole("group", {
        name: "Изображение ресурса Заря",
        exact: true,
      });
      async function hit(tile: Locator) {
        await tile.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            tile.evaluate((el) => {
              const r = el.getBoundingClientRect();
              return el.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              );
            }),
          )
          .toBe(true);
        await tile.click();
      }
      await expect(
        portrait.getByRole("button", { name: "Знак зари", exact: true }),
      ).toHaveCount(0);
      const portraitTile = portrait.getByRole("button", {
        name: "Портрет хранителя",
        exact: true,
      });
      await hit(portraitTile);
      await expect(portraitTile).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({
        path: `/api/characters/${id}`,
        body: { revision: 1, portraitAssetId: snapshot.assets[0].id },
      });
      await expect(
        resource.getByRole("button", { name: "Без изображения", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const icon = resource.getByRole("button", {
        name: "Знак зари",
        exact: true,
      });
      await hit(icon);
      await expect(icon).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[1]).toMatchObject({
        path: `/api/characters/${id}/counters`,
        body: {
          revision: 2,
          resources: {
            Заря: {
              current: 3,
              maximum: 5,
              recoverable: true,
              imageAssetId: snapshot.assets[1].id,
            },
          },
        },
      });
      await expect(portraitTile).toHaveAttribute("aria-pressed", "true");
      // Arrow navigation changes focus only; Enter commits removal of the resource image.
      await page.keyboard.press("ArrowRight");
      const none = resource.getByRole("button", {
        name: "Без изображения",
        exact: true,
      });
      await expect(none).toBeFocused();
      expect(writes).toHaveLength(2);
      await page.keyboard.press("Enter");
      await expect(none).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => writes.length).toBe(3);
      expect(writes[2]).toMatchObject({
        body: {
          revision: 3,
          resources: {
            Заря: {
              current: 3,
              maximum: 5,
              recoverable: true,
              imageAssetId: null,
            },
          },
        },
      });
      await page.reload();
      await openWorkspaceSection(page, "Персонажи");
      await expect(portraitTile).toHaveAttribute("aria-pressed", "true");
      await expect(none).toHaveAttribute("aria-pressed", "true");
      expect(character.resources.Заря).toMatchObject({
        current: 3,
        maximum: 5,
        recoverable: true,
        imageAssetId: null,
      });
      expect(writes).toHaveLength(3);
      expect(unexpected).toEqual([]);
      expect(errors).toEqual([]);
      await testInfo.attach("character-image-receipt", {
        body: JSON.stringify({ role, width, writes, unexpected, errors }),
        contentType: "application/json",
      });
    });
