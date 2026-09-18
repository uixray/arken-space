import type { Locator, WebSocketRoute } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import {
  paintedIconContrast,
  settleIconState,
} from "./helpers/painted-icon-contrast";

async function icon(
  control: Locator,
  name: string,
  min: number,
  enabled = true,
) {
  await expect(control).toHaveAccessibleName(name);
  const svg = control.locator("svg.arken-icon");
  await expect(svg).toHaveCount(1);
  await expect(svg).toBeVisible();
  for (const [a, v] of [
    ["aria-hidden", "true"],
    ["focusable", "false"],
    ["stroke", "currentColor"],
    ["stroke-width", "2"],
  ])
    await expect(svg).toHaveAttribute(a, v);
  await control.scrollIntoViewIfNeeded();
  const b = (await control.boundingBox())!;
  expect(Number(b.width.toFixed(3))).toBeGreaterThanOrEqual(min);
  expect(Number(b.height.toFixed(3))).toBeGreaterThanOrEqual(min);
  if (enabled) {
    expect(
      await control.evaluate((n) => {
        const r = n.getBoundingClientRect();
        return n.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
    ).toBe(true);
    await control.evaluate((n) => (n as HTMLElement).blur());
    await control.page().mouse.move(1, 849);
    await settleIconState(control);
    expect(await control.evaluate((n) => n.matches(":hover"))).toBe(false);
    expect(await paintedIconContrast(svg)).toBeGreaterThanOrEqual(3);
    await control.hover();
    await settleIconState(control);
    expect(await control.evaluate((n) => n.matches(":hover"))).toBe(true);
    expect(await paintedIconContrast(svg)).toBeGreaterThanOrEqual(3);
    await control.page().mouse.move(1, 849);
    await control.focus();
    await control.page().keyboard.press("Shift+Tab");
    await control.page().keyboard.press("Tab");
    await expect(control).toBeFocused();
    await settleIconState(control);
    expect(
      await control.evaluate((n) => {
        const style = getComputedStyle(n);
        return (
          n.matches(":focus-visible") &&
          ((style.outlineStyle !== "none" &&
            parseFloat(style.outlineWidth) > 0 &&
            style.outlineColor !== "rgba(0, 0, 0, 0)") ||
            style.boxShadow !== "none")
        );
      }),
    ).toBe(true);
    expect(await paintedIconContrast(svg)).toBeGreaterThanOrEqual(3);
  } else await expect(control).toBeDisabled();
  return svg.innerHTML();
}
// Valid silent WAV only supplies metadata. Audio consent stays off: no playback claim.
const wav = Buffer.alloc(44 + 16000);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(16000, 40);
for (const role of ["GM", "PLAYER"] as const)
  test(`UIX-645 music and pause ${role}`, async ({ page }, info) => {
    const snapshot = buildGameSnapshot(role, { schemaVersion: 2 });
    snapshot.scenes = [
      {
        id: "64500000-0000-4000-8000-000000000001",
        name: "Сцена",
        projection: "ORTHOGRAPHIC_2D",
        mapAssetId: null,
        width: 1600,
        height: 1000,
        backgroundFrame: { x: 0, y: 0, width: 1600, height: 1000 },
        grid: {
          enabled: true,
          size: 64,
          offsetX: 0,
          offsetY: 0,
          color: "#c8b78b",
          opacity: 0.22,
        },
        active: true,
      },
    ];
    const assetId = "64500000-0000-4000-8000-000000000099";
    snapshot.assets = [
      {
        id: assetId,
        kind: "AUDIO",
        name: "Тема путешествия",
        url: "/fixture-track.wav",
        mimeType: "audio/wav",
        sizeBytes: wav.length,
        width: null,
        height: null,
        durationSeconds: 1,
        createdAt: new Date(0).toISOString(),
      },
    ];
    let socket: WebSocketRoute | undefined;
    const commands: Array<Record<string, unknown>> = [],
      writes: string[] = [],
      errors: string[] = [];
    const pauseRequests: Array<Record<string, unknown>> = [];
    const pauseRevision = snapshot.campaign.revision;
    let releasePause!: () => void;
    const pausePending = new Promise<void>((r) => {
      releasePause = r;
    });
    const sendAudio = () => {
      snapshot.snapshotVersion++;
      socket!.send(
        "42" +
          JSON.stringify([
            "audio:state",
            { sequence: snapshot.snapshotVersion, data: snapshot.audio },
          ]),
      );
    };
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/fixture-track.wav", (r) =>
      r.fulfill({ contentType: "audio/wav", body: wav }),
    );
    await page.route("**/api/**", async (route) => {
      const r = route.request(),
        path = new URL(r.url()).pathname;
      if (path === "/api/campaign/pause" && r.method() === "POST") {
        pauseRequests.push(r.postDataJSON());
        await pausePending;
        snapshot.campaign.paused = r.postDataJSON().paused;
        snapshot.campaign.revision++;
        snapshot.snapshotVersion++;
        return route.fulfill({ json: { ok: true } });
      }
      if (path === "/api/chat/read")
        return route.fulfill({ json: { ok: true } });
      if (r.method() !== "GET") {
        writes.push(`${r.method()} ${path}`);
        return route.fulfill({
          status: 405,
          json: { error: "READ_ONLY_FIXTURE" },
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
      socket = s;
      s.onMessage((m) => {
        const raw = m.toString();
        if (raw === "40") {
          s.send('40{"sid":"music-icons"}');
          return;
        }
        const match = raw.match(/^42(\d*)\[/);
        if (!match) return;
        const [event, data] = JSON.parse(raw.slice(2 + match[1].length));
        if (event !== "audio:set") return;
        commands.push(data);
        if (data.command === "PLAY" || data.command === "PAUSE")
          snapshot.audio = {
            ...snapshot.audio,
            playing: data.command === "PLAY",
            revision: snapshot.audio.revision + 1,
          };
        sendAudio();
        if (match[1]) s.send(`43${match[1]}[{"ok":true,"status":"APPLIED"}]`);
      });
      s.send(
        '0{"sid":"music-icons","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    try {
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.goto("/");
      const music = page.getByRole("region", { name: "Музыка" });
      const playback = music.locator(".music-icon-button"),
        volume = music.locator(".music-volume-control > summary"),
        menu = music.locator(".music-overflow > summary");
      const playGlyph = await icon(playback, "Играть", 24, false);
      snapshot.audio = {
        ...snapshot.audio,
        assetId,
        playing: false,
        revision: 1,
      };
      await expect.poll(() => Boolean(socket)).toBe(true);
      sendAudio();
      if (role === "GM") {
        await expect(playback).toBeEnabled();
        await icon(playback, "Играть", 24);
        await playback.focus();
        await playback.press("Enter");
        await expect(playback).toHaveAccessibleName("Пауза");
        expect(await icon(playback, "Пауза", 24)).not.toBe(playGlyph);
        await playback.press("Enter");
        await expect(playback).toHaveAccessibleName("Играть");
        expect(commands.map((c) => c.command)).toEqual(["PLAY", "PAUSE"]);
        await icon(menu, "Меню музыки", 24);
        await menu.focus();
        await menu.press("Enter");
        await expect(
          music.getByRole("button", { name: "Тема путешествия", exact: true }),
        ).toBeVisible();
        await menu.press("Escape");
        await expect(menu).toBeFocused();
      } else {
        await expect(playback).toBeDisabled();
        await expect(menu).toHaveCount(0);
        snapshot.audio = { ...snapshot.audio, playing: true, revision: 2 };
        sendAudio();
        await expect(playback).toHaveAccessibleName("Пауза");
        expect(await icon(playback, "Пауза", 24, false)).not.toBe(playGlyph);
      }
      await icon(volume, "Громкость", 24);
      await volume.focus();
      await volume.press("Enter");
      const slider = music.getByRole("slider", { name: "Личная громкость" });
      await slider.focus();
      await slider.press("Home");
      await slider.press("ArrowRight");
      await expect(slider).toHaveValue("0.05");
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem("arken.audio.volume")),
        )
        .toBe("0.05");
      await slider.press("Escape");
      await expect(volume).toBeFocused();
      await page.screenshot({
        path: info.outputPath(`music-${role}-1280.png`),
      });
      await volume.press("Enter");
      await slider.focus();
      await page.setViewportSize({ width: 360, height: 850 });
      // P1 deliberately hides MusicBar; do not expose it or bypass role/layout rules.
      await expect(music).toBeHidden();
      await expect(page.locator(".music-volume-control")).not.toHaveAttribute(
        "open",
        "",
      );
      expect(
        await page.evaluate(() => {
          const n = document.activeElement as HTMLElement | null;
          return !n?.closest(".music-topbar") || n.getClientRects().length > 0;
        }),
        "Focus must not stay in a hidden music control",
      ).toBe(true);
      if (role === "GM") {
        const start = page.getByRole("button", {
          name: "Начать перерыв",
          exact: true,
        });
        const collapse = page.locator(".map-toolbar__collapse");
        if ((await collapse.getAttribute("aria-expanded")) === "true")
          await collapse.click();
        await expect(start.locator(".game-pause-control__label")).toBeHidden();
        await icon(start, "Начать перерыв", 44);
        await start.focus();
        await start.press("Enter");
        await expect.poll(() => pauseRequests.length).toBe(1);
        expect(pauseRequests[0]).toMatchObject({
          paused: true,
          revision: pauseRevision,
        });
        expect(pauseRequests[0].actionId).toMatch(/^[0-9a-f-]{36}$/);
        await expect(start).toBeDisabled();
        releasePause();
        await expect(
          page.getByRole("heading", { name: "Перерыв", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Продолжить игру", exact: true }),
        ).toBeVisible();
      } else {
        await expect(
          page.getByRole("button", { name: "Начать перерыв", exact: true }),
        ).toHaveCount(0);
        snapshot.campaign.paused = true;
        snapshot.snapshotVersion++;
        socket!.send("42" + JSON.stringify(["game:snapshot", snapshot]));
        await expect(
          page.getByRole("heading", { name: "Перерыв", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Продолжить игру", exact: true }),
        ).toHaveCount(0);
        expect(commands).toEqual([]);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`music-pause-${role}-360.png`),
      });
      expect(pauseRequests).toHaveLength(role === "GM" ? 1 : 0);
      expect(commands.map((c) => c.command)).toEqual(
        role === "GM" ? ["PLAY", "PAUSE"] : [],
      );
      await info.attach("music-pause-commands", {
        body: JSON.stringify({ commands, pauseRequests, writes, errors }),
        contentType: "application/json",
      });
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      releasePause();
    }
  });
