import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";
import { applyAbilityArea } from "./ability-area-apply.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerCharacterPlayRoutes } from "./character-play-routes.js";
import { hashToken } from "./security.js";
import { env } from "./env.js";
const id = () => crypto.randomUUID();
it("applies one shared area roll to player targets once without revealing a hidden target", async () => {
  const pg = await createMigratedPglite(),
    db = drizzle(pg, { schema }),
    app = Fastify();
  try {
    const campaignId = id(),
      sceneId = id(),
      owner = id(),
      allyOwner = id(),
      gm = id(),
      caster = id(),
      ally = id(),
      npc = id(),
      entry = id(),
      casterDef = id(),
      allyDef = id(),
      npcDef = id(),
      casterToken = id();
    await db
      .insert(schema.campaigns)
      .values({ id: campaignId, name: "QA", activeSceneId: sceneId });
    await db.insert(schema.memberships).values([
      { id: owner, campaignId, role: "PLAYER", displayName: "Caster" },
      { id: allyOwner, campaignId, role: "PLAYER", displayName: "Ally" },
      { id: gm, campaignId, role: "GM", displayName: "GM" },
    ]);
    const secret = "q".repeat(40),
      otherSecret = "r".repeat(40);
    await db.insert(schema.sessions).values([
      {
        membershipId: owner,
        tokenHash: hashToken(secret),
        expiresAt: new Date(Date.now() + 60000),
      },
      {
        membershipId: allyOwner,
        tokenHash: hashToken(otherSecret),
        expiresAt: new Date(Date.now() + 60000),
      },
    ]);
    await app.register(cookie);
    registerCharacterPlayRoutes(
      app,
      db as never,
      { to: () => ({ emit: () => {} }) } as never,
      { broadcast: async () => {}, publishCharacter: async () => {} },
    );
    await app.ready();
    await db.insert(schema.scenes).values({
      id: sceneId,
      campaignId,
      name: "QA",
      grid: {
        enabled: true,
        size: 20,
        offsetX: 0,
        offsetY: 0,
        color: "#ffffff",
        opacity: 0.2,
        metersPerCell: 1,
      },
    });
    const resources = { magicPower: { current: 0, maximum: 20 } };
    await db.insert(schema.characters).values([
      {
        id: caster,
        campaignId,
        ownerMembershipId: owner,
        name: "Caster",
        resources,
      },
      {
        id: ally,
        campaignId,
        ownerMembershipId: allyOwner,
        name: "Secret ally",
        resources,
      },
      { id: npc, campaignId, ownerMembershipId: gm, name: "NPC", resources },
    ]);
    await db.insert(schema.characterCatalogEntries).values({
      id: entry,
      characterId: caster,
      kind: "ABILITY",
      name: "QA area",
      data: {
        areaEffect: {
          kind: "RESTORE_MANA",
          radiusMeters: 15,
          origin: "CASTER",
          targets: "PLAYER_CHARACTERS",
          dice: "1d6",
          includeCaster: true,
        },
        uses: { current: 1, max: 1, recharge: "DAY" },
      },
    });
    await db.insert(schema.tokenDefinitions).values([
      { id: casterDef, campaignId, characterId: caster },
      { id: allyDef, campaignId, characterId: ally },
      { id: npcDef, campaignId, characterId: npc },
    ]);
    await db
      .insert(schema.tokenControllers)
      .values({ tokenDefinitionId: casterDef, membershipId: owner });
    await db.insert(schema.tokens).values([
      {
        id: casterToken,
        definitionId: casterDef,
        sceneId,
        name: "Caster",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
      {
        id: id(),
        definitionId: allyDef,
        sceneId,
        name: "Hidden",
        x: 300,
        y: 0,
        width: 10,
        height: 10,
        visible: false,
        layer: "GM",
      },
      {
        id: id(),
        definitionId: allyDef,
        sceneId,
        name: "Hidden 2",
        x: 50,
        y: 0,
        width: 10,
        height: 10,
        visible: false,
        layer: "GM",
      },
      {
        id: id(),
        definitionId: npcDef,
        sceneId,
        name: "NPC",
        x: 50,
        y: 0,
        width: 10,
        height: 10,
      },
    ]);
    const command = {
      actionId: id(),
      characterId: caster,
      entryId: entry,
      entryRevision: 0,
      sceneId,
      sceneRevision: 0,
      casterTokenId: casterToken,
      casterTokenRevision: 0,
    };
    const auth = { campaignId, membershipId: owner };
    await db
      .update(schema.characters)
      .set({ resources: {} })
      .where(eq(schema.characters.id, ally));
    const invalidAction = id();
    await expect(
      applyAbilityArea(db as never, auth, {
        ...command,
        actionId: invalidAction,
      }),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, invalidAction)),
    ).toHaveLength(0);
    const [casterBefore] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, caster));
    const [entryBefore] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, entry));
    expect(casterBefore?.resources).toEqual(resources);
    expect(entryBefore?.data).toMatchObject({ uses: { current: 1 } });
    await db
      .update(schema.characters)
      .set({ resources })
      .where(eq(schema.characters.id, ally));
    await db
      .update(schema.campaigns)
      .set({ paused: true })
      .where(eq(schema.campaigns.id, campaignId));
    await expect(
      applyAbilityArea(db as never, auth, { ...command, actionId: id() }),
    ).rejects.toThrow("CAMPAIGN_PAUSED");
    await db
      .update(schema.campaigns)
      .set({ paused: false })
      .where(eq(schema.campaigns.id, campaignId));
    const headers = {
      cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
      "x-entry-campaign": campaignId,
      "x-entry-member": owner,
    };
    const send = (url: string, payload: typeof command) =>
      app.inject({ method: "POST", url, headers, payload });
    const alienAction = id();
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/abilities/area/cancel",
      payload: { ...command, actionId: alienAction },
      headers: {
        cookie: `${env.SESSION_COOKIE_NAME}=${otherSecret}`,
        "x-entry-campaign": campaignId,
        "x-entry-member": allyOwner,
      },
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, alienAction)),
    ).toHaveLength(0);
    const firstResponse = await send("/api/abilities/area/apply", command),
      retryResponse = await send("/api/abilities/area/apply", command);
    expect(firstResponse.statusCode, firstResponse.body).toBe(200);
    expect(retryResponse.statusCode, retryResponse.body).toBe(200);
    const first = firstResponse.json(),
      retry = retryResponse.json();
    expect(first).toMatchObject({ duplicate: false });
    expect(retry).toMatchObject({
      duplicate: true,
      messageId: first.messageId,
    });
    const events = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, command.actionId));
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as {
      sharedRoll: number;
      effects: Array<{ characterId: string; restored: number }>;
    };
    expect(payload.sharedRoll).toBeGreaterThanOrEqual(1);
    expect(payload.sharedRoll).toBeLessThanOrEqual(6);
    expect(payload.effects).toHaveLength(2);
    expect(payload.effects.map((e) => e.characterId).sort()).toEqual(
      [caster, ally].sort(),
    );
    expect(
      payload.effects.every((e) => e.restored === payload.sharedRoll),
    ).toBe(true);
    const [npcAfter] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, npc));
    expect(npcAfter?.resources).toEqual(resources);
    const [savedEntry] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, entry));
    expect(savedEntry?.data).toMatchObject({ uses: { current: 0 } });
    const [message] = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.id, first.messageId));
    expect(JSON.stringify(message)).not.toContain("Secret ally");
    expect(JSON.stringify(first)).not.toContain(ally);
    const cancelAfter = await send("/api/abilities/area/cancel", command);
    expect(cancelAfter.statusCode, cancelAfter.body).toBe(200);
    expect(cancelAfter.json()).toMatchObject({
      duplicate: true,
      messageId: first.messageId,
    });
    const cancelled = { ...command, actionId: id() };
    const cancelBefore = await send("/api/abilities/area/cancel", cancelled);
    expect(cancelBefore.statusCode, cancelBefore.body).toBe(200);
    const blocked = await send("/api/abilities/area/apply", cancelled);
    expect(blocked.statusCode, blocked.body).toBe(200);
    expect(blocked.json()).toMatchObject({ cancelled: true, notApplied: true });
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, cancelled.actionId)),
    ).toHaveLength(1);
    const [allyBeforeConflict] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, ally));
    await db
      .update(schema.characters)
      .set({ revision: allyBeforeConflict!.revision + 1 })
      .where(eq(schema.characters.id, ally));
    const refused = await app.inject({
      method: "POST",
      url: "/api/chat/application-undo",
      headers,
      payload: { actionId: id(), messageId: first.messageId },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toBe("UNDO_CONFLICT");
    const [entryStillSpent] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, entry));
    expect(entryStillSpent?.data).toMatchObject({ uses: { current: 0 } });
    // Restore this synthetic fixture to test the successful branch separately.
    await db
      .update(schema.characters)
      .set({ revision: allyBeforeConflict!.revision })
      .where(eq(schema.characters.id, ally));
    const undoId = id();
    const undone = await app.inject({
      method: "POST",
      url: "/api/chat/application-undo",
      headers,
      payload: { actionId: undoId, messageId: first.messageId },
    });
    expect(undone.statusCode, undone.body).toBe(200);
    for (const characterId of [caster, ally]) {
      const [restored] = await db
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.id, characterId));
      expect(restored?.resources).toEqual(resources);
    }
    const [restoredEntry] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, entry));
    expect(restoredEntry?.data).toMatchObject({ uses: { current: 1 } });
    expect(JSON.stringify(undone.json())).not.toContain(ally);
  } finally {
    await app.close();
    await pg.close();
  }
}, 30000);
