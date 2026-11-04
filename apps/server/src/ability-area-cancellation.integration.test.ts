import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";
import { cancelAbilityArea } from "./ability-area-state.js";
import { applyAbilityArea } from "./ability-area-apply.js";
const id = () => crypto.randomUUID();
describe("area cancellation authorization", () => {
  it("does not reserve an action for an uncontrolled character or a revoked member", async () => {
    const pg = await createMigratedPglite();
    const db = drizzle(pg, { schema });
    try {
      const campaignId = id(),
        owner = id(),
        other = id(),
        characterId = id();
      await db.insert(schema.campaigns).values({ id: campaignId, name: "QA" });
      await db.insert(schema.memberships).values([
        { id: owner, campaignId, role: "PLAYER", displayName: "Owner" },
        { id: other, campaignId, role: "PLAYER", displayName: "Other" },
      ]);
      await db.insert(schema.characters).values({
        id: characterId,
        campaignId,
        ownerMembershipId: owner,
        name: "Caster",
      });
      const command = {
        actionId: id(),
        characterId,
        entryId: id(),
        entryRevision: 0,
        sceneId: id(),
        sceneRevision: 0,
        casterTokenId: id(),
        casterTokenRevision: 0,
      };
      await expect(
        cancelAbilityArea(
          db as never,
          { campaignId, membershipId: other },
          command,
        ),
      ).rejects.toThrow("AREA_FORBIDDEN");
      expect(
        await db
          .select()
          .from(schema.gameEvents)
          .where(eq(schema.gameEvents.actionId, command.actionId)),
      ).toHaveLength(0);
      await db
        .insert(schema.characterControllers)
        .values({ characterId, membershipId: other });
      const controlled = { ...command, actionId: id() };
      expect(
        await cancelAbilityArea(
          db as never,
          { campaignId, membershipId: other },
          controlled,
        ),
      ).toMatchObject({ cancelled: true, notApplied: true });
      expect(
        await cancelAbilityArea(
          db as never,
          { campaignId, membershipId: owner },
          command,
        ),
      ).toMatchObject({ cancelled: true, notApplied: true });
      expect(
        await cancelAbilityArea(
          db as never,
          { campaignId, membershipId: owner },
          command,
        ),
      ).toMatchObject({ cancelled: true, notApplied: true });
      await db
        .update(schema.memberships)
        .set({ accessRevokedAt: new Date() })
        .where(eq(schema.memberships.id, owner));
      await expect(
        cancelAbilityArea(
          db as never,
          { campaignId, membershipId: owner },
          command,
        ),
      ).rejects.toThrow("AREA_FORBIDDEN");
      await expect(
        applyAbilityArea(
          db as never,
          { campaignId, membershipId: owner },
          { ...command, actionId: id() },
        ),
      ).rejects.toThrow("AREA_FORBIDDEN");
    } finally {
      await pg.close();
    }
  }, 30000);
});
