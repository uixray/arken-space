import { expect, test } from "./react-console-guard";
import { gmSnapshot, playerSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const width of [1280, 390]) {
  test(`UIX-382 GM mixer and PLAYER local master boundary at ${width}px`, async ({ page }) => {
    const snapshot = gmSnapshot({ schemaVersion: 2 });
    const audio = [1, 2].map((n) => ({
      id: `a1111111-1111-4111-8111-11111111111${n}`, kind: "AUDIO" as const,
      name: `Tone ${n}`, mimeType: "audio/ogg", sizeBytes: 100,
      width: null, height: null, durationSeconds: 2,
      url: `/api/assets/a1111111-1111-4111-8111-11111111111${n}/content?v=1`,
      createdAt: new Date(0).toISOString(),
    }));
    snapshot.assets = audio;
    snapshot.audioTracks = audio.map((asset, i) => ({
      id: `b1111111-1111-4111-8111-11111111111${i + 1}`, assetId: asset.id,
      mixVolume: 0.8, playing: false, positionSeconds: 0, loop: false,
      startedAt: null, slotOrder: i, revision: 1, updatedAt: new Date(0).toISOString(),
    }));
    const commands: string[] = [];
    await page.addInitScript(() => localStorage.setItem("arken.audio.enabled", "false"));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
      if (path === "/api/story/posts") return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/operator/feedback/capability") return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      if (!["GET", "HEAD"].includes(route.request().method())) return route.abort();
      return route.fulfill({ json: [] });
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        const value = message.toString();
        if (value === "40") socket.send('40{"sid":"mixer"}');
        if (value.includes("audio:track:set")) commands.push(value);
      });
      socket.send('0{"sid":"mixer-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}');
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    if (width <= 600) await page.getByRole("button", { name: "Меню", exact: true }).click();
    await expect(page.locator("audio")).toHaveCount(2);
    await page.locator(".music-overflow summary").click();
    await page.getByRole("button", { name: "Открыть библиотеку" }).click();
    const dialog = page.getByRole("dialog", { name: "Музыкальная библиотека" });
    await expect(dialog.getByRole("heading", { name: "Микшер · до 4 дорожек" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Убрать" })).toHaveCount(2);
    await dialog.getByRole("button", { name: "Играть" }).first().click();
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0]).toContain("audio:track:set");
    expect(commands[0]).toContain("PLAY");
  });

  test(`UIX-382 PLAYER master never emits campaign audio commands at ${width}px`, async ({ page }) => {
    const snapshot = playerSnapshot({ schemaVersion: 2 });
    snapshot.assets = [{ id: "a1111111-1111-4111-8111-111111111111", kind: "AUDIO", name: "Tone", mimeType: "audio/ogg", sizeBytes: 100, width: null, height: null, durationSeconds: 2, url: "/tone.ogg", createdAt: new Date(0).toISOString() }];
    snapshot.audioTracks = [{ id: "b1111111-1111-4111-8111-111111111111", assetId: snapshot.assets[0].id, mixVolume: 1, playing: true, positionSeconds: 0, loop: false, startedAt: null, slotOrder: 0, revision: 1, updatedAt: new Date(0).toISOString() }];
    const commands: string[] = [];
    await page.addInitScript(() => localStorage.setItem("arken.audio.enabled", "false"));
    await page.route("**/api/**", (route) => new URL(route.request().url()).pathname === "/api/bootstrap" ? route.fulfill({ json: snapshot }) : route.fulfill({ json: [] }));
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => { const value = message.toString(); if (value === "40") socket.send('40{"sid":"player"}'); if (value.includes("audio:track:set") || value.includes('"audio:set"')) commands.push(value); });
      socket.send('0{"sid":"player-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}');
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator("audio")).toHaveCount(1);
    if (width <= 600) await page.getByRole("button", { name: "Меню", exact: true }).click();
    await page.locator(".music-volume-control summary").click();
    const master = page.getByRole("slider", { name: "Личная громкость" });
    await master.focus();
    for (let step = 0; step < 5; step += 1) await master.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("arken.audio.volume"))).toBe("0.25");
    await expect.poll(() => commands.length).toBe(0);
  });
}
