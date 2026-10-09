import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { and, count, eq, gt, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import {
  accountCampaignCreations,
  accountCampaignInvites,
  accountSessions,
  campaignAudioTracks,
  campaigns,
  memberships,
  scenes,
  sessions,
  users,
} from "@arken/db";
import {
  accountCampaignCreateSchema,
  accountCampaignIdSchema,
  accountCampaignInviteClaimSchema,
  accountCampaignInviteCreateSchema,
  accountCampaignInviteRevokeSchema,
  accountCampaignListSchema,
} from "@arken/contracts";
import { hashToken, randomToken, safeEqual } from "./security.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeSessions = { in: (room: string) => { disconnectSockets: (close?: boolean) => unknown } };
export type AccountCampaignOptions = {
  enabled: boolean;
  creationEnabled: boolean;
  creationLimit: number;
  sessionTtlDays: number;
  cookieSecure: boolean;
  accountCookieName: string;
  csrfCookieName: string;
  gameCookieName: string;
  webOrigin: string;
};

const INVITE_MAX_TTL_HOURS = 168;
class CampaignCreationLimitError extends Error {}
class CampaignIdempotencyConflictError extends Error {}

async function accountForRequest(request: FastifyRequest, db: Database, options: AccountCampaignOptions) {
  const token = request.cookies?.[options.accountCookieName];
  if (!token) return null;
  const [account] = await db.select({
    id: accountSessions.id,
    userId: users.id,
    csrfHash: accountSessions.csrfHash,
  }).from(accountSessions)
    .innerJoin(users, eq(accountSessions.userId, users.id))
    .where(and(
      eq(accountSessions.tokenHash, hashToken(token)),
      isNull(accountSessions.revokedAt),
      gt(accountSessions.expiresAt, new Date()),
      isNotNull(users.verifiedAt),
      isNull(users.disabledAt),
    )).limit(1);
  return account ?? null;
}

async function requireAccount(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
  options: AccountCampaignOptions,
  mutation = false,
) {
  if (!options.enabled) {
    await reply.code(404).send({ error: "ACCOUNT_AUTH_DISABLED" });
    return null;
  }
  if (mutation && request.headers.origin !== options.webOrigin) {
    await reply.code(403).send({ error: "ORIGIN_FORBIDDEN" });
    return null;
  }
  const account = await accountForRequest(request, db, options);
  if (!account) {
    await reply.code(401).send({ error: "ACCOUNT_AUTH_REQUIRED" });
    return null;
  }
  if (mutation) {
    const header = request.headers["x-csrf-token"];
    const cookie = request.cookies?.[options.csrfCookieName];
    if (typeof header !== "string" || !cookie || !safeEqual(header, cookie) || !safeEqual(hashToken(header), account.csrfHash)) {
      await reply.code(403).send({ error: "CSRF_REJECTED" });
      return null;
    }
  }
  return account;
}

async function ownedMembership(db: Database, userId: string, campaignId: string, role?: "GM" | "PLAYER") {
  const [row] = await db.select({
    id: memberships.id,
    campaignId: memberships.campaignId,
    role: memberships.role,
    displayName: memberships.displayName,
    campaignName: campaigns.name,
  }).from(memberships)
    .innerJoin(campaigns, eq(campaigns.id, memberships.campaignId))
    .where(and(
      eq(memberships.userId, userId),
      eq(memberships.campaignId, campaignId),
      ...(role ? [eq(memberships.role, role)] : []),
    )).limit(1);
  return row ?? null;
}

async function replaceSelectedGameSession(
  db: Database,
  io: RealtimeSessions,
  request: FastifyRequest,
  reply: FastifyReply,
  membershipId: string,
  accountSessionId: string,
  options: AccountCampaignOptions,
) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + options.sessionTtlDays * 86_400_000);
  const result = await db.transaction(async (tx) => {
    const [parent] = await tx.select({ userId: accountSessions.userId }).from(accountSessions)
      .innerJoin(users, eq(accountSessions.userId, users.id))
      .where(and(
        eq(accountSessions.id, accountSessionId),
        isNull(accountSessions.revokedAt),
        sql`${accountSessions.expiresAt} > clock_timestamp()`,
        isNotNull(users.verifiedAt),
        isNull(users.disabledAt),
      )).for("update").limit(1);
    if (!parent) return null;
    const [membership] = await tx.select({ id: memberships.id }).from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.userId, parent.userId))).limit(1);
    if (!membership) return null;
    const previous = await tx.select({ id: sessions.id }).from(sessions)
      .where(and(eq(sessions.accountSessionId, accountSessionId), gt(sessions.expiresAt, new Date())));
    const staleIds = new Set(previous.map((session) => session.id));
    const oldToken = request.cookies?.[options.gameCookieName];
    if (oldToken) {
      const [old] = await tx.select({ id: sessions.id }).from(sessions)
        .where(eq(sessions.tokenHash, hashToken(oldToken))).limit(1);
      if (old) staleIds.add(old.id);
    }
    if (staleIds.size)
      await tx.update(sessions).set({ expiresAt: new Date(0) }).where(inArray(sessions.id, [...staleIds]));
    const [created] = await tx.insert(sessions).values({
      membershipId,
      accountSessionId,
      authSource: "ACCOUNT",
      tokenHash: hashToken(token),
      expiresAt,
    }).returning({ id: sessions.id });
    if (!created) return null;
    return { staleIds: [...staleIds] };
  });
  if (!result) {
    await reply.code(401).send({ error: "ACCOUNT_AUTH_REQUIRED" });
    return false;
  }
  for (const id of result.staleIds) io.in(`session:${id}`).disconnectSockets(true);
  reply.setCookie(options.gameCookieName, token, {
    httpOnly: true,
    secure: options.cookieSecure,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
  return true;
}

export function registerAccountCampaignRoutes(
  app: FastifyInstance<any, any, any, any>,
  db: Database,
  io: RealtimeSessions,
  options: AccountCampaignOptions,
) {
  app.get("/api/account/campaigns", async (request, reply) => {
    const account = await requireAccount(request, reply, db, options);
    if (!account) return;
    const rows = await db.select({
      id: campaigns.id,
      name: campaigns.name,
      role: memberships.role,
      membershipId: memberships.id,
      selected: sessions.id,
    }).from(memberships)
      .innerJoin(campaigns, eq(campaigns.id, memberships.campaignId))
      .leftJoin(sessions, and(
        eq(sessions.membershipId, memberships.id),
        eq(sessions.tokenHash, hashToken(request.cookies?.[options.gameCookieName] ?? "")),
        gt(sessions.expiresAt, new Date()),
      ))
      .where(eq(memberships.userId, account.userId));
    return reply.header("cache-control", "no-store").send(accountCampaignListSchema.parse({
      campaigns: rows.map((row) => ({ ...row, selected: Boolean(row.selected) })),
    }));
  });

  app.post("/api/account/campaigns", { bodyLimit: 4096 }, async (request, reply) => {
    const account = await requireAccount(request, reply, db, options, true);
    if (!account) return;
    const body = accountCampaignCreateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_CAMPAIGN_INPUT" });
    if (!options.creationEnabled) return reply.code(403).send({ error: "CAMPAIGN_CREATION_DISABLED" });
    const payloadHash = hashToken(body.data.name);
    const [prior] = await db.select().from(accountCampaignCreations).where(and(
      eq(accountCampaignCreations.userId, account.userId),
      eq(accountCampaignCreations.idempotencyKey, body.data.idempotencyKey),
    )).limit(1);
    if (prior) {
      if (prior.payloadHash !== payloadHash) return reply.code(409).send({ error: "IDEMPOTENCY_KEY_CONFLICT" });
      const owned = await ownedMembership(db, account.userId, prior.campaignId, "GM");
      if (!owned) return reply.code(503).send({ error: "CAMPAIGN_STATE_UNAVAILABLE" });
      if (!(await replaceSelectedGameSession(db, io, request, reply, owned.id, account.id, options))) return;
      return reply.code(200).send({ campaignId: owned.campaignId, membershipId: owned.id, name: owned.campaignName, role: "GM" });
    }
    const now = new Date();
    let created: { campaignId: string; membershipId: string; name: string; replay?: boolean } | null = null;
    try {
      created = await db.transaction(async (tx) => {
        // Serialize per-account creation so the configured ceiling is not
        // bypassed by concurrent requests from the same verified account.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, account.userId)).for("update");
        const [existing] = await tx.select({
          campaignId: accountCampaignCreations.campaignId,
          payloadHash: accountCampaignCreations.payloadHash,
          membershipId: memberships.id,
          name: campaigns.name,
        }).from(accountCampaignCreations)
          .innerJoin(memberships, and(eq(memberships.campaignId, accountCampaignCreations.campaignId), eq(memberships.userId, account.userId), eq(memberships.role, "GM")))
          .innerJoin(campaigns, eq(campaigns.id, accountCampaignCreations.campaignId))
          .where(and(eq(accountCampaignCreations.userId, account.userId), eq(accountCampaignCreations.idempotencyKey, body.data.idempotencyKey)))
          .limit(1);
        if (existing) {
          if (existing.payloadHash !== payloadHash) throw new CampaignIdempotencyConflictError();
          return { campaignId: existing.campaignId, membershipId: existing.membershipId, name: existing.name, replay: true };
        }
        const [campaignCount] = await tx.select({ value: count() }).from(memberships)
          .where(and(eq(memberships.userId, account.userId), eq(memberships.role, "GM")));
        if ((campaignCount?.value ?? 0) >= options.creationLimit) throw new CampaignCreationLimitError();
        const [campaign] = await tx.insert(campaigns).values({ name: body.data.name }).returning({ id: campaigns.id, name: campaigns.name });
        if (!campaign) throw new Error("CAMPAIGN_CREATE_FAILED");
        const [membership] = await tx.insert(memberships).values({
          campaignId: campaign.id,
          userId: account.userId,
          role: "GM",
          displayName: "Game Master",
        }).returning({ id: memberships.id });
        if (!membership) throw new Error("GM_MEMBERSHIP_CREATE_FAILED");
        const [scene] = await tx.insert(scenes).values({
          campaignId: campaign.id,
          name: "First scene",
          grid: { enabled: true, size: 64, offsetX: 0, offsetY: 0, color: "#c8b78b", opacity: 0.22 },
        }).returning({ id: scenes.id });
        if (!scene) throw new Error("STARTER_SCENE_CREATE_FAILED");
        await tx.update(campaigns).set({ activeSceneId: scene.id }).where(eq(campaigns.id, campaign.id));
        await tx.insert(campaignAudioTracks).values({ campaignId: campaign.id });
        await tx.insert(accountCampaignCreations).values({
          userId: account.userId,
          idempotencyKey: body.data.idempotencyKey,
          payloadHash,
          campaignId: campaign.id,
        });
        return { campaignId: campaign.id, membershipId: membership.id, name: campaign.name, replay: false };
      });
    } catch (error) {
      if (error instanceof CampaignCreationLimitError)
        return reply.code(429).send({ error: "CAMPAIGN_CREATION_LIMIT_REACHED" });
      if (error instanceof CampaignIdempotencyConflictError)
        return reply.code(409).send({ error: "IDEMPOTENCY_KEY_CONFLICT" });
      const [race] = await db.select().from(accountCampaignCreations).where(and(
        eq(accountCampaignCreations.userId, account.userId),
        eq(accountCampaignCreations.idempotencyKey, body.data.idempotencyKey),
      )).limit(1);
      if (!race) return reply.code(503).send({ error: "CAMPAIGN_CREATE_UNAVAILABLE" });
      if (race.payloadHash !== payloadHash) return reply.code(409).send({ error: "IDEMPOTENCY_KEY_CONFLICT" });
      const owned = await ownedMembership(db, account.userId, race.campaignId, "GM");
      if (!owned) return reply.code(503).send({ error: "CAMPAIGN_STATE_UNAVAILABLE" });
      created = { campaignId: owned.campaignId, membershipId: owned.id, name: owned.campaignName, replay: true };
    }
    if (!(await replaceSelectedGameSession(db, io, request, reply, created.membershipId, account.id, options))) return;
    return reply.code(created.replay ? 200 : 201).send({ campaignId: created.campaignId, membershipId: created.membershipId, name: created.name, role: "GM" });
  });

  app.post("/api/account/campaigns/select", { bodyLimit: 2048 }, async (request, reply) => {
    const account = await requireAccount(request, reply, db, options, true);
    if (!account) return;
    const body = accountCampaignIdSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_CAMPAIGN_INPUT" });
    const owned = await ownedMembership(db, account.userId, body.data.campaignId);
    if (!owned) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (!(await replaceSelectedGameSession(db, io, request, reply, owned.id, account.id, options))) return;
    return reply.send({ campaignId: owned.campaignId, membershipId: owned.id, role: owned.role });
  });

  app.post("/api/account/campaigns/invites", { bodyLimit: 4096 }, async (request, reply) => {
    const account = await requireAccount(request, reply, db, options, true);
    if (!account) return;
    const body = accountCampaignInviteCreateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_INVITE_INPUT" });
    const gm = await ownedMembership(db, account.userId, body.data.campaignId, "GM");
    if (!gm) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + Math.min(body.data.expiresInHours, INVITE_MAX_TTL_HOURS) * 3_600_000);
    const [invite] = await db.insert(accountCampaignInvites).values({
      campaignId: gm.campaignId,
      createdByMembershipId: gm.id,
      tokenHash: hashToken(token),
      label: body.data.label,
      expiresAt,
    }).returning({ id: accountCampaignInvites.id });
    return reply.code(201).send({ inviteId: invite!.id, token, expiresAt, role: "PLAYER" });
  });

  app.get<{ Params: { campaignId: string } }>("/api/account/campaigns/:campaignId/invites", async (request, reply) => {
    const account = await requireAccount(request, reply, db, options);
    if (!account) return;
    const params = accountCampaignIdSchema.safeParse({ campaignId: request.params.campaignId });
    if (!params.success) return reply.code(400).send({ error: "INVALID_CAMPAIGN_INPUT" });
    const gm = await ownedMembership(db, account.userId, params.data.campaignId, "GM");
    if (!gm) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    const rows = await db.select({ id: accountCampaignInvites.id, label: accountCampaignInvites.label, expiresAt: accountCampaignInvites.expiresAt, claimedAt: accountCampaignInvites.claimedAt, revokedAt: accountCampaignInvites.revokedAt })
      .from(accountCampaignInvites).where(eq(accountCampaignInvites.campaignId, gm.campaignId));
    return reply.header("cache-control", "no-store").send({ invites: rows });
  });

  app.post("/api/account/campaigns/invites/revoke", { bodyLimit: 2048 }, async (request, reply) => {
    const account = await requireAccount(request, reply, db, options, true);
    if (!account) return;
    const body = accountCampaignInviteRevokeSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_INVITE_INPUT" });
    const gm = await ownedMembership(db, account.userId, body.data.campaignId, "GM");
    if (!gm) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    const [revoked] = await db.update(accountCampaignInvites).set({ revokedAt: new Date() }).where(and(
      eq(accountCampaignInvites.id, body.data.inviteId),
      eq(accountCampaignInvites.campaignId, gm.campaignId),
      isNull(accountCampaignInvites.claimedAt),
      isNull(accountCampaignInvites.revokedAt),
    )).returning({ id: accountCampaignInvites.id });
    return revoked ? reply.send({ ok: true }) : reply.code(409).send({ error: "INVITE_UNAVAILABLE" });
  });

  app.post("/api/account/campaigns/invites/claim", { bodyLimit: 2048 }, async (request, reply) => {
    const account = await requireAccount(request, reply, db, options, true);
    if (!account) return;
    const body = accountCampaignInviteClaimSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_INVITE_INPUT" });
    const now = new Date();
    try {
      const claimed = await db.transaction(async (tx) => {
        const [invite] = await tx.update(accountCampaignInvites).set({ claimedAt: now, claimedByUserId: account.userId }).where(and(
          eq(accountCampaignInvites.tokenHash, hashToken(body.data.token)),
          isNull(accountCampaignInvites.claimedAt),
          isNull(accountCampaignInvites.revokedAt),
          gt(accountCampaignInvites.expiresAt, now),
        )).returning({ campaignId: accountCampaignInvites.campaignId, label: accountCampaignInvites.label });
        if (!invite) return null;
        const [membership] = await tx.insert(memberships).values({
          campaignId: invite.campaignId,
          userId: account.userId,
          role: "PLAYER",
          displayName: invite.label,
        }).returning({ id: memberships.id });
        if (!membership) throw new Error("INVITE_CLAIM_FAILED");
        return { campaignId: invite.campaignId, membershipId: membership.id };
      });
      if (!claimed) return reply.code(400).send({ error: "INVITE_INVALID_OR_EXPIRED" });
      if (!(await replaceSelectedGameSession(db, io, request, reply, claimed.membershipId, account.id, options))) return;
      return reply.code(201).send({ ...claimed, role: "PLAYER" });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505")
        return reply.code(409).send({ error: "ACCOUNT_ALREADY_IN_CAMPAIGN" });
      return reply.code(503).send({ error: "INVITE_CLAIM_UNAVAILABLE" });
    }
  });
}
