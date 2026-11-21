import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { campaignArchiveState, memberships, users } from "@arken/db";
import { authFromSessionToken } from "./auth.js";
import { hashToken } from "./security.js";
import { env } from "./env.js";
import {
  listEditorHistory,
  postgresEditorTransaction,
} from "./editor-change-postgres.js";
import { registerEditorChangeRoutes } from "./editor-change-routes.js";
import {
  editorTargets,
  searchEditorTargets,
  validEditorPatch,
} from "./editor-change-targets.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export function registerBrowserEditor(app: FastifyInstance, db: Database) {
  const campaignId = process.env.ARKEN_EDITOR_PILOT_CAMPAIGN_ID;
  if (!campaignId) return;
  const origin = new URL(env.WEB_ORIGIN).origin;
  const tokenHash = process.env.ARKEN_EDITOR_PILOT_TOKEN_HASH;
  const membershipId = process.env.ARKEN_EDITOR_PILOT_MEMBERSHIP_ID;
  registerEditorChangeRoutes(app, {
    approvalOrigin: new URL(env.PUBLIC_URL).origin,
    async authorize(request, capability) {
      const authorization = request.headers.authorization;
      if (authorization) {
        if (
          capability !== "prepare" ||
          !membershipId ||
          !tokenHash ||
          !/^[0-9a-f]{64}$/.test(tokenHash) ||
          !/^Bearer [a-zA-Z0-9_-]{40,128}$/.test(authorization) ||
          !timingSafeEqual(
            Buffer.from(tokenHash, "hex"),
            Buffer.from(hashToken(authorization.slice(7)), "hex"),
          )
        )
          return null;
        const [actor] = await db
          .select({
            membershipId: memberships.id,
            campaignId: memberships.campaignId,
            role: memberships.role,
            displayName: memberships.displayName,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .leftJoin(
            campaignArchiveState,
            eq(campaignArchiveState.campaignId, memberships.campaignId),
          )
          .where(
            and(
              eq(memberships.id, membershipId),
              eq(memberships.campaignId, campaignId),
              eq(memberships.role, "GM"),
              isNull(memberships.accessRevokedAt),
              eq(users.identityKind, "HOSTED"),
              isNotNull(users.hostedApprovedAt),
              eq(users.passwordChangeRequired, false),
              isNull(users.disabledAt),
              isNull(campaignArchiveState.archivedAt),
            ),
          );
        return actor ?? null;
      }
      if (
        request.method !== "GET" &&
        (request.headers.origin !== origin ||
          request.headers["x-arken-campaign-id"] !== campaignId)
      )
        return null;
      if (
        capability === "confirm" &&
        request.headers["x-arken-editor-confirm"] !== "explicit"
      )
        return null;
      const actor = await authFromSessionToken(
        db,
        request.cookies[env.SESSION_COOKIE_NAME] ?? null,
      );
      return actor?.role === "GM" && actor.campaignId === campaignId
        ? actor
        : null;
    },
    transaction(actor, run) {
      return db.transaction((tx) =>
        run(postgresEditorTransaction(tx, editorTargets(tx, actor))),
      );
    },
    validate: validEditorPatch,
    history: (actor, target) => listEditorHistory(db, actor.campaignId, target),
    search: (actor, kind, query) =>
      searchEditorTargets(db, actor.campaignId, kind, query),
  });
}
