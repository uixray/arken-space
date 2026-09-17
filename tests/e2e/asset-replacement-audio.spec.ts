import { readFile } from "node:fs/promises";
import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";
import {
  paintedIconContrast,
  settleIconState,
} from "./helpers/painted-icon-contrast";
import {
  gmSnapshot,
  playerSnapshot,
} from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const width of [1280, 360]) {
  test(`UIX-645 audio replacement draft removal and cancel ${width}`, async ({
    page,
  }, info) => {
    const bytes = await readFile(
      new URL("../multiplayer/uix642-synthetic-tone.ogg", import.meta.url),
    );
    const current = gmSnapshot({ schemaVersion: 2 });
    const asset = {
      id: "a2222222-2222-4222-8222-222222222222",
      kind: "AUDIO" as const,
      name: "Тема пути.ogg",
      mimeType: "audio/ogg",
      sizeBytes: bytes.length,
      width: null,
      height: null,
      durationSeconds: 0.7,
      url: "/fixture-audio.ogg",
      createdAt: new Date(0).toISOString(),
    };
    current.assets = [asset];
    const writes: string[] = [],
      commands: string[] = [],
      errors: string[] = [];
    let heads = 0,
      usages = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/fixture-audio.ogg", (route) =>
      route.fulfill({ contentType: "audio/ogg", body: bytes }),
    );
    await page.route("**/api/**", (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (req.method() !== "GET" && req.method() !== "HEAD") {
        if (path === "/api/chat/read")
          return route.fulfill({ json: { ok: true } });
        writes.push(`${req.method()} ${path}`);
        return route.abort();
      }
      if (path === "/api/bootstrap") return route.fulfill({ json: current });
      if (
        path === `/api/assets/${asset.id}/content` &&
        req.method() === "HEAD"
      ) {
        heads++;
        return route.fulfill({ headers: { etag: `"${"a".repeat(64)}"` } });
      }
      if (path === `/api/assets/${asset.id}/usage`) {
        usages++;
        return route.fulfill({
          json: {
            asset,
            inUse: false,
            usages: [],
            hiddenUsageCount: 0,
            canDelete: true,
            deletionBlockedReason: null,
          },
        });
      }
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      return route.fulfill({ json: [] });
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        const text = message.toString();
        if (text === "40") socket.send('40{"sid":"audio-draft"}');
        else if (text.startsWith("42")) commands.push(text);
      });
      socket.send(
        '0{"sid":"audio-draft-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await openWorkspaceSection(page, "Файлы");
    const files = page.getByRole("dialog", { name: "Файлы", exact: true });
    const opener = files.getByRole("button", {
      name: "Заменить файл",
      exact: true,
    });
    await opener.click();
    const dialog = page.getByRole("dialog", {
      name: `Заменить файл «${asset.name}»`,
      exact: true,
    });
    const input = dialog.getByLabel("Новый аудиофайл", { exact: true });
    const candidate = {
      name: "draft.ogg",
      mimeType: "audio/ogg",
      buffer: bytes,
    };
    await input.setInputFiles(candidate);
    const remove = dialog.getByRole("button", {
      name: "Удалить draft.ogg",
      exact: true,
    });
    const svg = remove.locator("svg.arken-icon");
    await expect(svg).toBeVisible();
    for (const [attribute, value] of [
      ["aria-hidden", "true"],
      ["focusable", "false"],
      ["stroke", "currentColor"],
      ["stroke-width", "2"],
    ])
      await expect(svg).toHaveAttribute(attribute, value);
    await remove.scrollIntoViewIfNeeded();
    const box = (await remove.boundingBox())!;
    // Read both rectangles in the same frame: the dialog can still be moving.
    const offsets = await remove.evaluate((node) => {
      const b = node.getBoundingClientRect();
      const g = node.querySelector("svg")!.getBoundingClientRect();
      return [
        g.x + g.width / 2 - b.x - b.width / 2,
        g.y + g.height / 2 - b.y - b.height / 2,
      ];
    });
    for (const offset of offsets)
      expect(Math.abs(offset)).toBeLessThanOrEqual(1);
    for (const size of [box.width, box.height])
      expect(Number(size.toFixed(3))).toBeGreaterThanOrEqual(
        width === 360 ? 44 : 24,
      );
    expect(
      await remove.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
    ).toBe(true);
    await page.mouse.move(1, 1);
    await settleIconState(remove);
    const normal = await paintedIconContrast(svg);
    await remove.hover();
    await settleIconState(remove);
    const hover = await paintedIconContrast(svg);
    await page.mouse.move(1, 1);
    await remove.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(remove).toBeFocused();
    expect(
      await remove.evaluate((node) => node.matches(":focus-visible")),
    ).toBe(true);
    await settleIconState(remove);
    const focus = await paintedIconContrast(svg);
    for (const contrast of [normal, hover, focus])
      expect(contrast).toBeGreaterThanOrEqual(3);
    await page.screenshot({
      path: info.outputPath("audio-remove-focused.png"),
    });
    await remove.press("Enter");
    await expect(remove).toHaveCount(0);
    const picker = dialog.getByRole("button", {
      name: "Выбрать файл",
      exact: true,
    });
    await expect(picker).toBeFocused();
    expect(
      await picker.evaluate((node) => node.matches(":focus-visible")),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    expect(heads).toBe(0);
    expect(usages).toBe(0);
    await input.setInputFiles(candidate);
    await expect(remove).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Проверить замену", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Подтвердить замену", exact: true }),
    ).toBeVisible();
    await expect(remove).toBeDisabled();
    await expect(input).toBeDisabled();
    expect(heads).toBe(1);
    expect(usages).toBe(1);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(remove).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Проверить замену", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(commands.filter((command) => command.includes("audio:set"))).toEqual(
      [],
    );
    expect(errors).toEqual([]);
    await info.attach("audio-draft-receipt", {
      body: JSON.stringify({
        width,
        normal,
        hover,
        focus,
        heads,
        usages,
        writes,
        commands,
        errors,
      }),
      contentType: "application/json",
    });
  });
}

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
