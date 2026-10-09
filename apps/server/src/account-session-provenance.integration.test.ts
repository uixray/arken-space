import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { accountSessions, campaigns, characterControllers, characters, gmAccessCredentials, invites, memberships, playerAccessGrants, sessions, users } from "@arken/db";
import { authFromSessionToken, createSession } from "./auth.js";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { claimInviteOwnership } from "./routes.js";

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
});

afterEach(async () => { await database.close(); });

async function seed(role: "GM" | "PLAYER") {
  const [campaign] = await db.insert(campaigns).values({ name: "Provenance" }).returning();
  const [membership] = await db.insert(memberships).values({ campaignId: campaign!.id, role, displayName: "Fixture" }).returning();
  return { campaignId: campaign!.id, membershipId: membership!.id };
}

async function makeSession(membershipId: string, source: Record<string, unknown>) {
  const token = `source-${crypto.randomUUID()}`;
  const [row] = await db.insert(sessions).values({
    membershipId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60_000),
    ...source,
  } as never).returning();
  return { token, id: row!.id };
}

describe("game session provenance", () => {
  it("does not mutate ownership when a legacy invite is expired or revoked before claim", async () => {
    const gm = await seed("GM");
    const [character] = await db.insert(characters).values({ campaignId: gm.campaignId, ownerMembershipId: gm.membershipId, name: "Keep ownership" }).returning();
    for (const staleState of ["expired", "revoked"] as const) {
      const [invite] = await db.insert(invites).values({
        campaignId: gm.campaignId,
        characterId: character!.id,
        label: "Stale",
        tokenHash: hashToken(`legacy-${staleState}`),
        expiresAt: staleState === "expired" ? new Date(Date.now() - 1000) : new Date(Date.now() + 60_000),
        revokedAt: staleState === "revoked" ? new Date() : null,
      }).returning();
      await expect(claimInviteOwnership(db as never, invite!, "New Player")).rejects.toThrow("INVITE_UNAVAILABLE");
      expect(await db.select().from(memberships)).toHaveLength(1);
      expect((await db.select({ ownerMembershipId: characters.ownerMembershipId }).from(characters).where(eq(characters.id, character!.id)))[0]?.ownerMembershipId).toBe(gm.membershipId);
      expect((await db.select({ claimedAt: invites.claimedAt, claimedByMembershipId: invites.claimedByMembershipId }).from(invites).where(eq(invites.id, invite!.id)))[0]).toEqual({ claimedAt: null, claimedByMembershipId: null });
      expect(await db.select().from(characterControllers)).toHaveLength(0);
    }
  });

  it("rechecks invite expiry after waiting for a concurrent row lock", async () => {
    const gm = await seed("GM");
    const [character] = await db.insert(characters).values({ campaignId: gm.campaignId, ownerMembershipId: gm.membershipId, name: "Expiry race" }).returning();
    const [invite] = await db.insert(invites).values({
      campaignId: gm.campaignId, characterId: character!.id, label: "Expiry race",
      tokenHash: hashToken("legacy-expiry-race"), expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    let locked!: () => void;
    let release!: () => void;
    const lockReady = new Promise<void>((resolve) => { locked = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.transaction(async (tx) => {
      await tx.select({ id: invites.id }).from(invites).where(eq(invites.id, invite!.id)).for("update");
      locked();
      await hold;
      await tx.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, invite!.id));
    });
    await lockReady;
    const claim = claimInviteOwnership(db as never, invite!, "Should not exist");
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await blocker;
    await expect(claim).rejects.toThrow("INVITE_UNAVAILABLE");
    expect(await db.select().from(memberships)).toHaveLength(1);
    expect((await db.select({ ownerMembershipId: characters.ownerMembershipId }).from(characters).where(eq(characters.id, character!.id)))[0]?.ownerMembershipId).toBe(gm.membershipId);
    expect((await db.select({ claimedAt: invites.claimedAt }).from(invites).where(eq(invites.id, invite!.id)))[0]?.claimedAt).toBeNull();
  });
  it("rejects NULL-valued and incomplete provenance combinations at the database boundary", async () => {
    const gm = await seed("GM");
    await db.insert(gmAccessCredentials).values({ campaignId: gm.campaignId, tokenHash: hashToken("db-check-gm") });
    const [user] = await db.insert(users).values({ emailNormalized: "check@example.invalid", emailDisplay: "check@example.invalid", passwordHash: "$scrypt$test$not-a-login", verifiedAt: new Date() }).returning();
    const [parent] = await db.insert(accountSessions).values({ userId: user!.id, tokenHash: hashToken("db-check-parent"), csrfHash: hashToken("db-check-csrf"), expiresAt: new Date(Date.now() + 60_000) }).returning();
    const insert = (source: Record<string, unknown>) => db.insert(sessions).values({
      membershipId: gm.membershipId,
      tokenHash: hashToken(crypto.randomUUID()),
      expiresAt: new Date(Date.now() + 60_000),
      ...source,
    } as never);
    await expect(insert({ accountSessionId: parent!.id })).rejects.toThrow();
    await expect(insert({ authSource: "ACCOUNT" })).rejects.toThrow();
    await expect(insert({ authSource: "GM_LINK", gmCredentialCampaignId: gm.campaignId })).rejects.toThrow();
  });

  it("validates GM credential campaign and revision", async () => {
    const gm = await seed("GM");
    await db.insert(gmAccessCredentials).values({ campaignId: gm.campaignId, tokenHash: hashToken("gm-link") });
    const session = await makeSession(gm.membershipId, { authSource: "GM_LINK", gmCredentialCampaignId: gm.campaignId, gmCredentialRevision: 0 });
    expect(await authFromSessionToken(db as never, session.token)).toMatchObject({ membershipId: gm.membershipId, campaignId: gm.campaignId });
    await db.update(gmAccessCredentials).set({ revision: 1 }).where(eq(gmAccessCredentials.campaignId, gm.campaignId));
    expect(await authFromSessionToken(db as never, session.token)).toBeNull();
  });

  it("validates PLAYER grant identity, role and revision", async () => {
    const player = await seed("PLAYER");
    const [grant] = await db.insert(playerAccessGrants).values({ campaignId: player.campaignId, membershipId: player.membershipId, label: "Fixture", tokenHash: hashToken("player-grant") }).returning();
    const session = await makeSession(player.membershipId, { authSource: "PLAYER_GRANT", playerAccessGrantId: grant!.id, playerAccessGrantRevision: grant!.revision });
    expect(await authFromSessionToken(db as never, session.token)).toMatchObject({ membershipId: player.membershipId });
    await db.update(playerAccessGrants).set({ revision: grant!.revision + 1 }).where(eq(playerAccessGrants.id, grant!.id));
    expect(await authFromSessionToken(db as never, session.token)).toBeNull();
    await db.update(memberships).set({ role: "GM" }).where(eq(memberships.id, player.membershipId));
    expect(await authFromSessionToken(db as never, session.token)).toBeNull();
  });

  it("accepts only claimed PLAYER legacy invites and invalidates their sessions on revocation", async () => {
    const player = await seed("PLAYER");
    const [character] = await db.insert(characters).values({ campaignId: player.campaignId, name: "Invite character" }).returning();
    const [invite] = await db.insert(invites).values({
      campaignId: player.campaignId, characterId: character!.id, label: "Fixture",
      tokenHash: hashToken("legacy-invite"), expiresAt: new Date(Date.now() - 1000),
      claimedAt: new Date(), claimedByMembershipId: player.membershipId,
    }).returning();
    const session = await makeSession(player.membershipId, { authSource: "LEGACY_INVITE", legacyInviteId: invite!.id });
    expect(await authFromSessionToken(db as never, session.token)).toMatchObject({ role: "PLAYER" });
    await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, invite!.id));
    expect(await authFromSessionToken(db as never, session.token)).toBeNull();
    await db.update(invites).set({ revokedAt: null }).where(eq(invites.id, invite!.id));
    await db.update(memberships).set({ role: "GM" }).where(eq(memberships.id, player.membershipId));
    expect(await authFromSessionToken(db as never, session.token)).toBeNull();
    await expect(createSession(db as never, { setCookie() {} } as never, player.membershipId, { source: "LEGACY_INVITE", inviteId: invite!.id })).rejects.toThrow("LEGACY_INVITE_MEMBERSHIP_MISMATCH");
  });

  it("fails closed for unbound historical sessions and links when link access is disabled in account mode", async () => {
    const oldAccountMode = env.ACCOUNT_AUTH_ENABLED;
    const oldLinksMode = env.CAMPAIGN_LINK_ACCESS_ENABLED;
    try {
      const gm = await seed("GM");
      await db.insert(gmAccessCredentials).values({ campaignId: gm.campaignId, tokenHash: hashToken("link") });
      const linkSession = await makeSession(gm.membershipId, { authSource: "GM_LINK", gmCredentialCampaignId: gm.campaignId, gmCredentialRevision: 0 });
      const legacySession = await makeSession(gm.membershipId, {});
      Object.assign(env, { ACCOUNT_AUTH_ENABLED: true, CAMPAIGN_LINK_ACCESS_ENABLED: false });
      expect(await authFromSessionToken(db as never, linkSession.token)).toBeNull();
      expect(await authFromSessionToken(db as never, legacySession.token)).toBeNull();
      Object.assign(env, { ACCOUNT_AUTH_ENABLED: oldAccountMode, CAMPAIGN_LINK_ACCESS_ENABLED: oldLinksMode });
      expect(await authFromSessionToken(db as never, linkSession.token)).toMatchObject({ membershipId: gm.membershipId });
    } finally {
      Object.assign(env, { ACCOUNT_AUTH_ENABLED: oldAccountMode, CAMPAIGN_LINK_ACCESS_ENABLED: oldLinksMode });
    }
  });
});
