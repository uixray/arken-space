import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, gt } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { accountCampaignCreations, accountCampaignInvites, accountSessions, campaignAudioTracks, campaigns, characters, memberships, scenes, sessions, users } from "@arken/db";
import { registerAccountCampaignRoutes } from "./account-campaigns.js";
import { hashToken } from "./security.js";

const origin = "http://localhost:5173";
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: ReturnType<typeof Fastify>;
let io: { disconnected: string[]; in: (room: string) => { disconnectSockets: () => void } };

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  app = Fastify();
  await app.register(cookie);
  io = { disconnected: [], in(room) { return { disconnectSockets: () => { this.disconnected.push(room); } }; } };
  registerAccountCampaignRoutes(app as never, db as never, io as never, {
    enabled: true,
    creationEnabled: true,
    creationLimit: 2,
    sessionTtlDays: 30,
    cookieSecure: false,
    accountCookieName: "arken_account",
    gameCookieName: "arken_session",
    csrfCookieName: "arken_account_csrf",
    webOrigin: origin,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

async function makeAccount(email: string) {
  const [user] = await db.insert(users).values({
    emailNormalized: email,
    emailDisplay: email,
    passwordHash: "$scrypt$test$not-a-login-credential",
    verifiedAt: new Date(),
  }).returning();
  const accountToken = `account-${crypto.randomUUID()}`;
  const csrfToken = `csrf-${crypto.randomUUID()}`;
  const [session] = await db.insert(accountSessions).values({
    userId: user!.id,
    tokenHash: hashToken(accountToken),
    csrfHash: hashToken(csrfToken),
    expiresAt: new Date(Date.now() + 60_000),
  }).returning();
  return {
    userId: user!.id,
    accountSessionId: session!.id,
    csrf: csrfToken,
    cookie: `arken_account=${accountToken}; arken_account_csrf=${csrfToken}`,
  };
}

function post(url: string, body: unknown, actor: Awaited<ReturnType<typeof makeAccount>>, extra: Record<string, string> = {}) {
  return app.inject({ method: "POST", url, payload: body, headers: { origin, cookie: actor.cookie, "x-csrf-token": actor.csrf, ...extra } });
}

describe("account campaign workspace", () => {
  it("creates only minimal isolated campaign state, is idempotent, and selects only owned campaigns", async () => {
    const a = await makeAccount("gm-a@example.invalid");
    const b = await makeAccount("gm-b@example.invalid");
    const firstKey = crypto.randomUUID();
    const created = await post("/api/account/campaigns", { name: "A table", idempotencyKey: firstKey }, a);
    expect(created.statusCode).toBe(201);
    const first = created.json();
    expect(first).toMatchObject({ name: "A table", role: "GM" });
    const campaign = await db.select().from(campaigns).where(eq(campaigns.id, first.campaignId));
    expect(campaign[0]?.activeSceneId).toBeTruthy();
    expect(await db.select().from(scenes).where(eq(scenes.campaignId, first.campaignId))).toHaveLength(1);
    expect(await db.select().from(campaignAudioTracks).where(eq(campaignAudioTracks.campaignId, first.campaignId))).toHaveLength(1);
    expect(await db.select().from(characters).where(eq(characters.campaignId, first.campaignId))).toHaveLength(0);
    expect(await db.select({ userId: memberships.userId, role: memberships.role, displayName: memberships.displayName })
      .from(memberships).where(eq(memberships.campaignId, first.campaignId)))
      .toEqual([{ userId: a.userId, role: "GM", displayName: "Game Master" }]);
    expect(await db.select().from(accountCampaignCreations)).toHaveLength(1);

    const replay = await post("/api/account/campaigns", { name: "A table", idempotencyKey: firstKey }, a);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().campaignId).toBe(first.campaignId);
    const conflict = await post("/api/account/campaigns", { name: "Different", idempotencyKey: firstKey }, a);
    expect(conflict.statusCode).toBe(409);
    expect((await post("/api/account/campaigns/select", { campaignId: first.campaignId }, b)).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/account/campaigns", headers: { cookie: a.cookie } })).json().campaigns).toHaveLength(1);
    expect((await app.inject({ url: "/api/account/campaigns", headers: { cookie: b.cookie } })).json().campaigns).toHaveLength(0);
  });

  it("claims one-use player invitations only for verified accounts and disconnects the prior selection", async () => {
    const gm = await makeAccount("gm@example.invalid");
    const player = await makeAccount("player@example.invalid");
    const first = await post("/api/account/campaigns", { name: "Invite table", idempotencyKey: crypto.randomUUID() }, gm);
    const campaignId = first.json().campaignId as string;
    const inviteResponse = await post("/api/account/campaigns/invites", { campaignId, label: "Player One", expiresInHours: 72 }, gm);
    expect(inviteResponse.statusCode).toBe(201);
    expect(inviteResponse.json().role).toBe("PLAYER");
    const invite = inviteResponse.json();
    const persisted = await db.select().from(accountCampaignInvites).where(eq(accountCampaignInvites.id, invite.inviteId));
    expect(persisted[0]?.tokenHash).not.toBe(invite.token);

    const claim = await post("/api/account/campaigns/invites/claim", { token: invite.token }, player);
    expect(claim.statusCode).toBe(201);
    expect(claim.json()).toMatchObject({ campaignId, role: "PLAYER" });
    const playerMembership = await db.select().from(memberships).where(and(eq(memberships.userId, player.userId), eq(memberships.campaignId, campaignId)));
    expect(playerMembership).toHaveLength(1);
    expect(playerMembership[0]).toMatchObject({ role: "PLAYER", displayName: "Player One" });
    expect((await post("/api/account/campaigns/invites/claim", { token: invite.token }, player)).statusCode).toBe(400);

    const selection = await post("/api/account/campaigns/select", { campaignId }, gm, { cookie: `${gm.cookie}; arken_session=old-game-token` });
    expect(selection.statusCode).toBe(200);
    const old = await db.insert(sessions).values({
      membershipId: first.json().membershipId,
      tokenHash: hashToken("old-game-token"),
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    const refreshed = await post("/api/account/campaigns/select", { campaignId }, gm, { cookie: `${gm.cookie}; arken_session=old-game-token` });
    expect(refreshed.statusCode).toBe(200);
    expect(io.disconnected).toContain(`session:${old[0]!.id}`);
  });

  it("enforces CSRF, explicit creation policy, bounded per-account count and invite revocation", async () => {
    const gm = await makeAccount("gm-limits@example.invalid");
    const missingCsrf = await app.inject({ method: "POST", url: "/api/account/campaigns", payload: { name: "No", idempotencyKey: crypto.randomUUID() }, headers: { origin, cookie: gm.cookie } });
    expect(missingCsrf.statusCode).toBe(403);
    const first = await post("/api/account/campaigns", { name: "One", idempotencyKey: crypto.randomUUID() }, gm);
    const second = await post("/api/account/campaigns", { name: "Two", idempotencyKey: crypto.randomUUID() }, gm);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect((await post("/api/account/campaigns", { name: "Three", idempotencyKey: crypto.randomUUID() }, gm)).statusCode).toBe(429);
    const campaignId = first.json().campaignId as string;
    const invite = (await post("/api/account/campaigns/invites", { campaignId, label: "Revokable" }, gm)).json();
    expect((await post("/api/account/campaigns/invites/revoke", { campaignId, inviteId: invite.inviteId }, gm)).statusCode).toBe(200);
    const player = await makeAccount("invitee@example.invalid");
    expect((await post("/api/account/campaigns/invites/claim", { token: invite.token }, player)).statusCode).toBe(400);
  });

  it("serializes concurrent campaign selections to one active account-backed game session", async () => {
    const gm = await makeAccount("select-race@example.invalid");
    const one = await post("/api/account/campaigns", { name: "One", idempotencyKey: crypto.randomUUID() }, gm);
    const two = await post("/api/account/campaigns", { name: "Two", idempotencyKey: crypto.randomUUID() }, gm);
    const [first, second] = await Promise.all([
      post("/api/account/campaigns/select", { campaignId: one.json().campaignId }, gm),
      post("/api/account/campaigns/select", { campaignId: two.json().campaignId }, gm),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const active = await db.select().from(sessions).where(and(
      eq(sessions.accountSessionId, gm.accountSessionId),
      gt(sessions.expiresAt, new Date()),
    ));
    expect(active).toHaveLength(1);
    expect([one.json().campaignId, two.json().campaignId]).toContain(
      (await db.select({ campaignId: memberships.campaignId }).from(memberships).where(eq(memberships.id, active[0]!.membershipId)))[0]?.campaignId,
    );
  });
});
