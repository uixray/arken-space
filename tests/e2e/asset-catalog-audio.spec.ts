import { readFile } from "node:fs/promises";
import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const width of [1280, 390]) {
  test(`UIX-293 local catalog audio preview ${width}`, async ({
    page,
  }, info) => {
    const bytes = await readFile(
      new URL("../multiplayer/uix642-synthetic-tone.ogg", import.meta.url),
    );
    const current = gmSnapshot({ schemaVersion: 2 });
    current.audio = { ...current.audio, assetId: null, playing: false };
    current.assets = [1, 2].map((n) => ({
      id: `a1111111-1111-4111-8111-11111111111${n}`,
      kind: "AUDIO" as const,
      name: `Звук ${n}.ogg`,
      mimeType: "audio/ogg",
      sizeBytes: bytes.length,
      width: null,
      height: null,
      durationSeconds: 0.7,
      url: `/api/assets/a1111111-1111-4111-8111-11111111111${n}/content?v=1`,
      createdAt: new Date(0).toISOString(),
    }));
    const requests: string[] = [],
      writes: string[] = [],
      commands: string[] = [];
    await page.addInitScript(() => {
      localStorage.setItem("arken.audio.volume", "0");
      localStorage.setItem("arken.audio.enabled", "false");
    });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!["GET", "HEAD"].includes(route.request().method())) {
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        writes.push(path);
        return route.abort();
      }
      if (path === "/api/bootstrap") return route.fulfill({ json: current });
      if (path.endsWith("/content")) {
        requests.push(route.request().url());
        return route.fulfill({ contentType: "audio/ogg", body: bytes });
      }
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      return route.fulfill({ json: [] });
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        if (message.toString() === "40") socket.send('40{"sid":"catalog"}');
        if (message.toString().includes('"audio:set"'))
          commands.push(message.toString());
      });
      socket.send(
        '0{"sid":"catalog-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await openWorkspaceSection(page, "Файлы");
    const files = page.getByRole("dialog", { name: "Файлы", exact: true });
    const rows = files.locator(".asset-row");
    await expect(rows).toHaveCount(2);
    expect(requests).toHaveLength(0);
    await rows
      .nth(0)
      .getByRole("button", { name: "Прослушать", exact: true })
      .click();
    const audio = files.locator("audio");
    await expect(audio).toHaveCount(1);
    expect(
      await audio.evaluate((a: HTMLAudioElement) => ({
        paused: a.paused,
        gain: a.volume,
        preload: a.preload,
      })),
    ).toEqual({ paused: true, gain: 0, preload: "none" });
    expect(requests).toHaveLength(0);
    const box = await audio.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    // Native decode/playback at zero gain; not proof of native control gestures.
    await audio.evaluate((a: HTMLAudioElement) => {
      a.loop = true;
      return a.play();
    });
    await expect
      .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThan(0);
    const old = await audio.elementHandle();
    await rows
      .nth(1)
      .getByRole("button", { name: "Прослушать", exact: true })
      .click();
    await expect(audio).toHaveCount(1);
    await expect(audio).toHaveAccessibleName("Прослушивание: Звук 2.ogg");
    await expect
      .poll(() => old!.evaluate((a: HTMLAudioElement) => a.paused))
      .toBe(true);
    expect(await audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
    await rows.nth(1).getByRole("button", { name: "Закрыть превью" }).click();
    await expect(audio).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(commands).toEqual([]);
    const preferences = await page.evaluate(() => ({
      enabled: localStorage.getItem("arken.audio.enabled"),
      volume: localStorage.getItem("arken.audio.volume"),
    }));
    expect(preferences).toEqual({ enabled: "false", volume: "0" });
    await info.attach("catalog-audio-receipt", {
      body: JSON.stringify({
        width,
        requests,
        preferences,
        writes,
        commands,
        box,
      }),
      contentType: "application/json",
    });
  });
}
