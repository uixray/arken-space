import type { WebSocketRoute } from "@playwright/test";
import type { EncounterDto, GameSnapshot } from "@arken/contracts";
import { expect, test } from "./react-console-guard";
import { mockAuthenticatedGameCapabilities } from "./mocked-game-capabilities";
import { fulfillUnmocked } from "./mock-api-contract";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { sidebarWidthStorageKey } from "../../apps/web/src/sidebar-width-preference";

/**
 * UIX-505: the PLAYER sees the turn order only while an encounter is ACTIVE.
 * The block follows the authoritative snapshot — pushed over the socket and
 * re-read on reload — and leaves no gap above the quick controls when hidden.
 */
function encounter(
  campaignId: string,
  status: EncounterDto["status"],
): EncounterDto {
  return {
    id: "50500000-0000-4000-8000-000000000001",
    campaignId,
    sequence: 1,
    status,
    mode: "SCENE_REGION",
    sourceSceneId: "50500000-0000-4000-8000-000000000002",
    targetSceneId: "50500000-0000-4000-8000-000000000002",
    focusRegion: { x: 0, y: 0, width: 200, height: 200 },
    locationId: null,
    sourceSceneRevision: 1,
    initiatorMembershipId: "gm-membership",
    revision: status === "ACTIVE" ? 1 : 2,
    startedAt: "2026-10-17T10:00:00.000Z",
    endedAt: status === "ENDED" ? "2026-10-17T10:30:00.000Z" : null,
    endedByMembershipId: status === "ENDED" ? "gm-membership" : null,
    createdAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-10-17T10:00:00.000Z",
  };
}

for (const [label, sidebarWidth] of [
  ["default", 360],
  ["narrow", 280],
] as const)
  test(`UIX-505 player turn order follows the encounter lifecycle (${label} sidebar)`, async ({
    page,
  }, info) => {
    const base = buildGameSnapshot("PLAYER", { schemaVersion: 2 });
    let current: GameSnapshot = { ...base, encounters: [] };
    const withEncounter = (
      status: EncounterDto["status"] | null,
      revision: number,
    ): GameSnapshot => ({
      ...base,
      campaign: {
        ...base.campaign,
        revision,
        battleActive: status === "ACTIVE",
        initiative:
          status === "ACTIVE"
            ? [
                {
                  id: "50500000-0000-4000-8000-000000000010",
                  tokenId: "50500000-0000-4000-8000-000000000011",
                  name: "Страж ворот",
                  ownName: null,
                  initiative: 14,
                  initiativeBonus: 1,
                  canEdit: false,
                  pinned: false,
                },
              ]
            : [],
      },
      encounters: status ? [encounter(base.campaign.id, status)] : [],
    });

    let socket: WebSocketRoute | undefined;
    const writes: string[] = [];
    await page.addInitScript(
      ([key, width]) => localStorage.setItem(key, String(width)),
      [sidebarWidthStorageKey(base.campaign.id, base.me.id), sidebarWidth] as [
        string,
        number,
      ],
    );
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/chat/read")
        return route.fulfill({ json: { ok: true } });
      if (request.method() !== "GET") {
        writes.push(`${request.method()} ${path}`);
        return route.fulfill({ status: 405, json: { error: "READ_ONLY" } });
      }
      if (path === "/api/bootstrap") return route.fulfill({ json: current });
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      return fulfillUnmocked(route, path);
    });
    await page.routeWebSocket(/\/socket\.io\//, (s) => {
      socket = s;
      s.onMessage((m) => {
        if (m.toString() === "40") s.send('40{"sid":"uix505"}');
      });
      s.send(
        '0{"sid":"uix505","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    const push = (next: GameSnapshot) => {
      current = next;
      socket!.send(`42${JSON.stringify(["game:snapshot", next])}`);
    };

    await page.setViewportSize({ width: 1280, height: 900 });
    await mockAuthenticatedGameCapabilities(page);
    await page.goto("/");

    const feed = page.locator("#chat-panel-activity");
    const panel = page.getByRole("region", { name: "Очередь ходов" });
    const controls = feed.locator(".activity-feed__controls");
    await expect(controls).toBeVisible();
    // The sidebar is laid out at the width this run asked for.
    await expect
      .poll(() => feed.evaluate((node) => node.getBoundingClientRect().width))
      .toBeLessThanOrEqual(sidebarWidth);
    // Distance from the top of the sidebar to the quick controls under it.
    // The controls wrapper is `display: contents`, so measure its children.
    const controlsOffset = () =>
      controls.evaluate(
        (node) =>
          Math.min(
            ...[...node.children].map(
              (child) => child.getBoundingClientRect().top,
            ),
          ) - node.closest("aside")!.getBoundingClientRect().top,
      );

    // Before combat: no block, no focus target, nothing reserved above controls.
    await expect(panel).toHaveCount(0);
    const restingOffset = await controlsOffset();
    expect(restingOffset).toBeLessThan(40);
    await page.screenshot({ path: info.outputPath(`before-${label}.png`) });

    // The GM starts an encounter: the block appears without a reload.
    push(withEncounter("ACTIVE", current.campaign.revision + 1));
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Страж ворот");
    expect(await controlsOffset()).toBeGreaterThan(restingOffset);
    await page.screenshot({ path: info.outputPath(`active-${label}.png`) });

    // Reload derives visibility from the server, not from local UI state.
    await page.reload();
    await expect(panel).toBeVisible();

    // The encounter ends: the block goes away and leaves no gap behind.
    push(withEncounter("ENDED", current.campaign.revision + 1));
    await expect(panel).toHaveCount(0);
    expect(await controlsOffset()).toBe(restingOffset);
    await page.screenshot({ path: info.outputPath(`ended-${label}.png`) });

    await page.reload();
    await expect(controls).toBeVisible();
    await expect(panel).toHaveCount(0);
    expect(writes).toEqual([]);
  });
