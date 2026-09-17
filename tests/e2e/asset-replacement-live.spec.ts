import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  AssetDto,
  GameSnapshot,
  SceneDto,
  TokenDto,
} from "@arken/contracts";
import type { Page } from "@playwright/test";
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

for (const kind of ["MAP", "TOKEN", "PORTRAIT"] as const) {
  test(`UIX-293 real ${kind} replacement changes connected player pixels and retains links`, async ({
    page,
    browser,
    gmToken,
  }, info) => {
    expect(new URL(info.project.use.baseURL!).hostname).toBe("127.0.0.1");
    const cyan = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAARSURBVBhXY2D4//8/CiZdAABCVi/RzV1YtQAAAABJRU5ErkJggg==",
      "base64",
    );
    const magenta = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAASSURBVBhXY/jP8P8/MmYgXQAAUkYv0QSe4rkAAAAASUVORK5CYII=",
      "base64",
    );
    const digest = (bytes: Buffer) =>
      createHash("sha256").update(bytes).digest("hex");
    expect(digest(cyan)).not.toBe(digest(magenta));
    const snapshot = async (client: Page): Promise<GameSnapshot> => {
      const response = await client.request.get("/api/bootstrap");
      await expect(response).toBeOK();
      return response.json();
    };
    await page.goto(`/gm/${gmToken}`);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
    const initial = await snapshot(page);
    const scene = initial.scenes.find((s) => s.active)!;
    const upload = await page.request.post(`/api/assets?kind=${kind}`, {
      headers: { "x-action-id": randomUUID() },
      multipart: {
        file: {
          name: "Изображение замены.png",
          mimeType: "image/png",
          buffer: cyan,
        },
      },
    });
    await expect(upload).toBeOK();
    const asset: AssetDto = await upload.json();
    let linkedScene: SceneDto = scene;
    let token: TokenDto | undefined;
    if (kind === "MAP") {
      const linked = await page.request.patch(`/api/scenes/${scene.id}`, {
        data: {
          actionId: randomUUID(),
          revision: scene.revision,
          mapAssetId: asset.id,
        },
      });
      await expect(linked).toBeOK();
      linkedScene = await linked.json();
    } else if (kind === "TOKEN") {
      const placed = await page.request.post("/api/tokens", {
        data: {
          actionId: randomUUID(),
          sceneId: scene.id,
          assetId: asset.id,
          name: "Токен замены",
          x: 640,
          y: 320,
          width: 256,
          height: 256,
          characterId: initial.characters[0].id,
        },
      });
      await expect(placed).toBeOK();
      token = await placed.json();
    } else {
      const character = initial.characters[0];
      const linked = await page.request.patch(
        `/api/characters/${character.id}`,
        {
          data: {
            actionId: randomUUID(),
            revision: character.revision,
            portraitAssetId: asset.id,
          },
        },
      );
      await expect(linked).toBeOK();
    }
    const reveal = await page.request.post("/api/fog-reveals", {
      data: {
        actionId: randomUUID(),
        sceneId: scene.id,
        x: 0,
        y: 0,
        width: scene.width,
        height: scene.height,
        operation: "REVEAL",
      },
    });
    await expect(reveal).toBeOK();
    const invite = await page.request.post("/api/invites", {
      data: {
        actionId: randomUUID(),
        characterId: initial.characters[0].id,
        label: "Проверка карты",
        expiresInHours: 1,
      },
    });
    await expect(invite).toBeOK();
    const context = await browser.newContext({
      baseURL: info.project.use.baseURL,
      viewport: { width: 1280, height: 850 },
    });
    try {
      const player = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      player.on("pageerror", (error) => errors.push(error.message));
      await player.goto(new URL((await invite.json()).url).pathname);
      await player.getByLabel("Имя", { exact: true }).fill("Наблюдатель карты");
      await player.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(player.locator(".map-viewport")).toBeVisible();
      await player.locator(".map-viewport").press("f");
      const portrait = player.getByRole("img", {
        name: `Портрет ${initial.characters[0].name}`,
        exact: true,
      });
      const openPortrait = async () => {
        await openWorkspaceSection(player, "Персонажи");
        await expect(portrait).toBeVisible();
        await portrait.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            portrait.evaluate((el) => {
              const box = el.getBoundingClientRect();
              return (
                document.elementFromPoint(
                  box.x + box.width / 2,
                  box.y + box.height / 2,
                ) === el
              );
            }),
          )
          .toBe(true);
      };
      if (kind === "PORTRAIT") await openPortrait();
      const consumer =
        kind === "PORTRAIT" ? portrait : player.locator(".map-viewport");
      const pixels = () =>
        consumer.evaluate((viewport) => {
          const bounds = viewport.getBoundingClientRect();
          const composite = document.createElement("canvas");
          composite.width = Math.ceil(bounds.width);
          composite.height = Math.ceil(bounds.height);
          const ctx = composite.getContext("2d")!;
          if (viewport instanceof HTMLImageElement) {
            if (!viewport.complete || !viewport.naturalWidth)
              return { cyan: 0, magenta: 0 };
            ctx.drawImage(viewport, 0, 0, bounds.width, bounds.height);
          }
          for (const canvas of viewport.querySelectorAll("canvas")) {
            const rect = canvas.getBoundingClientRect();
            ctx.drawImage(
              canvas,
              rect.x - bounds.x,
              rect.y - bounds.y,
              rect.width,
              rect.height,
            );
          }
          const data = ctx.getImageData(
            0,
            0,
            composite.width,
            composite.height,
          ).data;
          let cyan = 0,
            magenta = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3]! < 240) continue;
            if (data[i]! < 20 && data[i + 1]! > 235 && data[i + 2]! > 235)
              cyan++;
            if (data[i]! > 235 && data[i + 1]! < 20 && data[i + 2]! > 235)
              magenta++;
          }
          return { cyan, magenta };
        });
      await expect
        .poll(async () => (await pixels()).cyan)
        .toBeGreaterThan(1000);
      expect((await pixels()).magenta).toBe(0);
      const before = await snapshot(player);
      const oldUrl = before.assets.find((a) => a.id === asset.id)!.url;
      const oldContent = await player.request.get(oldUrl);
      await expect(oldContent).toBeOK();
      const oldDigest = digest(await oldContent.body());
      await openWorkspaceSection(page, "Файлы");
      const files = page.getByRole("dialog", { name: "Файлы", exact: true });
      await files
        .locator(".asset-row")
        .filter({ hasText: asset.name })
        .getByRole("button", { name: "Заменить файл", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: `Заменить файл «${asset.name}»`,
        exact: true,
      });
      await dialog
        .getByLabel("Новое изображение", { exact: true })
        .setInputFiles({
          name: "Новая карта.png",
          mimeType: "image/png",
          buffer: magenta,
        });
      await dialog
        .getByRole("button", { name: "Проверить замену", exact: true })
        .click();
      await expect(
        dialog.getByLabel("Места использования заменяемого файла"),
      ).toContainText(
        kind === "MAP"
          ? scene.name
          : kind === "TOKEN"
            ? token!.name
            : initial.characters[0].name,
      );
      const committed = page.waitForResponse(
        (r) =>
          r.request().method() === "PUT" &&
          new URL(r.url()).pathname === `/api/assets/${asset.id}/content`,
      );
      await dialog
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
      await expect(dialog.getByRole("status")).toContainText(
        "Файл заменён. Существующие ссылки сохранены.",
      );
      // No player reload before verifying the real socket-driven visible change.
      await expect
        .poll(async () => (await pixels()).magenta)
        .toBeGreaterThan(1000);
      await expect.poll(async () => (await pixels()).cyan).toBe(0);
      const after = await snapshot(player);
      expect(after.scenes.find((s) => s.id === scene.id)).toEqual(
        before.scenes.find((s) => s.id === scene.id),
      );
      if (kind === "MAP") {
        expect(after.scenes.find((s) => s.id === scene.id)?.mapAssetId).toBe(
          asset.id,
        );
      } else if (kind === "TOKEN") {
        const beforeToken = before.tokens.find((t) => t.id === token!.id);
        expect(beforeToken).toBeTruthy();
        expect(beforeToken!.assetId).toBe(asset.id);
        expect(after.tokens.find((t) => t.id === token!.id)).toEqual(
          beforeToken,
        );
        const beforeDefinition = before.tokenDefinitions?.find(
          (d) => d.id === token!.definitionId,
        );
        expect(beforeDefinition?.defaultAssetId).toBe(asset.id);
        expect(
          after.tokenDefinitions?.find((d) => d.id === token!.definitionId),
        ).toEqual(beforeDefinition);
      } else {
        const original = before.characters.find(
          (c) => c.id === initial.characters[0].id,
        );
        expect(original?.portraitAssetId).toBe(asset.id);
        expect(
          after.characters.find((c) => c.id === initial.characters[0].id),
        ).toEqual(original);
        await expect(portrait).toHaveAttribute("src", result.asset.url);
      }
      expect(after.scenes.find((s) => s.id === scene.id)?.revision).toBe(
        linkedScene.revision,
      );
      const delivered = await player.request.get(result.asset.url);
      await expect(delivered).toBeOK();
      // Server storage intentionally normalizes PNG to WebP. Compare the actual
      // canonical content across roles/reload, not normalized bytes to source PNG.
      expect(delivered.headers()["content-type"]).toContain("image/webp");
      const deliveredDigest = digest(await delivered.body());
      expect(deliveredDigest).not.toBe(oldDigest);
      const gmContent = await page.request.get(result.asset.url);
      await expect(gmContent).toBeOK();
      expect(digest(await gmContent.body())).toBe(deliveredDigest);
      expect(delivered.headers().etag).toBe(result.version);
      await player.reload();
      await expect(player.locator(".map-viewport")).toBeVisible();
      await player.locator(".map-viewport").press("f");
      if (kind === "PORTRAIT") await openPortrait();
      await expect
        .poll(async () => (await pixels()).magenta)
        .toBeGreaterThan(1000);
      expect((await pixels()).cyan).toBe(0);
      const reloadedContent = await player.request.get(result.asset.url);
      await expect(reloadedContent).toBeOK();
      expect(digest(await reloadedContent.body())).toBe(deliveredDigest);
      if (token) {
        const reloaded = await snapshot(player);
        expect(reloaded.tokens.find((t) => t.id === token!.id)).toEqual(
          before.tokens.find((t) => t.id === token!.id),
        );
      }
      if (kind === "PORTRAIT") {
        const reloaded = await snapshot(player);
        expect(
          reloaded.characters.find((c) => c.id === initial.characters[0].id),
        ).toEqual(
          before.characters.find((c) => c.id === initial.characters[0].id),
        );
        await expect(portrait).toHaveAttribute("src", result.asset.url);
      }
      expect(errors).toEqual([]);
      await info.attach(`${kind.toLowerCase()}-replacement-visible`, {
        body: await consumer.screenshot(),
        contentType: "image/png",
      });
      await info.attach(`${kind.toLowerCase()}-replacement-live-receipt`, {
        body: JSON.stringify({
          kind,
          oldUrl,
          newUrl: result.asset.url,
          sourcePngSha256: digest(magenta),
          deliveredWebpSha256: deliveredDigest,
          pixels: await pixels(),
          sceneUnchanged: true,
          reload: true,
          errors,
        }),
        contentType: "application/json",
      });
    } finally {
      await context.close();
    }
  });
}
