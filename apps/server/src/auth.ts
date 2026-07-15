import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import { memberships, sessions } from "@arken/db";
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

export async function authFromSessionToken(
  db: Database,
  token: string | null,
): Promise<AuthContext | null> {
  if (!token) return null;
  const [row] = await db
    .select({
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
  return row ?? null;
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

export async function createSession(
  db: Database,
  reply: FastifyReply,
  membershipId: string,
) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86400_000);
  await db
    .insert(sessions)
    .values({ membershipId, tokenHash: hashToken(token), expiresAt });
  reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}
