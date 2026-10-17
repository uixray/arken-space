import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { GameSnapshot, SoundpadPackDto } from "@arken/contracts";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";

test.skip(
  process.env.ARKEN_ASSET_LIVE_GATE !== "isolated-loopback",
  "Dedicated isolated loopback database/server required; see UIX-293 acceptance runbook",
);

/**
 * UIX-512: the soundpad end to end on a real server and database. The GM
 * builds a pack through the UI, a player joins by invite, and both clients
 * record which effect URLs they actually start. `HTMLMediaElement.play` is
 * replaced by a recorder so the headless browser's autoplay policy cannot
 * decide the result; the event flow, dedupe and local bus are the real ones.
 */
const SOUND_FILE = "Удар-по-столу.ogg";
const SOUND_LABEL = "Удар-по-столу";

declare global {
  interface Window {
    __soundPlays: string[];
  }
}

async function recordPlays(page: Page) {
  await page.addInitScript(() => {
    window.__soundPlays = [];
    HTMLMediaElement.prototype.play = function play() {
      window.__soundPlays.push(this.src);
      return Promise.resolve();
    };
  });
}

const playsOf = (page: Page, url: string) =>
  page.evaluate(
    (target) =>
      window.__soundPlays.filter((src) => new URL(src).pathname === target)
        .length,
    url,
  );

async function enterAsGm(page: Page, gmToken: string) {
  await page.goto(`/gm/${gmToken}`);
  await page
    .getByRole("button", {
      name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
      exact: true,
    })
    .click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function joinAsPlayer(
  browser: Browser,
  baseURL: string,
  gm: Page,
  width: number,
) {
  const initial = (await (
    await gm.request.get("/api/bootstrap")
  ).json()) as GameSnapshot;
  const inviteResponse = await gm.request.post("/api/invites", {
    data: {
      actionId: randomUUID(),
      characterId: initial.characters[0].id,
      label: "Саундпад",
      expiresInHours: 1,
    },
  });
  await expect(inviteResponse).toBeOK();
  const invite = (await inviteResponse.json()) as { url: string };
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: width < 768 ? 844 : 900 },
  });
  const player = await context.newPage();
  await recordPlays(player);
  await player.goto(new URL(invite.url).pathname);
  await player.getByLabel(/^Имя(?: в кампании)?$/).fill("Слушатель");
  await player
    .getByRole("button", {
      name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
      exact: true,
    })
    .click();
  await expect(player.locator(".app-shell")).toBeVisible();
  return { context, player };
}

async function openSoundpad(page: Page) {
  const launcher = page.getByRole("button", { name: "Саундпад", exact: true });
  // The compact shell hides its header on the map; the journal shows it.
  if (!(await launcher.isVisible()))
    await page.getByRole("button", { name: "Журнал", exact: true }).click();
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Саундпад" });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const width of [1280, 390] as const)
  test(`UIX-512 GM pack reaches a connected PLAYER once, respects audience, policy and mute (${width}px player)`, async ({
    page,
    browser,
    gmToken,
  }, info) => {
    expect(process.env.ARKEN_ASSET_LIVE_GATE).toBe("isolated-loopback");
    expect(new URL(info.project.use.baseURL!).hostname).toBe("127.0.0.1");
    const bytes = await readFile(
      new URL("../multiplayer/uix642-synthetic-tone.ogg", import.meta.url),
    );
    await recordPlays(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterAsGm(page, gmToken);

    // The GM builds and publishes a pack through the real manager UI.
    const gmPad = await openSoundpad(page);
    await expect(
      gmPad.getByRole("button", { name: "Остановить эффекты" }),
    ).toBeVisible();
    await gmPad.getByText("Управление паками", { exact: true }).click();
    await gmPad.getByLabel("Название пака").fill("Таверна");
    await gmPad
      .getByRole("button", { name: "Создать пак", exact: true })
      .click();
    await gmPad.getByLabel("Загрузить аудиофайл (до 10 секунд)").setInputFiles({
      name: SOUND_FILE,
      mimeType: "audio/ogg",
      buffer: bytes,
    });
    const gmSound = gmPad.getByRole("button", {
      name: `Запустить звук: ${SOUND_LABEL}`,
    });
    await expect(gmSound).toBeVisible();
    await gmPad
      .getByRole("button", { name: "Опубликовать пак", exact: true })
      .click();
    await expect(
      gmPad.getByRole("button", { name: "Скрыть пак", exact: true }),
    ).toBeVisible();

    const catalogue = (await (
      await page.request.get("/api/soundpad")
    ).json()) as { packs: SoundpadPackDto[] };
    const [sound] = catalogue.packs.flatMap((pack) => pack.sounds);
    expect(sound?.label).toBe(SOUND_LABEL);
    const snapshot = (await (
      await page.request.get("/api/bootstrap")
    ).json()) as GameSnapshot;
    const asset = snapshot.assets.find((item) => item.id === sound!.assetId);
    expect(asset?.audioPurpose).toBe("SOUND_EFFECT");
    const soundUrl = new URL(asset!.url, info.project.use.baseURL).pathname;

    const { context, player } = await joinAsPlayer(
      browser,
      info.project.use.baseURL!,
      page,
      width,
    );
    try {
      const playerPad = await openSoundpad(player);
      await expect(
        playerPad.getByRole("button", { name: "Остановить эффекты" }),
      ).toHaveCount(0);
      await expect(
        playerPad.getByText("Управление паками", { exact: true }),
      ).toHaveCount(0);
      const playerSound = playerPad.getByRole("button", {
        name: `Запустить звук: ${SOUND_LABEL}`,
      });
      await expect(playerSound).toBeVisible();
      if (width < 768) {
        // The pad fits a phone: the sound is reachable and nothing scrolls sideways.
        const box = (await playerSound.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(
          await player.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }

      // A burst from the player is one event: the member cooldown drops the
      // repeats, and each client starts the effect exactly once.
      await playerSound.click();
      await playerSound.click();
      await playerSound.click();
      await expect.poll(() => playsOf(player, soundUrl)).toBe(1);
      await expect.poll(() => playsOf(page, soundUrl)).toBe(1);
      await page.waitForTimeout(2500);
      expect(await playsOf(player, soundUrl)).toBe(1);
      expect(await playsOf(page, soundUrl)).toBe(1);

      // GM-only: the player loses the button, and a GM trigger stays with the GM.
      await gmPad.getByLabel("Кому доступен Таверна").selectOption("GM_ONLY");
      await expect(playerSound).toHaveCount(0);
      await gmSound.click();
      await expect.poll(() => playsOf(page, soundUrl)).toBe(2);
      await page.waitForTimeout(1000);
      expect(await playsOf(player, soundUrl)).toBe(1);

      // Back to everyone, then the GM disables player playback.
      await gmPad
        .getByLabel("Кому доступен Таверна")
        .selectOption("ALL_MEMBERS");
      await expect(playerSound).toBeEnabled();
      // The policy checkbox is controlled by the server's answer, so it flips
      // after the round trip, not on click: wait for the state, not `uncheck`.
      const policy = gmPad.getByLabel("Игрокам можно запускать звуки", {
        exact: true,
      });
      await policy.click();
      await expect(policy).not.toBeChecked();
      await expect(playerSound).toBeDisabled();
      await policy.click();
      await expect(policy).toBeChecked();
      await expect(playerSound).toBeEnabled();

      // Local mute silences only this player and survives a reload.
      await playerPad
        .getByRole("button", { name: "Выключить эффекты", exact: true })
        .click();
      await page.waitForTimeout(2100);
      await gmSound.click();
      await expect.poll(() => playsOf(page, soundUrl)).toBe(3);
      await page.waitForTimeout(1000);
      expect(await playsOf(player, soundUrl)).toBe(1);

      // A reload neither replays old effects nor forgets the mute.
      await player.reload();
      await expect(player.locator(".app-shell")).toBeVisible();
      const reopened = await openSoundpad(player);
      await expect(
        reopened.getByRole("button", { name: "Включить эффекты", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.waitForTimeout(500);
      expect(await playsOf(player, soundUrl)).toBe(0);
      await reopened
        .getByRole("button", { name: "Включить эффекты", exact: true })
        .click();
      await page.waitForTimeout(2100);
      await gmSound.click();
      await expect.poll(() => playsOf(player, soundUrl)).toBe(1);
      await expect.poll(() => playsOf(page, soundUrl)).toBe(4);
      await info.attach(`soundpad-player-${width}`, {
        body: await player.screenshot(),
        contentType: "image/png",
      });
    } finally {
      await context.close();
    }
  });
