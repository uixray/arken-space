import { and, asc, desc, eq, max, or } from "drizzle-orm";
import {
  assets,
  audioStates,
  campaigns,
  catalogEntries,
  characterCatalogEntries,
  characters,
  chatMessages,
  fogReveals,
  gameEvents,
  memberships,
  scenes,
  tokens,
  tokenControllers,
  tokenDefinitions,
} from "@arken/db";
import type { AuthContext } from "./auth.js";
import type { GameSnapshot } from "@arken/contracts";
import { env } from "./env.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export async function buildSnapshot(
  db: Database,
  auth: AuthContext,
): Promise<GameSnapshot> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, auth.campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found");

  const [
    memberRows,
    characterRows,
    sceneRows,
    tokenRows,
    controllerRows,
    catalogRows,
    assignedRows,
    fogRows,
    assetRows,
    messageRows,
    audioRows,
    sequenceRows,
  ] = await Promise.all([
    db
      .select()
      .from(memberships)
      .where(eq(memberships.campaignId, auth.campaignId))
      .orderBy(asc(memberships.createdAt)),
    db
      .select()
      .from(characters)
      .where(eq(characters.campaignId, auth.campaignId))
      .orderBy(asc(characters.createdAt)),
    db
      .select()
      .from(scenes)
      .where(eq(scenes.campaignId, auth.campaignId))
      .orderBy(asc(scenes.createdAt)),
    db
      .select({ token: tokens, definition: tokenDefinitions })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .innerJoin(tokenDefinitions, eq(tokens.definitionId, tokenDefinitions.id))
      .where(eq(scenes.campaignId, auth.campaignId)),
    db
      .select()
      .from(tokenControllers)
      .innerJoin(
        tokenDefinitions,
        eq(tokenControllers.tokenDefinitionId, tokenDefinitions.id),
      )
      .where(eq(tokenDefinitions.campaignId, auth.campaignId)),
    db
      .select()
      .from(catalogEntries)
      .where(eq(catalogEntries.campaignId, auth.campaignId))
      .orderBy(asc(catalogEntries.createdAt)),
    db
      .select({
        entry: characterCatalogEntries,
        campaignId: characters.campaignId,
      })
      .from(characterCatalogEntries)
      .innerJoin(
        characters,
        eq(characterCatalogEntries.characterId, characters.id),
      )
      .where(eq(characters.campaignId, auth.campaignId)),
    db
      .select({ fog: fogReveals })
      .from(fogReveals)
      .innerJoin(scenes, eq(fogReveals.sceneId, scenes.id))
      .where(eq(scenes.campaignId, auth.campaignId)),
    db
      .select()
      .from(assets)
      .where(eq(assets.campaignId, auth.campaignId))
      .orderBy(desc(assets.createdAt)),
    db
      .select({ message: chatMessages, displayName: memberships.displayName })
      .from(chatMessages)
      .innerJoin(memberships, eq(chatMessages.membershipId, memberships.id))
      .where(
        and(
          eq(chatMessages.campaignId, auth.campaignId),
          auth.role === "GM"
            ? undefined
            : or(
                eq(chatMessages.visibility, "PUBLIC"),
                eq(chatMessages.membershipId, auth.membershipId),
              ),
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(200),
    db
      .select()
      .from(audioStates)
      .where(eq(audioStates.campaignId, auth.campaignId))
      .limit(1),
    db
      .select({ value: max(gameEvents.sequence) })
      .from(gameEvents)
      .where(eq(gameEvents.campaignId, auth.campaignId)),
  ]);

  const characterByOwner = new Map(
    characterRows
      .filter((item) => item.ownerMembershipId)
      .map((item) => [item.ownerMembershipId, item.id]),
  );
  const me = memberRows.find((member) => member.id === auth.membershipId);
  if (!me) throw new Error("Membership not found");
  const audio = audioRows[0];
  const snapshotVersion = Number(sequenceRows[0]?.value ?? 0);
  const visibleScenes =
    auth.role === "GM"
      ? sceneRows
      : sceneRows.filter((scene) => scene.id === campaign.activeSceneId);
  const visibleSceneIds = new Set(visibleScenes.map((scene) => scene.id));
  const visibleCharacters =
    auth.role === "GM"
      ? characterRows
      : characterRows.filter(
          (character) => character.ownerMembershipId === auth.membershipId,
        );
  const visibleTokens = tokenRows.filter(
    ({ token, definition }) =>
      visibleSceneIds.has(token.sceneId) &&
      (auth.role === "GM" || (token.visible && token.layer !== "GM")) &&
      definition.campaignId === auth.campaignId,
  );
  const controllersByDefinition = new Map<string, string[]>();
  for (const row of controllerRows) {
    const list =
      controllersByDefinition.get(row.token_controllers.tokenDefinitionId) ??
      [];
    list.push(row.token_controllers.membershipId);
    controllersByDefinition.set(row.token_controllers.tokenDefinitionId, list);
  }
  const entriesByCharacter = new Map<
    string,
    (typeof assignedRows)[number]["entry"][]
  >();
  for (const { entry } of assignedRows) {
    const list = entriesByCharacter.get(entry.characterId) ?? [];
    list.push(entry);
    entriesByCharacter.set(entry.characterId, list);
  }
  const visibleAssetIds = new Set<string>();
  for (const scene of visibleScenes) {
    if (scene.mapAssetId) visibleAssetIds.add(scene.mapAssetId);
  }
  for (const { token } of visibleTokens) {
    if (token.assetId) visibleAssetIds.add(token.assetId);
  }
  for (const character of visibleCharacters) {
    if (character.portraitAssetId)
      visibleAssetIds.add(character.portraitAssetId);
  }
  if (audio?.assetId) visibleAssetIds.add(audio.assetId);
  const visibleAssets =
    auth.role === "GM"
      ? assetRows
      : assetRows.filter((asset) => visibleAssetIds.has(asset.id));

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      day: campaign.day,
      battleActive: campaign.battleActive,
      battleCounter: campaign.battleCounter,
      revision: campaign.revision,
    },
    me: {
      id: me.id,
      role: me.role,
      displayName: me.displayName,
      characterId: characterByOwner.get(me.id) ?? null,
    },
    members: memberRows.map((member) => ({
      id: member.id,
      role: member.role,
      displayName: member.displayName,
      characterId: characterByOwner.get(member.id) ?? null,
    })),
    characters: visibleCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      ownerMembershipId: character.ownerMembershipId,
      portraitAssetId: character.portraitAssetId,
      stats: character.stats,
      skills: character.skills,
      spells: character.spells,
      notes: character.notes,
      backstory: character.backstory,
      inventory: character.inventory,
      resources: character.resources,
      wallet: character.wallet,
      entries: (entriesByCharacter.get(character.id) ?? []).map((entry) => ({
        id: entry.id,
        sourceCatalogEntryId: entry.sourceCatalogEntryId,
        kind: entry.kind,
        name: entry.name,
        description: entry.description,
        data: entry.data,
        revision: entry.revision,
      })),
      revision: character.revision,
    })),
    scenes: visibleScenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      projection: scene.projection,
      mapAssetId: scene.mapAssetId,
      width: scene.width,
      height: scene.height,
      grid: scene.grid,
      active: campaign.activeSceneId === scene.id,
    })),
    catalogEntries:
      auth.role === "GM"
        ? catalogRows.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            name: entry.name,
            description: entry.description,
            data: entry.data,
            revision: entry.revision,
          }))
        : [],
    tokens: visibleTokens.map(({ token, definition }) => {
      const { updatedAt: _updatedAt, ...dto } = token;
      return {
        ...dto,
        definitionId: definition.id,
        definitionRevision: definition.revision,
        characterId: definition.characterId,
        assetId: definition.defaultAssetId,
        name: definition.name,
        width: definition.defaultWidth,
        height: definition.defaultHeight,
        controllerMembershipIds:
          auth.role === "GM"
            ? (controllersByDefinition.get(definition.id) ?? [])
            : (controllersByDefinition.get(definition.id) ?? []).filter(
                (id) => id === auth.membershipId,
              ),
      };
    }),
    fogReveals: fogRows
      .filter(({ fog }) => visibleSceneIds.has(fog.sceneId))
      .map(({ fog }) => ({
        id: fog.id,
        sceneId: fog.sceneId,
        x: fog.x,
        y: fog.y,
        width: fog.width,
        height: fog.height,
      })),
    messages: messageRows.reverse().map(({ message, displayName }) => ({
      id: message.id,
      membershipId: message.membershipId,
      displayName,
      characterId: message.characterId,
      body: message.body,
      visibility: message.visibility,
      kind: message.kind,
      dice: (message.dice as GameSnapshot["messages"][number]["dice"]) ?? null,
      createdAt: message.createdAt.toISOString(),
    })),
    assets: visibleAssets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      url: `/api/assets/${asset.id}/content`,
      createdAt: asset.createdAt.toISOString(),
    })),
    audio: audio
      ? {
          assetId: audio.assetId,
          playing: audio.playing,
          positionSeconds: audio.positionSeconds,
          loop: audio.loop,
          startedAt: audio.startedAt?.toISOString() ?? null,
          updatedAt: audio.updatedAt.toISOString(),
        }
      : {
          assetId: null,
          playing: false,
          positionSeconds: 0,
          loop: false,
          startedAt: null,
          updatedAt: new Date().toISOString(),
        },
    snapshotVersion,
    schemaVersion: env.SCHEMA_VERSION,
    buildVersion: env.APP_VERSION,
    buildRevision: env.BUILD_REVISION,
    serverTime: new Date().toISOString(),
  };
}
