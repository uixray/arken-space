import type { AssetDto, CommandAck, GameSnapshot } from "@arken/contracts";
import { writeFile } from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./react-console-guard";
import { gmSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

// Real App/api/MusicBar/socket.io client/Gravity notifications. Only HTTP and
// Engine.IO/Socket.IO transport boundaries are synthetic: no real server,
// author data, production hook, media decoding or mutation is used here.
const networkMessage =
  "Не удалось связаться с сервером. Проверьте подключение и повторите попытку.";
const audioMessage = "Состояние музыки изменилось. Повторите команду.";
const audioAsset: AssetDto = {
  id: "41700000-0000-4000-8000-000000000101",
  kind: "AUDIO",
  name: "Waterdeep.ogg",
  mimeType: "audio/ogg",
  sizeBytes: 1024,
  width: null,
  height: null,
  durationSeconds: 120,
  url: "/api/assets/41700000-0000-4000-8000-000000000101/content",
  createdAt: "2026-09-08T00:00:00.000Z",
};

function errorSnapshot(): GameSnapshot {
  const snapshot = gmSnapshot({ assets: [audioAsset] });
  snapshot.campaign.id = "41700000-0000-4000-8000-000000000102";
  snapshot.campaign.name = "Проверка сообщений об ошибках";
  snapshot.me.id = "41700000-0000-4000-8000-000000000103";
  snapshot.members = [snapshot.me];
  // Nothing is selected or playing: the test sends SELECT through the real
  // menu, but rejection must not start playback or fetch/decode the audio.
  snapshot.audio.revision = 7;
  return snapshot;
}

type CommandReceipt = {
  event: string;
  command: Record<string, unknown>;
  acknowledgementId: string;
  acknowledgement: CommandAck;
};

async function installErrorFixture(page: Page, initiallyOffline: boolean) {
  const snapshot = errorSnapshot();
  const pendingAcknowledgements: Array<() => void> = [];
  const state = {
    rejectBootstrap: initiallyOffline,
    bootstrapAttempts: 0,
    failedBootstrapRequests: 0,
    socketConnections: 0,
    blockedWrites: [] as string[],
    unexpectedReads: [] as string[],
    unexpectedSocketEvents: [] as string[],
    pageErrors: [] as string[],
    commands: [] as CommandReceipt[],
    acknowledgementsSent: 0,
    releaseAudioAcknowledgements(): void {
      for (const send of pendingAcknowledgements.splice(0)) send();
    },
  };
  page.on("pageerror", (error) => state.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/api/bootstrap")
      state.failedBootstrapRequests += 1;
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    // Existing concept.spec.ts transport pattern: no connectToServer call.
    socket.onMessage((message) => {
      const packet = message.toString();
      if (packet === "40") {
        state.socketConnections += 1;
        socket.send('40{"sid":"russian-copy-socket"}');
        return;
      }
      if (!packet.startsWith("42")) return;
      const payloadStart = packet.indexOf("[");
      if (payloadStart < 0) return;
      const [event, command] = JSON.parse(packet.slice(payloadStart)) as [
        string,
        Record<string, unknown>,
      ];
      // Scene view/cursor lifecycle packets carry no authoritative mutations.
      if (["scene:view", "cursor:gone"].includes(event)) return;
      if (event !== "audio:set") {
        state.unexpectedSocketEvents.push(event);
        return;
      }
      const acknowledgementId = packet.slice(2, payloadStart);
      const acknowledgement: CommandAck = {
        ok: false,
        status: "CONFLICT",
        reason: "REVISION_CONFLICT",
      };
      state.commands.push({
        event,
        command,
        acknowledgementId,
        acknowledgement,
      });
      if (acknowledgementId)
        pendingAcknowledgements.push(() => {
          socket.send(
            `43${acknowledgementId}${JSON.stringify([acknowledgement])}`,
          );
          state.acknowledgementsSent += 1;
        });
    });
    socket.send(
      '0{"sid":"russian-copy-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
    );
  });
  // Never allow polling fallback to reach a real campaign either.
  await page.route("**/socket.io/**", (route) =>
    route.abort("blockedbyclient"),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method !== "GET" && method !== "HEAD") {
      state.blockedWrites.push(`${method} ${path}`);
      return route.abort("blockedbyclient");
    }
    if (path === "/api/bootstrap") {
      state.bootstrapAttempts += 1;
      if (state.rejectBootstrap) return route.abort("failed");
      return route.fulfill({ json: snapshot });
    }
    if (path === "/api/story/posts")
      return route.fulfill({ json: { posts: [], nextCursor: null } });
    if (path === "/api/operator/feedback/capability")
      return route.fulfill({
        status: 403,
        json: { error: "FORBIDDEN", message: "Доступ запрещён" },
      });
    if (
      ["/api/player-access", "/api/stickers", "/api/world-content"].includes(
        path,
      )
    )
      return route.fulfill({ json: [] });
    state.unexpectedReads.push(`${method} ${path}`);
    return route.abort("blockedbyclient");
  });
  return state;
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function expectTextFits(target: Locator) {
  await expect(target).toBeVisible();
  const geometry = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = [...range.getClientRects()];
    const inside = (rect: DOMRect) =>
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= innerWidth + 1 &&
      rect.bottom <= innerHeight + 1;
    return {
      boxVisible: inside(box),
      textVisible: text.length > 0 && text.every(inside),
      textFits: text.every(
        (rect) =>
          rect.left >= box.left - 1 &&
          rect.right <= box.right + 1 &&
          rect.top >= box.top - 1 &&
          rect.bottom <= box.bottom + 1,
      ),
    };
  });
  expect(geometry).toEqual({
    boxVisible: true,
    textVisible: true,
    textFits: true,
  });
}

async function attachReceipt(
  testInfo: TestInfo,
  state: Awaited<ReturnType<typeof installErrorFixture>>,
) {
  const path = testInfo.outputPath("error-copy-receipt.json");
  await writeFile(path, JSON.stringify(state, null, 2));
  await testInfo.attach("error-copy-receipt", {
    path,
    contentType: "application/json",
  });
}

function expectIsolated(
  state: Awaited<ReturnType<typeof installErrorFixture>>,
) {
  // The known automatic read marker is still blocked, not executed or ignored
  // as an arbitrary write. Every other unexpected API/socket mutation fails.
  expect(
    state.blockedWrites.filter((write) => write !== "POST /api/chat/read"),
  ).toEqual([]);
  expect(state.unexpectedReads).toEqual([]);
  expect(state.unexpectedSocketEvents).toEqual([]);
  expect(state.pageErrors).toEqual([]);
}

for (const width of [1280, 390]) {
  test(`Russian API network failure and real retry at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installErrorFixture(page, true);
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const description = page.locator("main.loading .arken-state p");
      const retry = page.getByRole("button", {
        name: "Повторить",
        exact: true,
      });
      await expect(description).toBeVisible();
      await expect(retry).toBeVisible();
      await expect
        .poll(() => fixture.failedBootstrapRequests)
        .toBeGreaterThan(0);
      await screenshot(page, testInfo, `network-error-${width}`);
      // Intended baseline FAIL: browser's native fetch rejection reaches the
      // actual App ErrorState in English. Do not replace this with a regex.
      expect(await description.innerText()).toBe(networkMessage);
      await expectTextFits(description);
      const attemptsBeforeRetry = fixture.bootstrapAttempts;
      fixture.rejectBootstrap = false;
      await retry.click();
      await expect(page.locator(".app-shell")).toBeVisible();
      await expect(page.locator("main.loading")).toHaveCount(0);
      expect(fixture.bootstrapAttempts).toBeGreaterThan(attemptsBeforeRetry);
      await expect(page.getByText(networkMessage, { exact: true })).toHaveCount(
        0,
      );
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
      await screenshot(page, testInfo, `network-recovered-${width}`);
      expectIsolated(fixture);
      expect(fixture.commands).toEqual([]);
    } finally {
      await attachReceipt(testInfo, fixture);
    }
  });

  test(`Russian audio ACK notification preserves wire codes at ${width}px`, async ({
    page,
  }, testInfo) => {
    // Compact intentionally hides music controls. A real desktop action may
    // still receive its delayed ACK after switching to a narrow viewport.
    await page.setViewportSize({ width: 1280, height: 900 });
    const fixture = await installErrorFixture(page, false);
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const music = page.locator("section.music-topbar");
      await expect(music).toBeVisible();
      await expect.poll(() => fixture.socketConnections).toBeGreaterThan(0);
      await music.getByLabel("Меню музыки", { exact: true }).click();
      await music
        .getByRole("button", { name: audioAsset.name, exact: true })
        .click();
      await expect.poll(() => fixture.commands.length).toBe(1);
      expect(fixture.acknowledgementsSent).toBe(0);
      if (width === 390) {
        await page.setViewportSize({ width, height: 900 });
        await expect(music).toBeHidden();
      }
      fixture.releaseAudioAcknowledgements();
      expect(fixture.acknowledgementsSent).toBe(1);
      const toast = page
        .locator(".g-toast")
        .filter({ hasText: "Не удалось изменить музыку" });
      await expect(toast).toBeVisible();
      const toastText = await toast.innerText();
      await expectTextFits(toast);
      await screenshot(page, testInfo, `audio-error-${width}`);
      // Intended baseline FAIL: the actual ACK callback exposes the raw code.
      expect(toastText).toContain(audioMessage);
      expect(toastText).not.toContain("REVISION_CONFLICT");
      expect(fixture.commands[0]).toEqual({
        event: "audio:set",
        command: {
          command: "SELECT",
          assetId: audioAsset.id,
          revision: 7,
          actionId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        },
        acknowledgementId: expect.stringMatching(/^\d+$/),
        acknowledgement: {
          ok: false,
          status: "CONFLICT",
          reason: "REVISION_CONFLICT",
        },
      });
      // The rejection does not select/play the requested track optimistically.
      await expect(
        music.getByRole("button", {
          name: "Играть",
          exact: true,
          includeHidden: true,
        }),
      ).toBeDisabled();
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
      expectIsolated(fixture);
    } finally {
      await attachReceipt(testInfo, fixture);
    }
  });
}
