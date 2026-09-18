import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  memberThemeDefaultUpdateSchema,
  personalThemeUpdateSchema,
} from "@arken/contracts";
import { memberships } from "@arken/db";
import { requireAuth } from "./auth.js";
import {
  isAssignablePlayerThemeDefault,
  isPublishedPlayerThemeId,
  personalThemeDto,
} from "./player-themes.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export function registerPlayerThemeRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/me/theme", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const [member] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, auth.membershipId),
          eq(memberships.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    return member
      ? personalThemeDto(member)
      : reply.code(404).send({ error: "MEMBER_NOT_FOUND" });
  });
  app.patch("/api/me/theme", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const parsed = personalThemeUpdateSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "INVALID_THEME_REQUEST" });
    const body = parsed.data;
    if (
      body.selectedThemeId !== null &&
      body.selectedThemeId !== "system" &&
      !isPublishedPlayerThemeId(body.selectedThemeId)
    )
      return reply.code(400).send({ error: "INVALID_THEME" });
    const [updated] = await db
      .update(memberships)
      .set({
        selectedThemeId: body.selectedThemeId,
        themeRevision: sql`${memberships.themeRevision} + 1`,
      })
      .where(
        and(
          eq(memberships.id, auth.membershipId),
          eq(memberships.campaignId, auth.campaignId),
          eq(memberships.themeRevision, body.expectedRevision),
        ),
      )
      .returning();
    if (updated) return personalThemeDto(updated);
    const [current] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, auth.membershipId),
          eq(memberships.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    return current
      ? reply.code(409).send({
          error: "THEME_PREFERENCE_CONFLICT",
          personalTheme: personalThemeDto(current),
        })
      : reply.code(404).send({ error: "MEMBER_NOT_FOUND" });
  });
  app.patch("/api/members/:id/theme-default", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const params = z
      .object({ id: z.string().uuid() })
      .strict()
      .safeParse(request.params);
    const bodyResult = memberThemeDefaultUpdateSchema.safeParse(request.body);
    if (!params.success || !bodyResult.success)
      return reply.code(400).send({ error: "INVALID_THEME_REQUEST" });
    const { id } = params.data;
    const body = bodyResult.data;
    if (!isAssignablePlayerThemeDefault(body.defaultThemeId))
      return reply.code(400).send({ error: "INVALID_THEME" });
    const [updated] = await db
      .update(memberships)
      .set({
        defaultThemeId: body.defaultThemeId,
        themeRevision: sql`${memberships.themeRevision} + 1`,
        defaultThemeRevision: sql`${memberships.defaultThemeRevision} + 1`,
      })
      .where(
        and(
          eq(memberships.id, id),
          eq(memberships.campaignId, auth.campaignId),
          eq(memberships.defaultThemeRevision, body.expectedRevision),
        ),
      )
      .returning();
    if (updated)
      return {
        id: updated.id,
        defaultThemeId: updated.defaultThemeId,
        revision: updated.defaultThemeRevision,
      };
    const [current] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, id),
          eq(memberships.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    return current
      ? reply.code(409).send({
          error: "THEME_DEFAULT_CONFLICT",
          membership: {
            id: current.id,
            defaultThemeId: current.defaultThemeId,
            revision: current.defaultThemeRevision,
          },
        })
      : reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
  });
}
