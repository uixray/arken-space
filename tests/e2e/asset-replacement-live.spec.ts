import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AssetDto, GameSnapshot } from "@arken/contracts";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

test.skip(
  process.env.ARKEN_ASSET_LIVE_GATE !== "isolated-loopback",
  "Dedicated isolated loopback database/server required; see UIX-293 acceptance runbook",
);

test("UIX-293 real GM replacement reaches connected player and survives reload", async ({
  page,
  browser,
  gmToken,
}, info) => {
  // Explicit opt-in prevents this mutating scenario from targeting an accidental
  // remote baseURL. Campaign fixture creates synthetic data in the isolated DB.
  expect(process.env.ARKEN_ASSET_LIVE_GATE).toBe("isolated-loopback");
  expect(new URL(info.project.use.baseURL!).hostname).toBe("127.0.0.1");
  const bytes = await readFile(
    new URL("../multiplayer/uix642-synthetic-tone.ogg", import.meta.url),
  );
  const digest = (value: Buffer) =>
    createHash("sha256").update(value).digest("hex");
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const initial = (await (
    await page.request.get("/api/bootstrap")
  ).json()) as GameSnapshot;
  const inviteResponse = await page.request.post("/api/invites", {
    data: {
      actionId: randomUUID(),
      characterId: initial.characters[0].id,
      label: "Проверка файлов",
      expiresInHours: 1,
    },
  });
  await expect(inviteResponse).toBeOK();
  const invite = (await inviteResponse.json()) as { url: string };
  const uploaded = await page.request.post("/api/assets?kind=AUDIO", {
    headers: { "x-action-id": randomUUID() },
    multipart: {
      file: {
        name: "Проверка замены.ogg",
        mimeType: "audio/ogg",
        buffer: bytes,
      },
    },
  });
  await expect(uploaded).toBeOK();
  const asset = (await uploaded.json()) as AssetDto;
  // Select through the actual master's UI and real socket command.
  await page.locator(".music-overflow summary").click();
  await page
    .locator(".music-overflow")
    .getByRole("button", { name: asset.name, exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          (await (
            await page.request.get("/api/bootstrap")
          ).json()) as GameSnapshot
        ).audio.assetId,
    )
    .toBe(asset.id);
  const player = await browser.newContext({
    baseURL: info.project.use.baseURL,
  });
  try {
    await player.addInitScript(() => {
      localStorage.setItem("arken.audio.enabled", "false");
      localStorage.setItem("arken.audio.volume", "0");
    });
    const listener = await player.newPage();
    await listener.goto(new URL(invite.url).pathname);
    await listener.getByLabel("Имя", { exact: true }).fill("Слушатель");
    await listener.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(listener.locator(".app-shell")).toBeVisible();
    const before = (await (
      await listener.request.get("/api/bootstrap")
    ).json()) as GameSnapshot;
    expect(before.me.role).toBe("PLAYER");
    const oldUrl = before.assets.find((item) => item.id === asset.id)!.url;
    const audio = listener.locator("audio");
    await expect(audio).toHaveCount(1);
    await expect
      .poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState))
      .toBeGreaterThanOrEqual(2);
    const originalElement = await audio.elementHandle();
    const head = await page.request.head(oldUrl);
    await expect(head).toBeOK();

    await openWorkspaceSection(page, "Файлы");
    const files = page.getByRole("dialog", { name: "Файлы", exact: true });
    await files
      .locator(".asset-row")
      .filter({ hasText: asset.name })
      .getByRole("button", { name: "Заменить файл", exact: true })
      .click();
    const replacement = page.getByRole("dialog", {
      name: `Заменить файл «${asset.name}»`,
      exact: true,
    });
    await replacement
      .getByLabel("Новый аудиофайл", { exact: true })
      .setInputFiles({
        name: "Обновление.ogg",
        mimeType: "audio/ogg",
        buffer: bytes,
      });
    await replacement
      .getByRole("button", { name: "Проверить замену", exact: true })
      .click();
    await expect(
      replacement.getByLabel("Места использования заменяемого файла"),
    ).toContainText("Аудиодорожка");
    const committed = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/api/assets/${asset.id}/content`,
    );
    await replacement
      .getByRole("button", { name: "Подтвердить замену", exact: true })
      .click();
    const response = await committed;
    expect(response.ok()).toBe(true);
    const result = (await response.json()) as {
      asset: AssetDto;
      version: string;
    };
    expect(result.asset.id).toBe(asset.id);
    expect(result.asset.name).toBe(asset.name);
    expect(result.asset.url).not.toBe(oldUrl);
    expect(result.version).not.toBe(head.headers().etag);
    await expect(replacement.getByRole("status")).toContainText(
      "Файл заменён. Существующие ссылки сохранены.",
    );
    await replacement
      .getByRole("button", { name: "Закрыть", exact: true })
      .click();
    await expect(replacement).toHaveCount(0);
    // No player reload until the live socket and mounted consumer are checked.
    await expect
      .poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentSrc))
      .toContain(result.asset.url);
    await expect
      .poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState))
      .toBeGreaterThanOrEqual(2);
    expect(
      await audio.evaluate(
        (node, original) => node === original,
        originalElement,
      ),
    ).toBe(true);
    expect(
      await audio.evaluate((node: HTMLAudioElement) => ({
        paused: node.paused,
        volume: node.volume,
        error: node.error?.code ?? null,
      })),
    ).toEqual({ paused: true, volume: 0, error: null });
    const delivered = await listener.request.get(result.asset.url);
    await expect(delivered).toBeOK();
    expect(digest(await delivered.body())).toBe(digest(bytes));
    expect(delivered.headers().etag).toBe(result.version);
    const after = (await (
      await listener.request.get("/api/bootstrap")
    ).json()) as GameSnapshot;
    expect(after.audio).toEqual(before.audio);
    await listener.reload();
    await expect
      .poll(() =>
        listener
          .locator("audio")
          .evaluate((node: HTMLAudioElement) => node.currentSrc),
      )
      .toContain(result.asset.url);
    await expect
      .poll(() =>
        listener
          .locator("audio")
          .evaluate((node: HTMLAudioElement) => node.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      await listener.evaluate(() => ({
        enabled: localStorage.getItem("arken.audio.enabled"),
        volume: localStorage.getItem("arken.audio.volume"),
      })),
    ).toEqual({ enabled: "false", volume: "0" });
    await info.attach("replacement-live-receipt", {
      body: JSON.stringify({
        campaignId: after.campaign.id,
        assetId: asset.id,
        oldUrl,
        newUrl: result.asset.url,
        version: result.version,
        sha256: digest(bytes),
        audioUnchanged: true,
        playerReload: true,
      }),
      contentType: "application/json",
    });
  } finally {
    await player.close();
  }
});
