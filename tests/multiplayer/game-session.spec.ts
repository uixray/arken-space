import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import type {
  AssetDto,
  ClientToServerEvents,
  CommandAck,
  FogRevealDto,
  GameSnapshot,
  SceneDto,
  ServerToClientEvents,
  TokenDto,
} from "../../packages/contracts/src/index.js";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:14180";
const gmToken = "multiplayer-master-token-1234567890";
const restartMarker = "ARKEN_E2E_BACKEND_RESTART_READY";
const actionId = () => crypto.randomUUID();
const imageBuffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type GameConnection = { socket: GameSocket; snapshot: GameSnapshot };

async function expectOk(response: APIResponse) {
  if (!response.ok())
    throw new Error(response.status() + " " + (await response.text()));
  return response;
}

async function bootstrap(context: BrowserContext) {
  return (await (
    await expectOk(await context.request.get(baseUrl + "/api/bootstrap"))
  ).json()) as GameSnapshot;
}

async function cookieHeader(context: BrowserContext) {
  return (await context.cookies())
    .map((cookie) => cookie.name + "=" + cookie.value)
    .join("; ");
}

function waitForSnapshot(
  socket: GameSocket,
  predicate: (snapshot: GameSnapshot) => boolean = () => true,
  timeoutMs = 30_000,
) {
  return new Promise<GameSnapshot>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("game:snapshot", onSnapshot);
      reject(new Error("Timed out waiting for authoritative snapshot"));
    }, timeoutMs);
    const onSnapshot = (snapshot: GameSnapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timeout);
      socket.off("game:snapshot", onSnapshot);
      resolve(snapshot);
    };
    socket.on("game:snapshot", onSnapshot);
  });
}

async function connectSocket(context: BrowserContext): Promise<GameConnection> {
  const socket: GameSocket = io(baseUrl, {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 250,
    reconnectionDelayMax: 1_000,
    transports: ["websocket"],
    extraHeaders: { Cookie: await cookieHeader(context) },
  });
  const connected = new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const snapshot = waitForSnapshot(socket);
  socket.connect();
  await connected;
  return { socket, snapshot: await snapshot };
}

function waitForRecovery(socket: GameSocket, timeoutMs = 120_000) {
  return new Promise<GameSnapshot>((resolve, reject) => {
    let disconnected = false;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for backend recovery"));
    }, timeoutMs);
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

function move(
  socket: GameSocket,
  token: Pick<TokenDto, "id" | "z" | "levelId" | "revision">,
  x: number,
  y: number,
) {
  return new Promise<CommandAck<TokenDto>>((resolve) =>
    socket.emit(
      "token:moved",
      {
        actionId: actionId(),
        tokenId: token.id,
        x,
        y,
        z: token.z,
        levelId: token.levelId,
        revision: token.revision,
      },
      resolve,
    ),
  );
}

function expectUniqueIds(items: Array<{ id: string }>) {
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
}

async function uploadImage(
  request: APIRequestContext,
  kind: "MAP" | "TOKEN",
  name: string,
) {
  const response = await expectOk(
    await request.post(baseUrl + "/api/assets?kind=" + kind, {
      headers: { "x-action-id": actionId() },
      multipart: {
        file: {
          name,
          mimeType: "image/png",
          buffer: imageBuffer,
        },
      },
    }),
  );
  return (await response.json()) as AssetDto;
}

async function activateScene(
  gm: BrowserContext,
  sceneId: string,
  connections: GameConnection[],
) {
  const snapshots = connections.map(({ socket }) =>
    waitForSnapshot(socket, (snapshot) =>
      snapshot.scenes.some((scene) => scene.id === sceneId && scene.active),
    ),
  );
  await expectOk(
    await gm.request.post(baseUrl + "/api/scenes/activate", {
      data: { actionId: actionId(), sceneId },
    }),
  );
  return Promise.all(snapshots);
}

async function claimInvite(
  context: BrowserContext,
  inviteUrl: string,
  displayName: string,
) {
  const page = await context.newPage();
  await page.goto(inviteUrl);
  await page.getByLabel("Имя").fill(displayName);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(
    page.getByText(displayName + " · PLAYER", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("в сети", { exact: true })).toBeVisible();
  return page;
}

async function edgeHealthy() {
  try {
    return (await fetch(baseUrl + "/healthz")).ok;
  } catch {
    return false;
  }
}

test("GM and six isolated players recover authoritative state without security leaks", async ({
  browser,
}, testInfo) => {
  const runTag = "retry-" + testInfo.retry;
  const characterPrefix = "E2E " + runTag + " Player ";
  const hiddenTokenName = runTag + " GM Hidden Token";
  const recoveryTokenName = runTag + " Recovery Sentinel";
  const gmPublicMessage = runTag + "-gm-public";
  const gmOnlyChat = runTag + "-gm-only-chat";
  const gmOnlyRoll = runTag + "-gm-only-roll";
  const privateNotes = Array.from(
    { length: 6 },
    (_, index) => runTag + "-private-note-player-" + (index + 1),
  );
  const gm = await browser.newContext();
  const players = await Promise.all(
    Array.from({ length: 6 }, () => browser.newContext()),
  );
  const pages: Page[] = [];
  const connections: GameConnection[] = [];
  try {
    const gmPage = await gm.newPage();
    await gmPage.goto("/gm/" + gmToken);
    await gmPage.getByRole("button", { name: "Войти" }).click();
    await expect(gmPage.getByText(/Мастер · GM/)).toBeVisible();
    await expect(gmPage.getByText("в сети", { exact: true })).toBeVisible();

    const characterResponses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        gm.request.post(baseUrl + "/api/characters", {
          data: {
            actionId: actionId(),
            name: characterPrefix + (index + 1),
          },
        }),
      ),
    );
    await Promise.all(characterResponses.map(expectOk));

    let gmSnapshot = await bootstrap(gm);
    const characters = gmSnapshot.characters
      .filter((character) => character.name.startsWith(characterPrefix))
      .sort((left, right) => left.name.localeCompare(right.name));
    expect(characters).toHaveLength(6);

    const noteResponses = await Promise.all(
      characters.map((character, index) =>
        gm.request.patch(baseUrl + "/api/characters/" + character.id, {
          data: {
            actionId: actionId(),
            notes: privateNotes[index],
          },
        }),
      ),
    );
    await Promise.all(noteResponses.map(expectOk));

    const [hiddenAsset, recoveryAsset] = await Promise.all([
      uploadImage(gm.request, "TOKEN", "gm-hidden-token.png"),
      uploadImage(gm.request, "MAP", "recovery-scene-map.png"),
    ]);

    gmSnapshot = await bootstrap(gm);
    const initialScene = gmSnapshot.scenes.find((scene) => scene.active);
    if (!initialScene) throw new Error("Initial scene not found");

    const recoverySceneResponse = await expectOk(
      await gm.request.post(baseUrl + "/api/scenes", {
        data: {
          actionId: actionId(),
          name: "Recovery Scene " + runTag,
          mapAssetId: recoveryAsset.id,
        },
      }),
    );
    const recoveryScene = (await recoverySceneResponse.json()) as SceneDto;

    const playerTokenResponses = await Promise.all(
      characters.map((character, index) =>
        gm.request.post(baseUrl + "/api/tokens", {
          data: {
            actionId: actionId(),
            sceneId: initialScene.id,
            characterId: character.id,
            name: runTag + " Player Token " + (index + 1),
            x: 128 + index * 96,
            y: 128,
          },
        }),
      ),
    );
    await Promise.all(playerTokenResponses.map(expectOk));
    const playerTokens = (await Promise.all(
      playerTokenResponses.map((response) => response.json()),
    )) as TokenDto[];

    const enemyResponse = await expectOk(
      await gm.request.post(baseUrl + "/api/tokens", {
        data: {
          actionId: actionId(),
          sceneId: initialScene.id,
          name: runTag + " Ownerless Enemy",
          x: 800,
          y: 128,
        },
      }),
    );
    const enemy = (await enemyResponse.json()) as TokenDto;

    const hiddenTokenResponse = await expectOk(
      await gm.request.post(baseUrl + "/api/tokens", {
        data: {
          actionId: actionId(),
          sceneId: initialScene.id,
          assetId: hiddenAsset.id,
          name: hiddenTokenName,
          x: 896,
          y: 128,
          visible: false,
        },
      }),
    );
    const hiddenToken = (await hiddenTokenResponse.json()) as TokenDto;

    const recoveryTokenResponse = await expectOk(
      await gm.request.post(baseUrl + "/api/tokens", {
        data: {
          actionId: actionId(),
          sceneId: recoveryScene.id,
          assetId: recoveryAsset.id,
          name: recoveryTokenName,
          x: 256,
          y: 256,
        },
      }),
    );
    const recoveryToken = (await recoveryTokenResponse.json()) as TokenDto;

    const initialFogResponse = await expectOk(
      await gm.request.post(baseUrl + "/api/fog-reveals", {
        data: {
          actionId: actionId(),
          sceneId: initialScene.id,
          x: 32,
          y: 48,
          width: 160,
          height: 96,
        },
      }),
    );
    const initialFog = (await initialFogResponse.json()) as FogRevealDto;

    const recoveryFogResponse = await expectOk(
      await gm.request.post(baseUrl + "/api/fog-reveals", {
        data: {
          actionId: actionId(),
          sceneId: recoveryScene.id,
          x: 704,
          y: 512,
          width: 224,
          height: 144,
        },
      }),
    );
    const recoveryFog = (await recoveryFogResponse.json()) as FogRevealDto;

    const inviteUrls: string[] = [];
    for (const character of characters) {
      const response = await expectOk(
        await gm.request.post(baseUrl + "/api/invites", {
          data: {
            actionId: actionId(),
            characterId: character.id,
            label: character.name,
            expiresInHours: 1,
          },
        }),
      );
      inviteUrls.push(((await response.json()) as { url: string }).url);
    }

    for (let index = 0; index < 5; index += 1) {
      pages[index] = await claimInvite(
        players[index],
        inviteUrls[index],
        "Player " + (index + 1),
      );
    }

    const gmConnection = await connectSocket(gm);
    connections.push(gmConnection);
    for (let index = 0; index < 5; index += 1)
      connections.push(await connectSocket(players[index]));

    for (let index = 0; index < 5; index += 1) {
      const snapshot = connections[index + 1].snapshot;
      const serialized = JSON.stringify(snapshot);
      expect(snapshot.scenes.map((scene) => scene.id)).toEqual([
        initialScene.id,
      ]);
      expect(snapshot.fogReveals.map((fog) => fog.id)).toContain(initialFog.id);
      expect(snapshot.fogReveals.map((fog) => fog.id)).not.toContain(
        recoveryFog.id,
      );
      expect(snapshot.tokens.map((token) => token.id)).not.toContain(
        hiddenToken.id,
      );
      expect(snapshot.tokens.map((token) => token.id)).not.toContain(
        recoveryToken.id,
      );
      expect(snapshot.assets.map((asset) => asset.id)).not.toContain(
        hiddenAsset.id,
      );
      expect(snapshot.assets.map((asset) => asset.id)).not.toContain(
        recoveryAsset.id,
      );
      expect(snapshot.characters).toHaveLength(1);
      expect(snapshot.characters[0]?.notes).toBe(privateNotes[index]);
      for (const note of privateNotes)
        if (note !== privateNotes[index])
          expect(serialized).not.toContain(note);
      expect(serialized).not.toContain(hiddenTokenName);
      expect(serialized).not.toContain(recoveryTokenName);
      expect(serialized).not.toContain("preview");

      const hiddenContent = await players[index].request.get(
        baseUrl + "/api/assets/" + hiddenAsset.id + "/content",
      );
      const closedContent = await players[index].request.get(
        baseUrl + "/api/assets/" + recoveryAsset.id + "/content",
      );
      expect(hiddenContent.status()).toBe(404);
      expect(closedContent.status()).toBe(404);
    }

    const recoverySnapshots = await activateScene(
      gm,
      recoveryScene.id,
      connections,
    );
    for (const snapshot of recoverySnapshots.slice(1)) {
      expect(snapshot.scenes).toMatchObject([
        { id: recoveryScene.id, active: true },
      ]);
      expect(snapshot.fogReveals.map((fog) => fog.id)).toEqual([
        recoveryFog.id,
      ]);
      expect(snapshot.assets.map((asset) => asset.id)).toContain(
        recoveryAsset.id,
      );
      expect(snapshot.assets.map((asset) => asset.id)).not.toContain(
        hiddenAsset.id,
      );
    }

    pages[5] = await claimInvite(players[5], inviteUrls[5], "Player 6");
    const lateConnection = await connectSocket(players[5]);
    connections.push(lateConnection);
    expect(lateConnection.snapshot.scenes).toMatchObject([
      { id: recoveryScene.id, active: true },
    ]);
    expect(lateConnection.snapshot.fogReveals.map((fog) => fog.id)).toEqual([
      recoveryFog.id,
    ]);
    expect(lateConnection.snapshot.characters).toMatchObject([
      { id: characters[5].id, notes: privateNotes[5] },
    ]);

    const initialSnapshots = await activateScene(
      gm,
      initialScene.id,
      connections,
    );
    const gmInitialSnapshot = initialSnapshots[0];
    const playerInitialSnapshots = initialSnapshots.slice(1);

    const moveResults = await Promise.all([
      ...playerInitialSnapshots.map((snapshot, index) => {
        const own = snapshot.tokens.find(
          (token) => token.ownerMembershipId === snapshot.me.id,
        );
        if (!own) throw new Error("Owned token not found for player");
        return move(connections[index + 1].socket, own, 320 + index * 96, 384);
      }),
      move(
        connections[0].socket,
        gmInitialSnapshot.tokens.find((token) => token.id === enemy.id) ??
          enemy,
        1024,
        512,
      ),
    ]);
    for (const result of moveResults)
      expect(result).toMatchObject({ ok: true, status: "ACCEPTED" });

    const movedPlayerTokens = moveResults.slice(0, 6).map((result) => {
      if (!result.data) throw new Error("Accepted move lacks token data");
      return result.data;
    });
    const [foreignMove, enemyMove, hiddenMove] = await Promise.all([
      move(connections[1].socket, movedPlayerTokens[1], 1400, 900),
      move(connections[1].socket, enemy, 1400, 900),
      move(connections[1].socket, hiddenToken, 1400, 900),
    ]);
    for (const result of [foreignMove, enemyMove, hiddenMove])
      expect(result).toMatchObject({ ok: false, status: "FORBIDDEN" });

    const publicMarkers = Array.from({ length: 6 }, (_, index) =>
      index % 2 === 0
        ? runTag + "-public-chat-" + (index + 1)
        : runTag + "-public-roll-" + (index + 1),
    );
    const messageRequests = players.map((context, index) =>
      index % 2 === 0
        ? context.request.post(baseUrl + "/api/chat", {
            data: {
              actionId: actionId(),
              body: publicMarkers[index],
              visibility: "PUBLIC",
            },
          })
        : context.request.post(baseUrl + "/api/dice", {
            data: {
              actionId: actionId(),
              formula: "1d20",
              label: publicMarkers[index],
              visibility: "PUBLIC",
            },
          }),
    );
    messageRequests.push(
      gm.request.post(baseUrl + "/api/chat", {
        data: {
          actionId: actionId(),
          body: gmPublicMessage,
          visibility: "PUBLIC",
        },
      }),
      gm.request.post(baseUrl + "/api/chat", {
        data: {
          actionId: actionId(),
          body: gmOnlyChat,
          visibility: "GM_ONLY",
        },
      }),
      gm.request.post(baseUrl + "/api/dice", {
        data: {
          actionId: actionId(),
          formula: "1d20",
          label: gmOnlyRoll,
          visibility: "GM_ONLY",
        },
      }),
    );
    const messageResponses = await Promise.all(messageRequests);
    await Promise.all(messageResponses.map(expectOk));
    publicMarkers.push(gmPublicMessage);

    for (let index = 0; index < players.length; index += 1) {
      const snapshot = await bootstrap(players[index]);
      const serialized = JSON.stringify(snapshot);
      expectUniqueIds(snapshot.messages);
      for (const marker of publicMarkers)
        expect(
          snapshot.messages.filter((message) => message.body === marker),
        ).toHaveLength(1);
      expect(serialized).not.toContain(gmOnlyChat);
      expect(serialized).not.toContain(gmOnlyRoll);
      expect(serialized).not.toContain(hiddenAsset.id);
      expect(serialized).not.toContain(recoveryAsset.id);
      expect(snapshot.characters).toHaveLength(1);
      expect(snapshot.characters[0]?.notes).toBe(privateNotes[index]);
      for (const note of privateNotes)
        if (note !== privateNotes[index])
          expect(serialized).not.toContain(note);
    }

    await pages[1].reload();
    await expect(
      pages[1].getByText("Player 2 · PLAYER", { exact: true }),
    ).toBeVisible();
    await expect(
      pages[1].getByText(initialScene.name, { exact: true }),
    ).toBeVisible();
    await expect(pages[1].getByText("в сети", { exact: true })).toBeVisible();

    await players[2].setOffline(true);
    await expect(pages[2].getByText(/переподключение|нет связи/)).toBeVisible({
      timeout: 15_000,
    });
    await pages[2].waitForTimeout(20_000);
    await players[2].setOffline(false);
    await expect(pages[2].getByText("в сети", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await activateScene(gm, recoveryScene.id, connections);
    for (const page of pages)
      await expect(
        page.getByText(recoveryScene.name, { exact: true }),
      ).toBeVisible({ timeout: 30_000 });

    const recoveryPromises = connections.map(({ socket }) =>
      waitForRecovery(socket),
    );
    console.log(restartMarker);
    const recoveredSnapshots = await Promise.all(recoveryPromises);
    await expect
      .poll(edgeHealthy, { timeout: 120_000, intervals: [500, 1_000] })
      .toBe(true);
    for (const snapshot of recoveredSnapshots)
      expect(
        snapshot.scenes.some(
          (scene) => scene.id === recoveryScene.id && scene.active,
        ),
      ).toBe(true);

    const resyncPromises = connections.map(({ socket }) =>
      waitForSnapshot(socket, (snapshot) =>
        snapshot.scenes.some(
          (scene) => scene.id === recoveryScene.id && scene.active,
        ),
      ),
    );
    for (const { socket } of connections) socket.emit("game:resync", 0);
    const resynced = await Promise.all(resyncPromises);
    expect(
      new Set(resynced.map((snapshot) => snapshot.snapshotVersion)).size,
    ).toBe(1);

    const authoritativeGm = resynced[0];
    for (const collection of [
      authoritativeGm.members,
      authoritativeGm.characters,
      authoritativeGm.scenes,
      authoritativeGm.tokens,
      authoritativeGm.fogReveals,
      authoritativeGm.messages,
      authoritativeGm.assets,
    ])
      expectUniqueIds(collection);
    for (let index = 0; index < movedPlayerTokens.length; index += 1)
      expect(
        authoritativeGm.tokens.find(
          (token) => token.id === playerTokens[index].id,
        ),
      ).toMatchObject({
        x: 320 + index * 96,
        y: 384,
        revision: 1,
      });
    expect(
      authoritativeGm.tokens.find((token) => token.id === enemy.id),
    ).toMatchObject({ x: 1024, y: 512, revision: 1 });
    expect(
      authoritativeGm.messages.filter((message) => message.body === gmOnlyChat),
    ).toHaveLength(1);
    expect(
      authoritativeGm.messages.filter((message) => message.body === gmOnlyRoll),
    ).toHaveLength(1);

    for (let index = 0; index < 6; index += 1) {
      const snapshot = resynced[index + 1];
      const serialized = JSON.stringify(snapshot);
      expect(snapshot.scenes).toMatchObject([
        { id: recoveryScene.id, active: true },
      ]);
      expect(snapshot.fogReveals.map((fog) => fog.id)).toEqual([
        recoveryFog.id,
      ]);
      expect(snapshot.fogReveals.map((fog) => fog.id)).not.toContain(
        initialFog.id,
      );
      expect(snapshot.tokens.map((token) => token.id)).not.toContain(
        hiddenToken.id,
      );
      for (const token of playerTokens)
        expect(snapshot.tokens.map((item) => item.id)).not.toContain(token.id);
      expect(snapshot.assets.map((asset) => asset.id)).toContain(
        recoveryAsset.id,
      );
      expect(snapshot.assets.map((asset) => asset.id)).not.toContain(
        hiddenAsset.id,
      );
      expect(snapshot.characters).toMatchObject([
        { id: characters[index].id, notes: privateNotes[index] },
      ]);
      for (const collection of [
        snapshot.members,
        snapshot.characters,
        snapshot.scenes,
        snapshot.tokens,
        snapshot.fogReveals,
        snapshot.messages,
        snapshot.assets,
      ])
        expectUniqueIds(collection);
      for (const marker of publicMarkers)
        expect(
          snapshot.messages.filter((message) => message.body === marker),
        ).toHaveLength(1);
      expect(serialized).not.toContain(gmOnlyChat);
      expect(serialized).not.toContain(gmOnlyRoll);
      expect(serialized).not.toContain(hiddenTokenName);
      for (const note of privateNotes)
        if (note !== privateNotes[index])
          expect(serialized).not.toContain(note);

      const hiddenContent = await players[index].request.get(
        baseUrl + "/api/assets/" + hiddenAsset.id + "/content",
      );
      expect(hiddenContent.status()).toBe(404);
    }

    for (const page of pages) {
      await expect(page.getByText("в сети", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByText(recoveryScene.name, { exact: true }),
      ).toBeVisible();
    }
  } finally {
    for (const { socket } of connections) socket.disconnect();
    await Promise.all([gm.close(), ...players.map((player) => player.close())]);
  }
});
