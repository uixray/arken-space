import { readFile } from "node:fs/promises";
import { expect, test } from "./react-console-guard";
import {
  gmSnapshot,
  playerSnapshot,
} from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const) {
  test(`UIX-293 mounted audio replacement retains local consent and gain ${role}`, async ({
    page,
  }, info) => {
    const bytes = await readFile(
      new URL("../multiplayer/uix642-synthetic-tone.ogg", import.meta.url),
    );
    const current = (role === "GM" ? gmSnapshot : playerSnapshot)({
      schemaVersion: 2,
    });
    const id = "a1111111-1111-4111-8111-111111111111";
    const url = (version: string) => `/api/assets/${id}/content?v=${version}`;
    current.assets = [
      {
        id,
        kind: "AUDIO",
        name: "Проверка звука.ogg",
        mimeType: "audio/ogg",
        sizeBytes: bytes.length,
        width: null,
        height: null,
        durationSeconds: 0.7,
        url: url("initial"),
        createdAt: new Date(0).toISOString(),
      },
    ];
    current.audio = {
      ...current.audio,
      assetId: id,
      playing: true,
      loop: true,
      positionSeconds: 0,
      startedAt: null,
      revision: 2,
    };
    const originalAudio = structuredClone(current.audio);
    let publish: (() => void) | undefined;
    const requests: string[] = [],
      writes: string[] = [],
      errors: string[] = [],
      commands: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!["GET", "HEAD"].includes(route.request().method())) {
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        writes.push(`${route.request().method()} ${path}`);
        return route.abort();
      }
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      return route.fulfill({ json: [] });
    });
    await page.route("**/api/bootstrap", (route) =>
      route.fulfill({ json: current }),
    );
    await page.route(`**/api/assets/${id}/content?*`, (route) => {
      requests.push(new URL(route.request().url()).searchParams.get("v")!);
      return route.fulfill({ contentType: "audio/ogg", body: bytes });
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        const text = message.toString();
        if (text === "40") {
          socket.send('40{"sid":"audio"}');
          publish = () =>
            socket.send(`42${JSON.stringify(["game:snapshot", current])}`);
        }
        if (text.includes('"audio:set"')) commands.push(text);
      });
      socket.send(
        '0{"sid":"audio-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect.poll(() => Boolean(publish)).toBe(true);
    const audio = page.locator("audio");
    await expect(audio).toHaveCount(1);
    const originalElement = await audio.elementHandle();
    const state = () =>
      audio.evaluate((node) => {
        const a = node as HTMLAudioElement;
        return {
          src: a.currentSrc,
          paused: a.paused,
          volume: a.volume,
          duration: a.duration,
          ready: a.readyState,
          time: a.currentTime,
          error: a.error?.code ?? null,
        };
      });
    await expect
      .poll(async () => (await state()).ready)
      .toBeGreaterThanOrEqual(2);
    expect((await state()).paused).toBe(true);
    const replace = async (version: string) => {
      current.assets = current.assets.map((asset) => ({
        ...asset,
        url: url(version),
      }));
      publish!();
      await expect
        .poll(async () => (await state()).src)
        .toContain(`v=${version}`);
      await expect
        .poll(async () => (await state()).ready)
        .toBeGreaterThanOrEqual(2);
      expect(requests).toContain(version);
      expect((await state()).duration).toBeCloseTo(0.7, 1);
      expect((await state()).error).toBeNull();
    };
    await replace("without-consent");
    expect((await state()).paused).toBe(true);
    const volume = page.getByLabel("Громкость", { exact: true });
    await volume.click();
    const slider = page.getByLabel("Личная громкость", { exact: true });
    await slider.fill("0");
    await expect.poll(async () => (await state()).volume).toBe(0);
    await page
      .getByRole("button", { name: "Включить звук", exact: true })
      .click();
    await expect.poll(async () => (await state()).paused).toBe(false);
    await expect.poll(async () => (await state()).time).toBeGreaterThan(0);
    await replace("playing");
    await expect.poll(async () => (await state()).paused).toBe(false);
    await expect.poll(async () => (await state()).time).toBeGreaterThan(0);
    expect((await state()).volume).toBe(0);
    if (!(await slider.isVisible())) await volume.click();
    await expect(slider).toHaveValue("0");
    await page
      .getByRole("button", { name: "Выключить звук", exact: true })
      .click();
    await expect.poll(async () => (await state()).paused).toBe(true);
    await replace("opted-out");
    expect((await state()).paused).toBe(true);
    expect(
      await audio.evaluate(
        (node, original) => node === original,
        originalElement,
      ),
    ).toBe(true);
    expect(current.audio).toEqual(originalAudio);
    expect(commands).toEqual([]);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    const preferences = await page.evaluate(() => ({
      enabled: localStorage.getItem("arken.audio.enabled"),
      volume: localStorage.getItem("arken.audio.volume"),
    }));
    expect(preferences).toEqual({ enabled: "false", volume: "0" });
    await info.attach("mounted-audio-receipt", {
      body: JSON.stringify({
        role,
        requests,
        state: await state(),
        preferences,
        commands,
        writes,
        errors,
      }),
      contentType: "application/json",
    });
  });
}
