import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { io, type Socket } from "socket.io-client";
import { createDatabase } from "../../packages/db/src/index.js";
import { createCampaignWithGmAccess } from "../../apps/server/src/seed.js";
import type {
  AssetDto,
  GameSnapshot,
} from "../../packages/contracts/src/index.js";

// Только existing disposable Compose runner: никаких production URL или fallback.
const origin = "http://edge";
const databaseUrl = "postgres://arken:arken-e2e-password@postgres:5432/arken";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
// Собственный 440 Hz oscillator, gain 0.05, Firefox MediaRecorder Ogg/Opus.
// Без внешнего контента/прав: ~0.7 s, 48 kHz stereo; не mock с расширением .ogg.
const audio = readFileSync(
  new URL("./uix642-synthetic-tone.ogg", import.meta.url),
);
const fixtureHash =
  "639c1754949d7c4344435414589db57065a577ff318e355157a7b78c2fceba13";
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function response(
  request: APIRequestContext,
  pathname: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {},
  status = 200,
) {
  const url = new URL(pathname, origin);
  expect(url.origin).toBe(origin);
  const result = await request.fetch(url.href, {
    ...options,
    maxRedirects: 0,
    timeout: 15_000,
  });
  expect(result.url()).toBe(url.href);
  expect(result.status()).toBe(status);
  return result;
}

async function healthy(request: APIRequestContext, revision: string) {
  const result = await response(request, "/healthz");
  expect(await result.json()).toMatchObject({
    status: "ok",
    database: "ok",
    buildRevision: revision,
    schemaVersion: 2,
  });
}

async function bytesAndRange(request: APIRequestContext, asset: AssetDto) {
  const pathname = `/api/assets/${asset.id}/content`;
  const full = await response(request, pathname);
  const bytes = await full.body();
  expect(bytes.length).toBeGreaterThan(32);
  expect(Number(full.headers()["content-length"])).toBe(bytes.length);
  expect(full.headers()["accept-ranges"]).toBe("bytes");
  const partial = await response(
    request,
    pathname,
    { headers: { Range: "bytes=0-31" } },
    206,
  );
  expect(partial.headers()["content-range"]).toBe(`bytes 0-31/${bytes.length}`);
  expect((await partial.body()).equals(bytes.subarray(0, 32))).toBe(true);
  if (asset.kind === "AUDIO") {
    expect(full.headers()["content-type"]).toContain("audio/ogg");
    expect(hash(bytes)).toBe(fixtureHash);
  } else {
    // Сервер нормализует PNG в WebP: сравниваем хэш download до/после restart,
    // а не ошибочно требуем совпадения нормализованного изображения с PNG input.
    expect(full.headers()["content-type"]).toContain("image/webp");
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
  }
  return { sha256: hash(bytes), size: bytes.length };
}

async function renderAndPlay(
  page: Page,
  imageAsset: AssetDto,
  audioAsset: AssetDto,
) {
  const media = await page.evaluate(
    async ({ imageUrl, audioUrl }) => {
      const image = new Image();
      image.src = imageUrl;
      document.body.append(image);
      await image.decode();
      const audio = document.createElement("audio");
      audio.muted = true; // Не звук динамиков, а реальная загрузка/декодирование/playback.
      audio.src = audioUrl;
      document.body.append(audio);
      const ended = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Media playback timeout")),
          10_000,
        );
        audio.onended = () => {
          clearTimeout(timeout);
          resolve();
        };
        audio.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Media decode failed"));
        };
      });
      await audio.play();
      await ended;
      const result = {
        width: image.naturalWidth,
        height: image.naturalHeight,
        duration: audio.duration,
        currentTime: audio.currentTime,
        ended: audio.ended,
      };
      image.remove();
      audio.remove();
      return result;
    },
    {
      imageUrl: `${origin}/api/assets/${imageAsset.id}/content`,
      audioUrl: `${origin}/api/assets/${audioAsset.id}/content`,
    },
  );
  expect(media).toMatchObject({ width: 1, height: 1, ended: true });
  expect(media.duration).toBeGreaterThan(0);
  expect(media.duration).toBeLessThan(2);
  expect(media.currentTime).toBeGreaterThan(0.1);
}

function nextSnapshot(socket: Socket, afterDisconnect = false) {
  return new Promise<GameSnapshot>((resolve, reject) => {
    let disconnected = !afterDisconnect;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Isolated backend snapshot/restart was not observed"));
    }, 120_000);
    const onDisconnect = () => {
      disconnected = true;
    };
    const onSnapshot = (snapshot: GameSnapshot) => {
      if (!disconnected) return;
      cleanup();
      resolve(snapshot);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("disconnect", onDisconnect);
      socket.off("game:snapshot", onSnapshot);
    };
    socket.on("disconnect", onDisconnect);
    socket.on("game:snapshot", onSnapshot);
  });
}

test("UIX-642 synthetic image and real OGG survive download, playback, reload and backend restart", async ({
  browser,
}) => {
  expect(
    process.env.E2E_BASE_URL,
    "Run only through the disposable Compose runner",
  ).toBe(origin);
  const revision = process.env.E2E_BUILD_REVISION ?? "";
  expect(revision).toMatch(/^[a-f0-9]{40}$/);
  expect(audio.subarray(0, 4).toString()).toBe("OggS");
  expect(hash(audio)).toBe(fixtureHash);
  const gm = await browser.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const ownedAssets: AssetDto[] = [];
  let socket: Socket | undefined;
  let authenticated = false;
  try {
    await healthy(gm.request, revision); // До любого database/API write.
    const { db, client } = createDatabase(databaseUrl);
    const token = `media-smoke-${randomUUID()}-${randomUUID()}`;
    let campaignId: string;
    try {
      const seeded = await createCampaignWithGmAccess(
        db,
        "UIX-642 synthetic media smoke",
        token,
      );
      campaignId = seeded.campaign.id;
    } finally {
      await client.end();
    }
    await response(gm.request, "/api/auth/gm", {
      method: "POST",
      data: { token },
    });
    authenticated = true;
    const initial = (await (
      await response(gm.request, "/api/bootstrap")
    ).json()) as GameSnapshot;
    expect(initial.campaign.id).toBe(campaignId);
    expect(initial.me.role).toBe("GM");
    expect(initial.assets).toHaveLength(0);
    for (const [kind, buffer, mimeType, name] of [
      ["IMAGE", image, "image/png", "uix642-synthetic.png"],
      ["AUDIO", audio, "audio/ogg", "uix642-synthetic.ogg"],
    ] as const) {
      const uploaded = await response(
        gm.request,
        `/api/assets?kind=${kind}`,
        {
          method: "POST",
          headers: { "x-action-id": randomUUID() },
          multipart: { file: { name, mimeType, buffer } },
        },
        201,
      );
      const asset = (await uploaded.json()) as AssetDto;
      ownedAssets.push(asset);
      expect(asset.id).toMatch(/^[a-f0-9-]{36}$/);
      expect(asset.kind).toBe(kind);
    }
    const [imageAsset, audioAsset] = ownedAssets;
    expect(imageAsset).toBeDefined();
    expect(audioAsset).toBeDefined();
    const before = await Promise.all(
      ownedAssets.map((asset) => bytesAndRange(gm.request, asset)),
    );
    const page = await gm.newPage();
    expect((await page.goto(origin))?.status()).toBe(200);
    await renderAndPlay(page, imageAsset!, audioAsset!);
    await page.reload();
    await renderAndPlay(page, imageAsset!, audioAsset!);

    socket = io(origin, {
      autoConnect: false,
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 250,
      reconnectionDelayMax: 1000,
      extraHeaders: {
        Cookie: (await gm.cookies(origin))
          .map(({ name, value }) => `${name}=${value}`)
          .join("; "),
      },
    });
    const connected = nextSnapshot(socket);
    socket.connect();
    expect((await connected).campaign.id).toBe(campaignId);
    const recovery = nextSnapshot(socket, true);
    // Existing host runner сериализует каждый marker и рестартует только свой server.
    console.log("ARKEN_E2E_BACKEND_RESTART_READY");
    const restored = await recovery;
    expect(restored.campaign.id).toBe(campaignId);
    for (const asset of ownedAssets)
      expect(restored.assets.some((item) => item.id === asset.id)).toBe(true);
    await healthy(gm.request, revision);
    const after = await Promise.all(
      ownedAssets.map((asset) => bytesAndRange(gm.request, asset)),
    );
    expect(after).toEqual(before);
    await page.reload();
    await renderAndPlay(page, imageAsset!, audioAsset!);
    console.log(
      "[media-smoke] " +
        JSON.stringify({
          revision,
          image: before[0],
          audio: before[1],
          playback: true,
          reload: true,
          backendRestart: true,
        }),
    );
  } finally {
    socket?.disconnect();
    try {
      if (authenticated) {
        for (const asset of ownedAssets) {
          const usage = await (
            await response(gm.request, `/api/assets/${asset.id}/usage`)
          ).json();
          expect(usage).toMatchObject({ canDelete: true, inUse: false });
          const deleted = await (
            await response(gm.request, `/api/assets/${asset.id}`, {
              method: "DELETE",
            })
          ).json();
          expect(deleted).toMatchObject({
            assetId: asset.id,
            deleted: true,
            blobCleanupPending: false,
          });
          await response(
            gm.request,
            `/api/assets/${asset.id}/content`,
            {},
            404,
          );
        }
        const cleaned = (await (
          await response(gm.request, "/api/bootstrap")
        ).json()) as GameSnapshot;
        expect(cleaned.assets).toHaveLength(0);
        await response(gm.request, "/api/auth/logout", { method: "POST" });
        await response(gm.request, "/api/bootstrap", {}, 401);
      }
    } finally {
      await gm.close();
    }
  }
});
