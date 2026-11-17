import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";
import { creationAction } from "./creation-state.js";
import { readCreationMaterials } from "./creation-library-read.js";
import { readCreationListings, readCreationStorePolicy } from "./creation-store-read.js";

describe("creation access after revocation", () => {
  it("does not execute an action with an authenticated but revoked membership", async () => {
    const pg = await createMigratedPglite();
    try {
      const db = drizzle(pg, { schema });
      const campaignId = crypto.randomUUID(), membershipId = crypto.randomUUID(), actionId = crypto.randomUUID();
      await db.insert(schema.campaigns).values({ id: campaignId, name: "QA" });
      await db.insert(schema.memberships).values({ id: membershipId, campaignId, role: "PLAYER", displayName: "QA", accessRevokedAt: new Date() });
      let called = false;
      await expect(creationAction(db as never, { campaignId, membershipId, role: "PLAYER", displayName: "QA" }, actionId,
        "creation.test", { actionId }, async () => { called = true; return { ok: true }; })).rejects.toThrow("CREATION_FORBIDDEN");
      expect(called).toBe(false);
      expect(await db.select().from(schema.creationActions).where(eq(schema.creationActions.actionId, actionId))).toHaveLength(0);
      expect(await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.actionId, actionId))).toHaveLength(0);
      const auth = { campaignId, membershipId, role: "PLAYER" as const, displayName: "QA" };
      await expect(readCreationMaterials(db as never, auth, crypto.randomUUID())).rejects.toThrow("CREATION_FORBIDDEN");
      await expect(readCreationListings(db as never, auth)).rejects.toThrow("CREATION_FORBIDDEN");
      await expect(readCreationStorePolicy(db as never, auth)).rejects.toThrow("CREATION_FORBIDDEN");
      await db.update(schema.memberships).set({ accessRevokedAt: null }).where(eq(schema.memberships.id, membershipId));
      expect(await readCreationStorePolicy(db as never, auth)).toEqual({ policy: null, revision: null });
    } finally { await pg.close(); }
  });
});
