import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { accountSessions, gmAccessCredentials, invites, memberships, playerAccessGrants, sessions, users } from "@arken/db";
import type { Role } from "@arken/contracts";
import { env } from "./env.js";
import { hashToken, randomToken } from "./security.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export interface AuthContext {
  membershipId: string;
  campaignId: string;
  role: Role;
  displayName: string;
}

export interface SessionAuthContext extends AuthContext {
  sessionId: string;
}

export type SessionProvenance =
  | { source: "ACCOUNT"; accountSessionId: string }
  | { source: "GM_LINK"; campaignId: string; credentialRevision: number }
  | { source: "PLAYER_GRANT"; grantId: string; grantRevision: number }
  | { source: "LEGACY_INVITE"; inviteId: string };

type SessionSourceRow = {
  sessionId: string;
  authSource: string | null;
  accountSessionId: string | null;
  gmCredentialCampaignId: string | null;
  gmCredentialRevision: number | null;
  playerAccessGrantId: string | null;
  playerAccessGrantRevision: number | null;
  legacyInviteId: string | null;
  membershipId: string;
  campaignId: string;
  role: Role;
  membershipUserId: string | null;
};

async function sessionSourceIsValid(db: Database, row: SessionSourceRow) {
  if (row.authSource === "ACCOUNT" && row.accountSessionId) {
    const [parent] = await db.select({ userId: accountSessions.userId })
      .from(accountSessions)
      .innerJoin(users, eq(accountSessions.userId, users.id))
      .where(and(
        eq(accountSessions.id, row.accountSessionId),
        isNull(accountSessions.revokedAt),
        gt(accountSessions.expiresAt, new Date()),
        isNotNull(users.verifiedAt),
        isNull(users.disabledAt),
      )).limit(1);
    return Boolean(parent && row.membershipUserId === parent.userId);
  }
  if (row.authSource === "GM_LINK" && row.gmCredentialCampaignId && row.gmCredentialRevision !== null) {
    if (env.ACCOUNT_AUTH_ENABLED && !env.CAMPAIGN_LINK_ACCESS_ENABLED) return false;
    if (row.role !== "GM" || row.campaignId !== row.gmCredentialCampaignId) return false;
    const [credential] = await db.select({ campaignId: gmAccessCredentials.campaignId })
      .from(gmAccessCredentials)
      .where(and(
        eq(gmAccessCredentials.campaignId, row.gmCredentialCampaignId),
        eq(gmAccessCredentials.revision, row.gmCredentialRevision),
      )).limit(1);
    return Boolean(credential);
  }
  if (row.authSource === "PLAYER_GRANT" && row.playerAccessGrantId && row.playerAccessGrantRevision !== null) {
    if (env.ACCOUNT_AUTH_ENABLED && !env.CAMPAIGN_LINK_ACCESS_ENABLED) return false;
    if (row.role !== "PLAYER") return false;
    const [grant] = await db.select({ id: playerAccessGrants.id })
      .from(playerAccessGrants)
      .where(and(
        eq(playerAccessGrants.id, row.playerAccessGrantId),
        eq(playerAccessGrants.membershipId, row.membershipId),
        eq(playerAccessGrants.campaignId, row.campaignId),
        eq(playerAccessGrants.revision, row.playerAccessGrantRevision),
        isNull(playerAccessGrants.revokedAt),
      )).limit(1);
    return Boolean(grant);
  }
  if (row.authSource === "LEGACY_INVITE" && row.legacyInviteId) {
    if (env.ACCOUNT_AUTH_ENABLED && !env.CAMPAIGN_LINK_ACCESS_ENABLED) return false;
    if (row.role !== "PLAYER") return false;
    const [invite] = await db.select({ id: invites.id }).from(invites)
      .where(and(
        eq(invites.id, row.legacyInviteId),
        eq(invites.campaignId, row.campaignId),
        eq(invites.claimedByMembershipId, row.membershipId),
        isNotNull(invites.claimedAt),
        isNull(invites.revokedAt),
      )).limit(1);
    return Boolean(invite);
  }
  // Historical/unknown unbound sessions have no trustworthy issuance source.
  return false;
}

export async function authFromSessionToken(
  db: Database,
  token: string | null,
): Promise<SessionAuthContext | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      authSource: sessions.authSource,
      accountSessionId: sessions.accountSessionId,
      gmCredentialCampaignId: sessions.gmCredentialCampaignId,
      gmCredentialRevision: sessions.gmCredentialRevision,
      playerAccessGrantId: sessions.playerAccessGrantId,
      playerAccessGrantRevision: sessions.playerAccessGrantRevision,
      legacyInviteId: sessions.legacyInviteId,
      membershipUserId: memberships.userId,
      membershipId: memberships.id,
      campaignId: memberships.campaignId,
      role: memberships.role,
      displayName: memberships.displayName,
    })
    .from(sessions)
    .innerJoin(memberships, eq(sessions.membershipId, memberships.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (!row.authSource && !env.ACCOUNT_AUTH_ENABLED) return row;
  if (!(await sessionSourceIsValid(db, row))) return null;
  return row;
}

export async function sessionIsActive(
  db: Database,
  sessionId: string,
): Promise<boolean> {
  const [session] = await db
    .select({
      sessionId: sessions.id,
      authSource: sessions.authSource,
      accountSessionId: sessions.accountSessionId,
      gmCredentialCampaignId: sessions.gmCredentialCampaignId,
      gmCredentialRevision: sessions.gmCredentialRevision,
      playerAccessGrantId: sessions.playerAccessGrantId,
      playerAccessGrantRevision: sessions.playerAccessGrantRevision,
      legacyInviteId: sessions.legacyInviteId,
      membershipId: memberships.id,
      campaignId: memberships.campaignId,
      role: memberships.role,
      membershipUserId: memberships.userId,
    })
    .from(sessions)
    .innerJoin(memberships, eq(sessions.membershipId, memberships.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return false;
  if (!session.authSource && !env.ACCOUNT_AUTH_ENABLED) return true;
  return sessionSourceIsValid(db, session);
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
) {
  const token = request.cookies[env.SESSION_COOKIE_NAME] ?? null;
  const auth = await authFromSessionToken(db, token);
  if (!auth) {
    await reply
      .code(401)
      .send({ error: "AUTH_REQUIRED", message: "Войдите по приглашению" });
    return null;
  }
  return auth;
}

export function isOperatorMembershipId(membershipId: string) {
  return env.OPERATOR_MEMBERSHIP_IDS.split(",").map((value) => value.trim()).filter(Boolean).includes(membershipId);
}

/** Shared existing operator allowlist gate for operator-only workflows. */
export async function requireOperator(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
) {
  const auth = await requireAuth(request, reply, db);
  if (!auth) return null;
  if (!isOperatorMembershipId(auth.membershipId)) {
    await reply.code(403).send({ error: "OPERATOR_REQUIRED" });
    return null;
  }
  return auth;
}

export async function createSession(
  db: Database,
  reply: FastifyReply,
  membershipId: string,
  provenance: SessionProvenance,
) {
  if (provenance.source === "ACCOUNT") {
    const [owned] = await db.select({ membershipId: memberships.id })
      .from(memberships)
      .innerJoin(accountSessions, eq(memberships.userId, accountSessions.userId))
      .innerJoin(users, eq(accountSessions.userId, users.id))
      .where(and(
        eq(memberships.id, membershipId),
        eq(memberships.userId, accountSessions.userId),
        eq(accountSessions.id, provenance.accountSessionId),
        isNull(accountSessions.revokedAt),
        gt(accountSessions.expiresAt, new Date()),
        isNotNull(users.verifiedAt),
        isNull(users.disabledAt),
      ))
      .limit(1);
    if (!owned) throw new Error("ACCOUNT_SESSION_MEMBERSHIP_MISMATCH");
  } else if (provenance.source === "GM_LINK") {
    const [owned] = await db.select({ membershipId: memberships.id })
      .from(memberships)
      .innerJoin(gmAccessCredentials, and(
        eq(memberships.campaignId, gmAccessCredentials.campaignId),
        eq(gmAccessCredentials.revision, provenance.credentialRevision),
      ))
      .where(and(eq(memberships.id, membershipId), eq(memberships.campaignId, provenance.campaignId), eq(memberships.role, "GM"))).limit(1);
    if (!owned) throw new Error("GM_LINK_MEMBERSHIP_MISMATCH");
  } else if (provenance.source === "PLAYER_GRANT") {
    const [owned] = await db.select({ membershipId: memberships.id })
      .from(memberships)
      .innerJoin(playerAccessGrants, and(
        eq(memberships.id, playerAccessGrants.membershipId),
        eq(memberships.campaignId, playerAccessGrants.campaignId),
        eq(playerAccessGrants.revision, provenance.grantRevision),
        isNull(playerAccessGrants.revokedAt),
      ))
      .where(and(eq(memberships.id, membershipId), eq(playerAccessGrants.id, provenance.grantId), eq(memberships.role, "PLAYER"))).limit(1);
    if (!owned) throw new Error("PLAYER_GRANT_MEMBERSHIP_MISMATCH");
  } else if (provenance.source === "LEGACY_INVITE") {
    const [owned] = await db.select({ membershipId: memberships.id })
      .from(memberships)
      .innerJoin(invites, and(
        eq(invites.campaignId, memberships.campaignId),
        eq(invites.claimedByMembershipId, memberships.id),
        eq(invites.id, provenance.inviteId),
        isNotNull(invites.claimedAt),
        isNull(invites.revokedAt),
      ))
      .where(and(eq(memberships.id, membershipId), eq(memberships.role, "PLAYER"))).limit(1);
    if (!owned) throw new Error("LEGACY_INVITE_MEMBERSHIP_MISMATCH");
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86400_000);
  await db.insert(sessions).values({
    membershipId,
    ...(provenance.source === "ACCOUNT" ? { accountSessionId: provenance.accountSessionId } : {}),
    authSource: provenance.source,
    ...(provenance.source === "GM_LINK" ? { gmCredentialCampaignId: provenance.campaignId, gmCredentialRevision: provenance.credentialRevision } : {}),
    ...(provenance.source === "PLAYER_GRANT" ? { playerAccessGrantId: provenance.grantId, playerAccessGrantRevision: provenance.grantRevision } : {}),
    ...(provenance.source === "LEGACY_INVITE" ? { legacyInviteId: provenance.inviteId } : {}),
    tokenHash: hashToken(token),
    expiresAt,
  });
  reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}
