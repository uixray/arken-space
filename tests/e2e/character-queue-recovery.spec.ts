import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import type { Route, WebSocketRoute } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { openWorkspaceSection } from "./workspace-nav-helper";

// Actual App and CharacterWorkspace. HTTP and Socket.IO snapshots are synthetic;
// this checks browser queue behavior, not persistence or authorization on a server.
const character: CharacterDto = {
  id: "64500000-0000-4000-8000-000000000001",
  name: "Проверка очереди",
  ownerMembershipId: null,
  controllerMembershipIds: [],
  portraitAssetId: null,
  stats: { strength: 1 },
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

test("canonical removal rejects queued character edit without phantom PATCH and recovers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let canonical: GameSnapshot = gmSnapshot({ characters: [character] });
  canonical.campaign.statLayout = [
    {
      id: "characteristics",
      label: "Характеристики",
      rows: [{ key: "strength", label: "Сила", source: "STAT" }],
    },
  ];
  const sockets = new Set<WebSocketRoute>();
  const patches: Record<string, unknown>[] = [];
  const unexpected: string[] = [];
  let held: Route | undefined;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    socket.onMessage((message) => {
      if (message.toString() === "40") {
        sockets.add(socket);
        socket.send('40{"sid":"character-queue-socket"}');
      }
    });
    socket.onClose(() => sockets.delete(socket));
    socket.send(
      '0{"sid":"character-queue-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") {
      if (path === "/api/bootstrap") return route.fulfill({ json: canonical });
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (
        path === "/api/player-access" ||
        path === "/api/canvas/history" ||
        path === `/api/characters/${character.id}/media`
      )
        return route.fulfill({ json: [] });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({
          status: 403,
          json: {
            error: "FORBIDDEN",
            message: "Нет доступа к операторскому разделу.",
          },
        });
    }
    if (request.method() === "POST" && path === "/api/client-logs")
      return route.fulfill({ status: 202, body: "" });
    if (
      request.method() === "PATCH" &&
      path === `/api/characters/${character.id}`
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      if (patches.length === 1) {
        held = route;
        return;
      }
      return route.fulfill({
        json: { ...character, revision: 3, stats: body.stats },
      });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.abort("blockedbyclient");
  });
  try {
    await page.goto("/");
    await openWorkspaceSection(page, "Персонажи");
    const heading = page.getByRole("heading", {
      name: character.name,
      exact: true,
    });
    await expect(heading).toBeVisible();
    const strength = page
      .locator(".character-card--stats .stat-field")
      .filter({ has: page.locator("span").filter({ hasText: /^Сила$/ }) })
      .getByRole("spinbutton");
    await strength.fill("5");
    await strength.press("Tab");
    await expect.poll(() => patches.length).toBe(1);
    await expect(strength).toBeEnabled();
    await strength.fill("7");
    await strength.press("Tab");
    await expect(strength).toHaveValue("7");
    // Canonical absence arrives through the legacy-response bootstrap while
    // both real blur edits are in the same App mutation queue.
    canonical = { ...canonical, characters: [], snapshotVersion: 2 };
    expect(held).toBeDefined();
    await held!.fulfill({ json: { duplicate: true } });
    held = undefined;
    await expect(
      page
        .getByText("Персонаж больше недоступен. Обновите список персонажей.", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(heading).toHaveCount(0);
    // Restoration is an authoritative realtime snapshot, not React/DOM injection.
    canonical = {
      ...canonical,
      characters: [{ ...character, revision: 2 }],
      snapshotVersion: 3,
    };
    await expect.poll(() => sockets.size).toBeGreaterThan(0);
    for (const socket of sockets)
      socket.send(`42${JSON.stringify(["game:snapshot", canonical])}`);
    // Removal closes the sheet. Restoring the roster does not reopen it.
    await page
      .getByRole("navigation", { name: "Персонажи кампании" })
      .getByRole("button", { name: character.name, exact: true })
      .click();
    await expect(heading).toBeVisible();
    await expect(strength).toHaveValue("1");
    await strength.fill("9");
    await strength.press("Tab");
    await expect.poll(() => patches.length).toBe(2);
    await expect(strength).toHaveValue("9");
    expect(patches[0]).toMatchObject({ revision: 1, stats: { strength: 5 } });
    expect(patches[1]).toMatchObject({ revision: 2, stats: { strength: 9 } });
    expect(
      patches.some(
        (body) =>
          JSON.stringify(body.stats) === JSON.stringify({ strength: 7 }),
      ),
    ).toBe(false);
    expect(unexpected).toEqual([]);
  } finally {
    if (held) await held.abort("blockedbyclient").catch(() => undefined);
  }
});
