import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
} from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  CommandAck,
  GameSnapshot,
  ServerToClientEvents,
  TokenDto,
} from "../../packages/contracts/src/index.js";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:14180";
const gmToken = "multiplayer-master-token-1234567890";
const actionId = () => crypto.randomUUID();

async function expectOk(response: APIResponse) {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`);
  return response;
}

async function cookieHeader(context: BrowserContext) {
  return (await context.cookies())
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function connectSocket(context: BrowserContext) {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
    baseUrl,
    {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: await cookieHeader(context) },
    },
  );
  const connected = new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const snapshot = new Promise<GameSnapshot>((resolve) =>
    socket.once("game:snapshot", resolve),
  );
  socket.connect();
  await connected;
  return { socket, snapshot: await snapshot };
}

function move(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  token: TokenDto,
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

test("GM and two clean players keep permissions through chat, scene switch and reconnect", async ({
  browser,
}) => {
  const gm = await browser.newContext();
  const playerOne = await browser.newContext();
  const playerTwo = await browser.newContext();
  const sockets: Array<Socket<ServerToClientEvents, ClientToServerEvents>> = [];
  try {
    const gmPage = await gm.newPage();
    await gmPage.goto(`/gm/${gmToken}`);
    await gmPage.getByRole("button", { name: "Войти" }).click();
    await expect(gmPage.getByText(/Мастер · GM/)).toBeVisible();

    for (const name of ["Player One", "Player Two"]) {
      await expectOk(
        await gm.request.post(`${baseUrl}/api/characters`, {
          data: { actionId: actionId(), name },
        }),
      );
    }
    let gmSnapshot = (await (
      await gm.request.get(`${baseUrl}/api/bootstrap`)
    ).json()) as GameSnapshot;
    const characters = gmSnapshot.characters.filter((character) =>
      character.name.startsWith("Player "),
    );
    expect(characters).toHaveLength(2);

    const inviteUrls: string[] = [];
    for (const character of characters) {
      const response = await expectOk(
        await gm.request.post(`${baseUrl}/api/invites`, {
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

    for (const [index, context] of [playerOne, playerTwo].entries()) {
      const page = await context.newPage();
      await page.goto(inviteUrls[index]!);
      await page.getByLabel("Имя").fill(`Player ${index + 1}`);
      await page.getByRole("button", { name: "Войти" }).click();
      await expect(
        page.getByText(new RegExp(`Player ${index + 1} · PLAYER`)),
      ).toBeVisible();
    }

    gmSnapshot = (await (
      await gm.request.get(`${baseUrl}/api/bootstrap`)
    ).json()) as GameSnapshot;
    const activeScene = gmSnapshot.scenes.find((scene) => scene.active)!;
    const ownedCharacters = gmSnapshot.characters.filter((character) =>
      character.name.startsWith("Player "),
    );
    for (const [index, character] of ownedCharacters.entries()) {
      await expectOk(
        await gm.request.post(`${baseUrl}/api/tokens`, {
          data: {
            actionId: actionId(),
            sceneId: activeScene.id,
            characterId: character.id,
            name: character.name,
            x: 128 + index * 128,
            y: 128,
          },
        }),
      );
    }
    await expectOk(
      await gm.request.post(`${baseUrl}/api/tokens`, {
        data: {
          actionId: actionId(),
          sceneId: activeScene.id,
          name: "Enemy",
          x: 512,
          y: 128,
        },
      }),
    );

    const gmConnection = await connectSocket(gm);
    const oneConnection = await connectSocket(playerOne);
    const twoConnection = await connectSocket(playerTwo);
    sockets.push(
      gmConnection.socket,
      oneConnection.socket,
      twoConnection.socket,
    );
    const ownOne = oneConnection.snapshot.tokens.find(
      (token) => token.ownerMembershipId === oneConnection.snapshot.me.id,
    )!;
    const ownTwo = twoConnection.snapshot.tokens.find(
      (token) => token.ownerMembershipId === twoConnection.snapshot.me.id,
    )!;
    const enemy = gmConnection.snapshot.tokens.find(
      (token) => token.name === "Enemy",
    )!;

    await expect(
      move(oneConnection.socket, ownOne, 320, 320),
    ).resolves.toMatchObject({
      ok: true,
      status: "ACCEPTED",
    });
    await expect(
      move(oneConnection.socket, ownTwo, 640, 640),
    ).resolves.toMatchObject({
      ok: false,
      status: "FORBIDDEN",
    });
    await expect(
      move(oneConnection.socket, enemy, 640, 640),
    ).resolves.toMatchObject({
      ok: false,
      status: "FORBIDDEN",
    });
    await expect(
      move(gmConnection.socket, enemy, 576, 192),
    ).resolves.toMatchObject({
      ok: true,
      status: "ACCEPTED",
    });

    const [chatResponse, diceResponse] = await Promise.all([
      playerOne.request.post(`${baseUrl}/api/chat`, {
        data: {
          actionId: actionId(),
          body: "one-online",
          visibility: "PUBLIC",
        },
      }),
      playerTwo.request.post(`${baseUrl}/api/dice`, {
        data: { actionId: actionId(), formula: "1d20", visibility: "PUBLIC" },
      }),
    ]);
    await Promise.all([expectOk(chatResponse), expectOk(diceResponse)]);
    await gmPage.getByRole("button", { name: /Чат/ }).click();
    await expect(gmPage.getByText("one-online")).toBeVisible();

    const [createdScene] = await Promise.all([
      gm.request.post(`${baseUrl}/api/scenes`, {
        data: { actionId: actionId(), name: "Second scene" },
      }),
    ]);
    await expectOk(createdScene);
    const scene = (await createdScene.json()) as { id: string };
    const switched = new Promise<GameSnapshot>((resolve) =>
      twoConnection.socket.once("game:snapshot", resolve),
    );
    await expectOk(
      await gm.request.post(`${baseUrl}/api/scenes/activate`, {
        data: { actionId: actionId(), sceneId: scene.id },
      }),
    );
    expect((await switched).scenes).toMatchObject([
      { id: scene.id, active: true },
    ]);

    twoConnection.socket.disconnect();
    const reconnected = new Promise<void>((resolve) =>
      twoConnection.socket.once("connect", resolve),
    );
    const recovered = new Promise<GameSnapshot>((resolve) =>
      twoConnection.socket.once("game:snapshot", resolve),
    );
    twoConnection.socket.connect();
    await reconnected;
    expect((await recovered).scenes[0]).toMatchObject({
      id: scene.id,
      active: true,
    });
  } finally {
    for (const socket of sockets) socket.disconnect();
    await Promise.all([gm.close(), playerOne.close(), playerTwo.close()]);
  }
});
