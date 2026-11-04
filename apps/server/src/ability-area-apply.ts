import { areaApplicationHash, areaApplicationReplay } from "./ability-area-state.js";
import { lockEntryApplication } from "./entry-application-state.js";
import { and, asc, eq } from "drizzle-orm";
import { abilityAreaApplySchema, entryDataSchema, fogHiddenTokenIds, gridSchema } from "@arken/contracts";
import { campaigns, characters, characterControllers, characterCatalogEntries,
  memberships, scenes, tokens, tokenDefinitions, tokenControllers, fogReveals,
  gameEvents, chatThreads, chatMessages } from "@arken/db";
import { selectAbilityAreaTargets } from "./ability-area-targets.js";
import { planAbilityAreaResources } from "./ability-area-resources.js";
import { normalizeLegacyEntryData } from "./entry-data.js";
import { rollFormula } from "./dice.js";
import { selectDiceFrame } from "./dice-frame-selection.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Internal authenticated command. No caller-supplied targets, dice or resource
 * values. Serializable aborts are surfaced, never automatically rerolled.
 * Route integration must refresh authorized projections, not expose audit payload.
 */
export async function applyAbilityArea(db: Database,
  auth: { campaignId: string; membershipId: string }, input: unknown) {
  const command = abilityAreaApplySchema.parse(input);
  const requestHash = areaApplicationHash(command);
  return db.transaction(async (tx) => {
    await lockEntryApplication(tx, auth.campaignId, command.actionId);
    const [actor] = await tx.select().from(memberships).where(and(
      eq(memberships.id, auth.membershipId), eq(memberships.campaignId, auth.campaignId))).limit(1).for("share");
    if (!actor || actor.accessRevokedAt) throw new Error("AREA_FORBIDDEN");
    const [prior] = await tx.select().from(gameEvents).where(and(
      eq(gameEvents.campaignId, auth.campaignId), eq(gameEvents.actionId, command.actionId))).limit(1);
    if (prior) {
      return areaApplicationReplay(prior, actor.id, requestHash);
    }
    // Same campaign-first lock order as canvas/pause commands. Geometry cannot
    // move underneath this application; serializable reads cover ownership too.
    const [campaign] = await tx.select({ activeSceneId: campaigns.activeSceneId,
      paused: campaigns.paused }).from(campaigns)
      .where(eq(campaigns.id, auth.campaignId)).limit(1).for("update");
    if (!campaign) throw new Error("AREA_FORBIDDEN");
    if (campaign.paused) throw new Error("CAMPAIGN_PAUSED");
    // Stable multi-row order, compatible with single-character locking. Reads
    // of scene/token/ownership predicates are protected by serializable isolation.
    const people = await tx.select().from(characters).where(eq(characters.campaignId, auth.campaignId))
      .orderBy(asc(characters.id)).limit(10001).for("update");
    if (people.length > 10000) throw new Error("AREA_CAMPAIGN_LIMIT");
    const caster = people.find((person) => person.id === command.characterId && person.lifecycle === "ACTIVE");
    if (!caster) throw new Error("AREA_FORBIDDEN");
    if (actor.role !== "GM" && caster.ownerMembershipId !== actor.id) {
      const [controller] = await tx.select({ id: characterControllers.membershipId })
        .from(characterControllers).where(and(eq(characterControllers.characterId, caster.id),
          eq(characterControllers.membershipId, actor.id))).limit(1);
      if (!controller) throw new Error("AREA_FORBIDDEN");
    }
    const [scene] = await tx.select().from(scenes).where(and(eq(scenes.id, command.sceneId),
      eq(scenes.campaignId, auth.campaignId))).limit(1);
    if (!scene || (actor.role !== "GM" && campaign?.activeSceneId !== scene.id))
      throw new Error("AREA_SCENE_UNAVAILABLE");
    if (scene.revision !== command.sceneRevision) throw new Error("AREA_SCENE_CHANGED");
    const grid = gridSchema.parse(scene.grid);
    if (!grid.metersPerCell) throw new Error("AREA_SCALE_REQUIRED");
    if (scene.projection !== "ORTHOGRAPHIC_2D") throw new Error("AREA_PROJECTION_UNSUPPORTED");
    const [entry] = await tx.select().from(characterCatalogEntries).where(and(
      eq(characterCatalogEntries.id, command.entryId), eq(characterCatalogEntries.characterId, caster.id)))
      .for("update").limit(1);
    if (!entry || entry.kind !== "ABILITY" || entry.revision !== command.entryRevision)
      throw new Error("ENTRY_CONFLICT");
    const data = entryDataSchema.parse(normalizeLegacyEntryData(entry.data));
    if (!data.areaEffect) throw new Error("AREA_EFFECT_REQUIRED");
    // The definition owns character linkage; the legacy placement copy can
    // differ after relinking a token. Match the snapshot's canonical projection.
    const tokenRows = await tx.select({ token: tokens, characterId: tokenDefinitions.characterId })
      .from(tokens).innerJoin(tokenDefinitions, eq(tokens.definitionId, tokenDefinitions.id))
      .where(and(eq(tokens.sceneId, scene.id), eq(tokenDefinitions.campaignId, auth.campaignId))).limit(10001);
    const placements = tokenRows.map(({ token, characterId }) => ({ ...token, characterId }));
    if (placements.length > 10000) throw new Error("AREA_SCENE_LIMIT");
    const origin = placements.find((token) => token.id === command.casterTokenId && token.characterId === caster.id);
    if (!origin || (actor.role !== "GM" && (!origin.visible || origin.layer !== "PLAYER")))
      throw new Error("AREA_ORIGIN_UNAVAILABLE");
    if (origin.revision !== command.casterTokenRevision) throw new Error("AREA_ORIGIN_CHANGED");
    if (actor.role !== "GM") {
      const controllers = await tx.select({ id: tokenControllers.membershipId }).from(tokenControllers)
        .where(eq(tokenControllers.tokenDefinitionId, origin.definitionId));
      const reveals = await tx.select().from(fogReveals).where(eq(fogReveals.sceneId, scene.id))
        .orderBy(asc(fogReveals.sequence));
      if (fogHiddenTokenIds([{ ...origin, controllerMembershipIds: controllers.map((row) => row.id) }],
        reveals, { role: actor.role, membershipId: actor.id }).has(origin.id))
        throw new Error("AREA_ORIGIN_UNAVAILABLE");
    }
    const players = await tx.select({ id: memberships.id }).from(memberships).where(and(
      eq(memberships.campaignId, auth.campaignId), eq(memberships.role, "PLAYER")));
    const owners = new Set(players.map((player) => player.id));
    const targetIds = selectAbilityAreaTargets({ casterTokenId: origin.id, casterCharacterId: caster.id,
      radiusMeters: data.areaEffect.radiusMeters, gridSize: grid.size, metersPerCell: grid.metersPerCell,
      placements, playerCharacterIds: people.filter((person) => person.lifecycle === "ACTIVE" &&
        person.ownerMembershipId && owners.has(person.ownerMembershipId)).map((person) => person.id) });
    const roll = { ...rollFormula("1d6", {}), styleFrame: await selectDiceFrame(tx, {
      campaignId: auth.campaignId, membershipId: actor.id, sourceCatalogEntryId: entry.sourceCatalogEntryId,
    }) };
    const plan = planAbilityAreaResources({ casterId: caster.id, entryData: data,
      sharedRoll: roll.total, targetIds, characters: people });
    for (const update of plan.updates) {
      const original = people.find((person) => person.id === update.id)!;
      await tx.update(characters).set({ resources: update.resources, revision: original.revision + 1,
        updatedAt: new Date() }).where(eq(characters.id, update.id));
    }
    await tx.update(characterCatalogEntries).set({ data: plan.entryData,
      revision: entry.revision + 1, updatedAt: new Date() }).where(eq(characterCatalogEntries.id, entry.id));
    await tx.insert(chatThreads).values({ campaignId: auth.campaignId, stream: "ROLLS", type: "STREAM" })
      .onConflictDoNothing({ target: [chatThreads.campaignId, chatThreads.stream] });
    const [thread] = await tx.select().from(chatThreads).where(and(
      eq(chatThreads.campaignId, auth.campaignId), eq(chatThreads.stream, "ROLLS"))).limit(1);
    if (!thread) throw new Error("CHAT_THREAD_NOT_FOUND");
    // Audit details are private; public journal does not reveal hidden targets.
    const [message] = await tx.insert(chatMessages).values({ campaignId: auth.campaignId,
      membershipId: actor.id, characterId: caster.id, threadId: thread.id, kind: "DICE",
      // GM origins may be hidden by layer, fog or an unpublished scene. Keep
      // their journal private instead of leaking a caster through a public roll.
      visibility: actor.role === "GM" ? "GM_ONLY" : "PUBLIC",
      body: `${entry.name}: восстановление маны · радиус ${data.areaEffect.radiusMeters} м`, dice: roll,
    }).returning({ id: chatMessages.id });
    if (!message) throw new Error("ROLL_SAVE_FAILED");
    await tx.insert(gameEvents).values({ campaignId: auth.campaignId, actionId: command.actionId,
      membershipId: actor.id, type: "ability.area.applied", entityType: "chat", entityId: message.id,
      entityRevision: entry.revision + 1, payload: { requestHash, messageId: message.id,
        entryId: entry.id, sceneId: scene.id, sharedRoll: roll.total, effects: plan.effects, spent: plan.spent } });
    return { actionId: command.actionId, duplicate: false, messageId: message.id };
  }, { isolationLevel: "serializable" });
}
