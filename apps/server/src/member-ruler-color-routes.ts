import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  memberRulerColorUpdateSchema,
  rulerColorKeySchema,
  type RulerColorKey,
} from "@arken/contracts";
import { memberships } from "@arken/db";
import { requireAuth } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Stored keys are CHECK-constrained; anything else reads as the fallback. */
export function rulerColorKey(value: string | null): RulerColorKey | null {
  const parsed = rulerColorKeySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * UIX-509: the GM assigns each member a named ruler colour. The value is
 * absolute, so a repeated or concurrent write converges without a revision;
 * peers receive it with the next `ruler:updated`, not through the member list.
 */
export function registerMemberRulerColorRoutes(
  app: FastifyInstance,
  db: Database,
) {
  app.patch("/api/members/:id/ruler-color", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const params = z
      .object({ id: z.string().uuid() })
      .strict()
      .safeParse(request.params);
    const body = memberRulerColorUpdateSchema.safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: "INVALID_RULER_COLOR" });
    const [updated] = await db
      .update(memberships)
      .set({ rulerColor: body.data.rulerColor })
      .where(
        and(
          eq(memberships.id, params.data.id),
          eq(memberships.campaignId, auth.campaignId),
        ),
      )
      .returning({ id: memberships.id, rulerColor: memberships.rulerColor });
    if (!updated) return reply.code(404).send({ error: "MEMBER_NOT_FOUND" });
    return updated;
  });
}
