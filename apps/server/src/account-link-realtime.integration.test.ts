import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { Server } from "socket.io";
import { io as socketClient, type Socket } from "socket.io-client";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import {
  campaigns,
  characters,
  gmAccessCredentials,
  invites,
  memberships,
  playerAccessGrants,
  sessions,
} from "@arken/db";
import { registerRealtime } from "./realtime.js";
import { hashToken } from "./security.js";

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: ReturnType<typeof Fastify>;
let realtime: Server;
let sockets: Socket[];

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  app = Fastify({ logger: false });
  await app.register(cookie);
  realtime = new Server(app.server);
  sockets = [];
  registerRealtime(realtime as never, db as never, app.log, { buildSnapshot: async () => ({}) as never });
  await app.listen({ host: "127.0.0.1", port: 0 });
});

afterEach(async () => {
  for (const socket of sockets) socket.disconnect();
  await realtime.close();
  await app.close();
  await database.close();
});

async function connectGame(token: string) {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("HTTP_SERVER_NOT_LISTENING");
  const socket = socketClient(`http://127.0.0.1:${address.port}`, {
    transports: ["websocket"],
    extraHeaders: { cookie: `arken_session=${token}` },
    reconnection: false,
    timeout: 2500,
  });
  sockets.push(socket);
  return socket;
}

function waitFor<T>(socket: Socket, event: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 3000);
    socket.once(event, (value: T) => { clearTimeout(timeout); resolve(value); });
    socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
  });
}

async function seedMembership(role: "GM" | "PLAYER") {
  const [campaign] = await db.insert(campaigns).values({ name: "Synthetic realtime provenance" }).returning();
  const [membership] = await db.insert(memberships).values({
    campaignId: campaign!.id,
    role,
    displayName: role === "GM" ? "Synthetic GM" : "Synthetic Player",
  }).returning();
  return { campaign: campaign!, membership: membership! };
}

async function seedSession(membershipId: string, provenance:
  | { source: "GM_LINK"; campaignId: string; revision: number }
  | { source: "PLAYER_GRANT"; grantId: string; revision: number }
  | { source: "LEGACY_INVITE"; inviteId: string }) {
  const token = `synthetic-session-${crypto.randomUUID()}`;
  await db.insert(sessions).values({
    membershipId,
    authSource: provenance.source,
    gmCredentialCampaignId: provenance.source === "GM_LINK" ? provenance.campaignId : null,
    gmCredentialRevision: provenance.source === "GM_LINK" ? provenance.revision : null,
    playerAccessGrantId: provenance.source === "PLAYER_GRANT" ? provenance.grantId : null,
    playerAccessGrantRevision: provenance.source === "PLAYER_GRANT" ? provenance.revision : null,
    legacyInviteId: provenance.source === "LEGACY_INVITE" ? provenance.inviteId : null,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60_000),
  });
  return token;
}

async function assertConnectedSessionIsRejectedAfterInvalidation(token: string, invalidate: () => Promise<void>) {
  const processedEvents: string[] = [];
  realtime.on("connection", (serverSocket) => serverSocket.on("cursor:gone", () => processedEvents.push("cursor:gone")));
  const socket = await connectGame(token);
  await waitFor(socket, "connect");
  const disconnected = waitFor<string>(socket, "disconnect");
  await invalidate();
  // A client event after revocation exercises the production per-event session
  // provenance check, rather than an injected test guard.
  socket.emit("cursor:gone");
  await disconnected;
  expect(processedEvents).not.toContain("cursor:gone");

  const reconnect = await connectGame(token);
  const error = await waitFor<Error>(reconnect, "connect_error");
  expect(error.message).toBe("AUTH_REQUIRED");
  expect(reconnect.connected).toBe(false);
}

describe("link provenance at the realtime boundary", () => {
  it("rejects an already-connected PLAYER after grant revocation and on reconnect", async () => {
    const { campaign, membership } = await seedMembership("PLAYER");
    const grantTokenHash = hashToken(`grant-${crypto.randomUUID()}`);
    const [grant] = await db.insert(playerAccessGrants).values({
      campaignId: campaign.id, membershipId: membership.id, label: "Synthetic grant", tokenHash: grantTokenHash,
    }).returning();
    const token = await seedSession(membership.id, { source: "PLAYER_GRANT", grantId: grant!.id, revision: grant!.revision });
    await assertConnectedSessionIsRejectedAfterInvalidation(token, async () => {
      await db.update(playerAccessGrants).set({ revokedAt: new Date() }).where(eq(playerAccessGrants.id, grant!.id));
    });
  });

  it("rejects an already-connected PLAYER after grant rotation and on reconnect", async () => {
    const { campaign, membership } = await seedMembership("PLAYER");
    const [grant] = await db.insert(playerAccessGrants).values({
      campaignId: campaign.id, membershipId: membership.id, label: "Synthetic grant", tokenHash: hashToken(`grant-${crypto.randomUUID()}`),
    }).returning();
    const token = await seedSession(membership.id, { source: "PLAYER_GRANT", grantId: grant!.id, revision: grant!.revision });
    await assertConnectedSessionIsRejectedAfterInvalidation(token, async () => {
      await db.update(playerAccessGrants).set({ revision: grant!.revision + 1 }).where(eq(playerAccessGrants.id, grant!.id));
    });
  });

  it("rejects an already-connected GM after credential revision rotation and on reconnect", async () => {
    const { campaign, membership } = await seedMembership("GM");
    const [credential] = await db.insert(gmAccessCredentials).values({
      campaignId: campaign.id, tokenHash: hashToken(`gm-${crypto.randomUUID()}`), revision: 1,
    }).returning();
    const token = await seedSession(membership.id, { source: "GM_LINK", campaignId: campaign.id, revision: credential!.revision });
    await assertConnectedSessionIsRejectedAfterInvalidation(token, async () => {
      await db.update(gmAccessCredentials).set({ revision: credential!.revision + 1 }).where(eq(gmAccessCredentials.campaignId, campaign.id));
    });
  });

  it("rejects an already-connected LEGACY_INVITE session after invite revocation and on reconnect", async () => {
    const { campaign, membership } = await seedMembership("PLAYER");
    const [character] = await db.insert(characters).values({ campaignId: campaign.id, ownerMembershipId: membership.id, name: "Synthetic character" }).returning();
    const [invite] = await db.insert(invites).values({
      campaignId: campaign.id,
      characterId: character!.id,
      label: "Synthetic legacy invite",
      tokenHash: hashToken(`invite-${crypto.randomUUID()}`),
      claimedByMembershipId: membership.id,
      claimedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    const token = await seedSession(membership.id, { source: "LEGACY_INVITE", inviteId: invite!.id });
    await assertConnectedSessionIsRejectedAfterInvalidation(token, async () => {
      await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, invite!.id));
    });
  });

});
