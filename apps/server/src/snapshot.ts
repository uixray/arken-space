import { and, asc, count, desc, eq, gt, inArray, max, or } from "drizzle-orm";
import {
  assets,
  audioStates,
  campaigns,
  catalogEntries,
  characterCatalogEntries,
  characters,
  chatMessages,
  chatAttachments,
  chatAttachmentUploads,
  chatReadCursors,
  chatThreads,
  drawings,
  fogReveals,
  gameEvents,
  memberships,
  playerLikenessConsents,
  stickerPacks,
  stickers,
  scenes,
  tokens,
  tokenControllers,
  tokenDefinitions,
} from "@arken/db";
import type { AuthContext } from "./auth.js";
import type { CatalogEntryDto, GameSnapshot } from "@arken/contracts";
import { env } from "./env.js";
import {
  normalizeLegacyEntryData,
  normalizeLegacyStats,
} from "./entry-data.js";
import { normalizeDiceResult } from "./dice-result.js";
import { normalizeAudioDeadline } from "./audio-state.js";
import {
  chatVisibilityFilter,
  canAccessStream,
  unknownPlayerDisplayName,
} from "./chat.js";
import { revokedStickerTombstone } from "./sticker-access.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export async function buildSnapshot(
  db: Database,
  auth: AuthContext,
): Promise<GameSnapshot> {
  await normalizeAudioDeadline(db, auth.campaignId);
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
    definitionRows,
    catalogRows,
    assignedRows,
    fogRows,
    drawingRows,
    assetRows,
    threadRows,
    cursorRows,
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
      .from(tokenDefinitions)
      .where(eq(tokenDefinitions.campaignId, auth.campaignId))
      .orderBy(asc(tokenDefinitions.createdAt)),
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
      .where(eq(scenes.campaignId, auth.campaignId))
      .orderBy(asc(fogReveals.sequence)),
    db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(eq(scenes.campaignId, auth.campaignId))
      .orderBy(asc(drawings.createdAt)),
    db
      .select()
      .from(assets)
      .where(eq(assets.campaignId, auth.campaignId))
      .orderBy(desc(assets.createdAt)),
    db
      .select()
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.campaignId, auth.campaignId),
          or(
            eq(chatThreads.type, "STREAM"),
            eq(chatThreads.participantAMembershipId, auth.membershipId),
            eq(chatThreads.participantBMembershipId, auth.membershipId),
          ),
        ),
      )
      .orderBy(asc(chatThreads.stream)),
    db
      .select()
      .from(chatReadCursors)
      .where(
        and(
          eq(chatReadCursors.campaignId, auth.campaignId),
          eq(chatReadCursors.membershipId, auth.membershipId),
        ),
      ),
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

  const visibleThreadRows = threadRows.filter(
    (thread) =>
      thread.type === "DIRECT" ||
      (thread.stream !== null && canAccessStream(auth, thread.stream)),
  );
  const cursorByThread = new Map(
    cursorRows.map((cursor) => [cursor.threadId, cursor.lastReadSequence]),
  );
  const messageGroups = await Promise.all(
    visibleThreadRows.map((thread) =>
      db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.campaignId, auth.campaignId),
            eq(chatMessages.threadId, thread.id),
            chatVisibilityFilter(auth),
          ),
        )
        .orderBy(desc(chatMessages.sequence))
        .limit(200),
    ),
  );
  const messageRows = visibleThreadRows
    .flatMap((thread, index) =>
      (messageGroups[index] ?? []).map((message) => ({ message, thread })),
    )
    .filter(
      ({ message }) =>
        !message.stickerViewerMembershipIds ||
        message.stickerViewerMembershipIds.includes(auth.membershipId),
    );
  const visibleMessageIds = messageRows.map(({ message }) => message.id);
  const stickerIds = messageRows.flatMap(({ message }) =>
    message.stickerId ? [message.stickerId] : [],
  );
  const revokedStickerRows = stickerIds.length
    ? await db
        .select({ id: stickers.id })
        .from(stickers)
        .innerJoin(
          stickerPacks,
          and(
            eq(stickerPacks.id, stickers.packId),
            eq(stickerPacks.campaignId, stickers.campaignId),
          ),
        )
        .innerJoin(
          playerLikenessConsents,
          and(
            eq(playerLikenessConsents.packId, stickerPacks.id),
            eq(playerLikenessConsents.campaignId, stickerPacks.campaignId),
          ),
        )
        .where(
          and(
            eq(stickers.campaignId, auth.campaignId),
            inArray(stickers.id, stickerIds),
            eq(stickerPacks.subject, "PLAYER"),
            eq(playerLikenessConsents.status, "REVOKED"),
          ),
        )
    : [];
  const revokedStickerIds = new Set(revokedStickerRows.map((row) => row.id));
  const attachmentRows = visibleMessageIds.length
    ? await db
        .select({ attachment: chatAttachments, upload: chatAttachmentUploads })
        .from(chatAttachments)
        .innerJoin(
          chatAttachmentUploads,
          and(
            eq(chatAttachmentUploads.campaignId, chatAttachments.campaignId),
            eq(chatAttachmentUploads.contentId, chatAttachments.contentId),
          ),
        )
        .where(
          and(
            eq(chatAttachments.campaignId, auth.campaignId),
            inArray(chatAttachments.messageId, visibleMessageIds),
          ),
        )
    : [];
  const attachmentsByMessage = new Map<string, typeof attachmentRows>();
  for (const item of attachmentRows) {
    const items = attachmentsByMessage.get(item.attachment.messageId) ?? [];
    items.push(item);
    attachmentsByMessage.set(item.attachment.messageId, items);
  }
  const unreadGroups = await Promise.all(
    visibleThreadRows.map((thread) =>
      db
        .select({ value: count() })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.campaignId, auth.campaignId),
            eq(chatMessages.threadId, thread.id),
            gt(chatMessages.sequence, cursorByThread.get(thread.id) ?? 0),
            chatVisibilityFilter(auth),
          ),
        ),
    ),
  );

  const characterByOwner = new Map(
    characterRows
      .filter((item) => item.ownerMembershipId)
      .map((item) => [item.ownerMembershipId, item.id]),
  );
  const memberNameById = new Map(
    memberRows.map((member) => [member.id, member.displayName]),
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
  const visibleDefinitions = definitionRows.filter(
    (definition) =>
      auth.role === "GM" ||
      (controllersByDefinition.get(definition.id) ?? []).includes(
        auth.membershipId,
      ),
  );
  for (const definition of visibleDefinitions)
    if (definition.defaultAssetId)
      visibleAssetIds.add(definition.defaultAssetId);
  for (const character of visibleCharacters) {
    if (character.portraitAssetId)
      visibleAssetIds.add(character.portraitAssetId);
  }
  if (audio?.assetId) visibleAssetIds.add(audio.assetId);
  const visibleAssets =
    auth.role === "GM"
      ? assetRows
      : assetRows.filter(
          (asset) =>
            visibleAssetIds.has(asset.id) ||
            (asset.uploadedByMembershipId === auth.membershipId &&
              (asset.kind === "TOKEN" || asset.kind === "PORTRAIT")),
        );

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
      revision: me.revision,
    },
    members: (auth.role === "GM"
      ? memberRows
      : memberRows.filter((member) => member.id === auth.membershipId)
    ).map((member) => ({
      id: member.id,
      role: member.role,
      displayName: member.displayName,
      characterId: characterByOwner.get(member.id) ?? null,
      revision: member.revision,
    })),
    characters: visibleCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      ownerMembershipId: character.ownerMembershipId,
      portraitAssetId: character.portraitAssetId,
      stats: normalizeLegacyStats(character.stats),
      skills: Array.isArray(character.skills) ? character.skills : [],
      spells: Array.isArray(character.spells) ? character.spells : [],
      notes: character.notes,
      backstory: character.backstory,
      inventory: Array.isArray(character.inventory) ? character.inventory : [],
      resources:
        character.resources && typeof character.resources === "object"
          ? character.resources
          : {},
      wallet:
        character.wallet && typeof character.wallet === "object"
          ? character.wallet
          : { gold: 0, silver: 0, copper: 0, sp: 0 },
      entries: (entriesByCharacter.get(character.id) ?? []).map((entry) => ({
        id: entry.id,
        sourceCatalogEntryId: entry.sourceCatalogEntryId,
        kind: entry.kind,
        name: entry.name,
        description: entry.description,
        data: normalizeLegacyEntryData(entry.data) as CatalogEntryDto["data"],
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
      backgroundFrame: {
        x: scene.backgroundX,
        y: scene.backgroundY,
        width: scene.backgroundWidth,
        height: scene.backgroundHeight,
      },
      grid: scene.grid,
      mapScale: scene.mapScale,
      revision: scene.revision,
      active: campaign.activeSceneId === scene.id,
    })),
    catalogEntries:
      auth.role === "GM"
        ? catalogRows.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            name: entry.name,
            description: entry.description,
            data: normalizeLegacyEntryData(
              entry.data,
            ) as CatalogEntryDto["data"],
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
        width: token.width,
        height: token.height,
        controllerMembershipIds:
          auth.role === "GM"
            ? (controllersByDefinition.get(definition.id) ?? [])
            : (controllersByDefinition.get(definition.id) ?? []).filter(
                (id) => id === auth.membershipId,
              ),
      };
    }),
    tokenDefinitions: visibleDefinitions.map((definition) => ({
      id: definition.id,
      characterId: definition.characterId,
      defaultAssetId: definition.defaultAssetId,
      name: definition.name,
      defaultWidth: definition.defaultWidth,
      defaultHeight: definition.defaultHeight,
      controllerMembershipIds:
        auth.role === "GM"
          ? (controllersByDefinition.get(definition.id) ?? [])
          : [auth.membershipId],
      revision: definition.revision,
    })),
    fogReveals: fogRows
      .filter(({ fog }) => visibleSceneIds.has(fog.sceneId))
      .map(({ fog }) => ({
        id: fog.id,
        sceneId: fog.sceneId,
        x: fog.x,
        y: fog.y,
        width: fog.width,
        height: fog.height,
        operation: fog.operation,
        sequence: fog.sequence,
        revision: fog.revision,
      })),
    drawings: drawingRows
      .filter(({ drawing }) => visibleSceneIds.has(drawing.sceneId))
      .map(({ drawing }) => ({
        id: drawing.id,
        sceneId: drawing.sceneId,
        authorMembershipId: drawing.authorMembershipId,
        points: drawing.points,
        color: drawing.color,
        x: drawing.x,
        y: drawing.y,
        revision: drawing.revision,
      })),
    messages: messageRows
      .sort((left, right) => left.message.sequence - right.message.sequence)
      .map(({ message, thread }) => ({
        id: message.id,
        sequence: message.sequence,
        membershipId: message.membershipId,
        displayName:
          memberNameById.get(message.membershipId) ?? unknownPlayerDisplayName,
        characterId: message.characterId,
        body: message.body,
        visibility: message.visibility,
        kind: message.kind,
        threadId: message.threadId,
        stream: thread.stream,
        dice: normalizeDiceResult(message.dice),
        stickerId:
          message.stickerId && revokedStickerIds.has(message.stickerId)
            ? null
            : message.stickerId,
        stickerPresentation:
          message.stickerId && revokedStickerIds.has(message.stickerId)
            ? revokedStickerTombstone
            : message.stickerPresentation,
        attachments: (attachmentsByMessage.get(message.id) ?? []).map(
          ({ upload }) => ({
            contentId: upload.contentId,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            width: upload.width,
            height: upload.height,
            createdAt: upload.createdAt.toISOString(),
          }),
        ),
        createdAt: message.createdAt.toISOString(),
      })),
    chatThreads: visibleThreadRows.map((thread) => {
      const common = {
        id: thread.id,
        campaignId: thread.campaignId,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      };
      if (
        thread.type === "DIRECT" &&
        thread.participantAMembershipId &&
        thread.participantBMembershipId
      ) {
        return {
          ...common,
          type: "DIRECT" as const,
          stream: null,
          participants: [
            {
              membershipId: thread.participantAMembershipId,
              displayName:
                memberNameById.get(thread.participantAMembershipId) ??
                unknownPlayerDisplayName,
            },
            {
              membershipId: thread.participantBMembershipId,
              displayName:
                memberNameById.get(thread.participantBMembershipId) ??
                unknownPlayerDisplayName,
            },
          ] as [
            { membershipId: string; displayName: string },
            { membershipId: string; displayName: string },
          ],
        };
      }
      return {
        ...common,
        type: "STREAM" as const,
        stream: thread.stream!,
      };
    }),
    chatThreadStates: visibleThreadRows.map((thread, index) => {
      const visibleMessages = messageGroups[index] ?? [];
      return {
        threadId: thread.id,
        stream: thread.stream,
        lastReadSequence: cursorByThread.get(thread.id) ?? 0,
        latestSequence: visibleMessages[0]?.sequence ?? 0,
        unreadCount: Number(unreadGroups[index]?.[0]?.value ?? 0),
      };
    }),
    assets: visibleAssets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
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
          revision: audio.revision,
          updatedAt: audio.updatedAt.toISOString(),
        }
      : {
          assetId: null,
          playing: false,
          positionSeconds: 0,
          loop: false,
          startedAt: null,
          revision: 0,
          updatedAt: new Date().toISOString(),
        },
    snapshotVersion,
    schemaVersion: env.SCHEMA_VERSION,
    buildVersion: env.APP_VERSION,
    buildRevision: env.BUILD_REVISION,
    serverTime: new Date().toISOString(),
  };
}
