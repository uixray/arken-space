import type { CharacterDto } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [320, 390, 1280]) {
    test(`UIX-672 overfilled resource bars ${role} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 918 });
      const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
      const character: CharacterDto = {
        id: "69500000-0000-4000-8000-000000000002",
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
          physicalPower: { current: 14, maximum: 10 },
          magicPower: { current: 8, maximum: 6 },
        },
        wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
        revision: 1,
        lifecycle: "ACTIVE",
        archivedAt: null,
        archivedByMembershipId: null,
      };
      snapshot.characters = [character];
      snapshot.me.characterId = character.id;
      snapshot.members = snapshot.members.map((member) =>
        member.id === snapshot.me.id
          ? { ...member, characterId: character.id }
          : member,
      );
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
        if (path === "/api/story/posts")
          return route.fulfill({ json: { posts: [], nextCursor: null } });
        if (path === "/api/operator/feedback/capability")
          return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        if (route.request().method() !== "GET")
          return route.fulfill({
            status: 405,
            json: { error: "READ_ONLY_FIXTURE" },
          });
        return route.fulfill({ json: [] });
      });
      await page.routeWebSocket(/\/socket\.io\//, (socket) => {
        socket.onMessage((message) => {
          if (message.toString() === "40")
            socket.send('40{"sid":"resource-overfill"}');
        });
        socket.send(
          '0{"sid":"resource-overfill","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
        );
      });
      await page.goto("/");
      if (width < 800) await page.locator("#compact-nav-journal").click();
      const counters = page.locator("details.resource-counters");
      await expect(counters).toBeVisible();
      if (!(await counters.evaluate((node) => node.hasAttribute("open"))))
        await counters.locator("summary").click();
      const bars = counters.locator(".resource-bar");
      await expect(bars).toHaveCount(2);
      const measures = await bars.evaluateAll((nodes) =>
        nodes.map((node) => {
          const bar = node.getBoundingClientRect();
          const fill = node.querySelector(".resource-bar__fill");
          const overflow = node.querySelector(".resource-bar__overflow");
          if (!fill || !overflow) throw new Error("Missing overfill layers");
          return {
            width: bar.width,
            full: fill.getBoundingClientRect().width,
            overflow: overflow.getBoundingClientRect().width,
            overfillColor: getComputedStyle(overflow).backgroundColor,
            baseColor: getComputedStyle(fill).backgroundColor,
            text: node.getAttribute("aria-valuetext"),
          };
        }),
      );
      expect(Math.abs(measures[0]!.width - measures[1]!.width)).toBeLessThan(1);
      expect(measures[0]!.width).toBeGreaterThan(30);
      for (const [index, expected] of [0.4, 2 / 6].entries()) {
        const bar = measures[index]!;
        expect(bar.full / bar.width).toBeCloseTo(1, 1);
        expect(bar.overflow / bar.width).toBeCloseTo(expected, 1);
        expect(bar.overfillColor).not.toBe(bar.baseColor);
        expect(bar.text).toContain("сверх максимума");
      }
      await expect(
        counters.getByRole("button", { name: "Восстановить 3: Выносливость" }),
      ).toBeDisabled();
      await expect(
        counters.getByRole("button", { name: "Восстановить 2: Мана" }),
      ).toBeDisabled();
      await expect(
        counters.getByRole("button", {
          name: "Вернуть одно очко: Выносливость",
        }),
      ).toBeEnabled();
    });
  }
