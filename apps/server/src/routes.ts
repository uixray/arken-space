import { createHash, randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { z } from "zod";
import { canonicalizeFogGeometry, FogGeometryError } from "./fog-geometry.js";
import {
  activateSceneSchema,
  actionIdSchema,
  assetKindSchema,
  characterCommandSchema,
  createCharacterSchema,
  archiveCharacterSchema,
  restoreCharacterSchema,
  assignCatalogEntrySchema,
  catalogEntryCommandSchema,
  characterCatalogEntryCommandSchema,
  createChatMessageSchema,
  createStickerMessageSchema,
  stickerPackAudienceSchema,
  stickerPackSendPolicySchema,
  stickerPackSubjectSchema,
  stickerProvenanceTypeSchema,
  createDirectChatMessageSchema,
  createOrGetDirectChatThreadSchema,
  markChatThreadReadSchema,
  createFogRevealSchema,
  generateTokenAssetSchema,
  changeTokenLayerSchema,
  createDrawingSchema,
  canvasBulkCommandSchema,
  drawingCommandSchema,
  resizeTokenSchema,
  tokenAppearanceSchema,
  historyCommandSchema,
  sceneCanvasConfigSchema,
  updateDrawingSchema,
  createInviteSchema,
  createSceneSchema,
  createTokenSchema,
  createTokenDefinitionSchema,
  diceRequestSchema,
  entryDataSchema,
  entryRollRequestSchema,
  campaignClockCommandSchema,
  characterCountersCommandSchema,
  rechargeEntryCommandSchema,
  renameCampaignSchema,
  setOwnInitiativeSchema,
  setBattleZoneSchema,
  updateTokenConditionsSchema,
  orderInitiative,
  updateInitiativeSchema,
  updateStatLayoutSchema,
  deleteTokenSchema,
  gmLoginSchema,
  inviteClaimSchema,
  rotatePlayerAccessSchema,
  rotateGmAccessSchema,
  replaceTokenControllersSchema,
  replaceCharacterControllersSchema,
  placeTokenDefinitionSchema,
  renameCommandSchema,
  revisionCommandSchema,
  tokenDefinitionUpdateSchema,
  updateSceneMetadataSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@arken/contracts";
import { betaPlayerByHandle, uniqueBetaPlayerIdentity } from "@arken/contracts";
import {
  assets,
  actionJournal,
  catalogEntries,
  characterCatalogEntries,
  characterControllers,
  campaigns,
  characters,
  chatMessages,
  chatReadCursors,
  chatThreads,
  chatAttachments,
  chatAttachmentUploads,
  stickerMedia,
  stickerPackEntitlements,
  stickerPacks,
  stickers,
  playerLikenessConsents,
  drawings,
  encounters,
  fogReveals,
  feedbackAttachments,
  feedbackReports,
  gameEvents,
  gmAccessCredentials,
  invites,
  playerAccessGrants,
  memberships,
  scenes,
  sessions,
  tokens,
  tokenControllers,
  tokenDefinitions,
} from "@arken/db";
import { createStarterCharacter, RESOURCE_REGEN_STAT } from "@arken/system";
import { createSession, requireAuth } from "./auth.js";
import { DiceFormulaError, rollFormulaWithMode } from "./dice.js";
import { env } from "./env.js";
import { hashToken, randomToken, safeEqual } from "./security.js";
import {
  buildSnapshot,
  loadCampaignReadSet,
  resolveStatLayout,
} from "./snapshot.js";
import { fullChatVisibilityFilter, loadThreadHistory } from "./chat-history.js";
import { listVisiblePlayerRequests } from "./player-requests.js";
import {
  largestFields,
  measureSnapshot,
  queryCountSince,
  readQueryCount,
  SNAPSHOT_METRICS_ENABLED,
  sumByField,
  type BroadcastMeasurement,
} from "./snapshot-metrics.js";
import {
  characterDto,
  normalizeCharacterResources,
  normalizeCharacterWallet,
} from "./character-dto.js";
import {
  rejectDestructiveLayoutChange,
  removedStatKeys,
  type StatReferenceSources,
} from "./stat-layout.js";
import { registerWorldMapRoutes } from "./world-map-routes.js";
import { registerStoryRoutes } from "./story.js";
import { registerAssetLifecycleRoutes } from "./asset-usage.js";
import { assetContentVersion } from "./asset-lifecycle.js";
import { registerOperatorFeedbackRoutes } from "./operator-feedback.js";
import { registerPlayerRequestRoutes } from "./player-requests.js";
import { registerCharacterMediaRoutes } from "./character-media.js";
import { registerEncounterRoutes } from "./encounters.js";
import { recruitFromBattleZone } from "./battle-initiative.js";
import {
  campaignRechargeAnchorsNeedReset,
  rechargeCampaignCatalogEntries,
  resetCampaignRechargeAnchors,
} from "./campaign-clock.js";
import { registerCampaignPauseRoutes } from "./campaign-pause.js";
import { registerWorldContentRoutes } from "./world-content-routes.js";
import { registerWorldContentInstanceRoutes } from "./world-content-instances.js";
import { registerSpellPackRoutes } from "./spell-pack-routes.js";
import { registerSpellAssignmentRoutes } from "./spell-assignment-routes.js";
import { registerSpellProjectionRoutes } from "./spell-projection-routes.js";
import {
  canPostToStream,
  createOrGetDirectThread,
  directThreadMemberIds,
  chatBroadcastAudience,
  chatMessageDto,
  chatVisibilityFilter,
  clampReadSequence,
  ensureStreamThread,
  resolveChatThread,
} from "./chat.js";
import {
  canMemberSendPack,
  canMembersViewPack,
  resolveSticker,
  isMatchingStickerReplay,
  invalidateStickerConsentClients,
  stickerMessageVisibility,
  stickerAssetUrl,
  stickerPresentation,
} from "./sticker-access.js";
import { invalidateRedoBranch } from "./canvas-history.js";
import {
  normalizeLegacyEntryData,
  normalizeLegacyFormula,
  normalizeLegacyStats,
} from "./entry-data.js";
import {
  clientEventSchema,
  publicUploadError,
  safeClientMessage,
  sanitizeClientContext,
} from "./telemetry.js";
import {
  assertStorageCapacity,
  assertStorageQuota,
  displayNameFromUpload,
  openStoredFile,
  readStoredImage,
  removeStoredUpload,
  renderTokenAsset,
  storeGeneratedToken,
  storeUpload,
} from "./storage.js";
import {
  authenticatedFeedbackFieldsSchema,
  parseFeedbackDiagnostics,
  publicSuggestionSchema,
} from "./feedback.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
const campaignRoom = (id: string) => `campaign:${id}`;
const gmRoom = (id: string) => `campaign:${id}:gm`;
const memberRoom = (id: string) => `member:${id}`;
const sessionRoom = (id: string) => `session:${id}`;

/**
 * UIX-408 — видна ли этому сокету сцена, к которой относится канвас.
 *
 * Игроку видима ровно транслируемая сцена; мастеру — она же плюс та, которую
 * он рассматривает (`scene:view`). Та же выборка, что у снапшота, — иначе
 * событие и снапшот разошлись бы, а расхождение здесь означает туман сцены,
 * которой в снапшоте нет.
 */
/** Рассматриваемая сцена сокета, если она есть, — в виде списка для снапшота. */
function viewedScenes(data: { viewedSceneId?: string | null }): string[] {
  return data.viewedSceneId ? [data.viewedSceneId] : [];
}

function canvasSceneVisibleTo(
  data: { auth?: { role: string }; viewedSceneId?: string | null },
  campaign: { activeSceneId: string | null },
  sceneId: string,
) {
  if (sceneId === campaign.activeSceneId) return true;
  return data.auth?.role === "GM" && data.viewedSceneId === sceneId;
}

async function broadcastSnapshots(
  io: RealtimeServer,
  db: Database,
  campaignId: string,
) {
  const sockets = await io.in(campaignRoom(campaignId)).fetchSockets();
  const targetSockets = sockets.filter(
    (socket) => socket.data.auth?.campaignId === campaignId,
  );
  // Пустая комната не должна платить за общий read set только ради отчёта.
  if (targetSockets.length === 0) return;

  // Счётчик и таймер стартуют до общего чтения: иначе отчёт скрывал как раз
  // ту часть работы, ради которой UIX-409 и вводила CampaignReadSet.
  let startedAt = 0;
  let queryCountAtStart = 0;
  if (SNAPSHOT_METRICS_ENABLED) {
    // Глобальный счётчик намеренно не сбрасывается: параллельная рассылка не
    // должна обнулять чужое окно. Delta остаётся process-window estimate;
    // точное acceptance-число даёт только изолированный measurement process.
    queryCountAtStart = readQueryCount();
    startedAt = performance.now();
  }
  /**
   * UIX-409 — кампанийные чтения делаются один раз на всю рассылку.
   *
   * Семь снапшотов читали одно и то же семь раз: 239 запросов при пуле в
   * десять соединений — это очередь, а не работа. Набор живёт только внутри
   * этого вызова: кеша со временем жизни нет и не будет.
   *
   * Побочно это чинит согласованность: раньше семь снапшотов одной рассылки
   * строились в семь разных моментов и могли расходиться между собой.
   */
  const readSet = await loadCampaignReadSet(db, campaignId);
  if (!SNAPSHOT_METRICS_ENABLED) {
    await Promise.all(
      targetSockets.map(async (socket) => {
        const auth = socket.data.auth;
        if (auth?.campaignId === campaignId) {
          // UIX-408: мастеру приходит канвас и той сцены, которую он
          // рассматривает, — иначе он рисовал бы туман поверх якобы пустой.
          socket.emit(
            "game:snapshot",
            await buildSnapshot(db, auth, viewedScenes(socket.data), readSet),
          );
        }
      }),
    );
    return;
  }

  /**
   * UIX-408/409, этап 0. Меряется **вся рассылка**, а не одна сборка: пул к
   * PostgreSQL — десять соединений, а семь сборок по полтора десятка
   * параллельных запросов дают около сотни, конкурирующих за эти десять.
   * Нелинейно растёт очередь, и видно её только здесь.
   */
  const perSocket: BroadcastMeasurement["perSocket"] = [];
  const fieldReports: Record<string, number>[] = [];
  await Promise.all(
    targetSockets.map(async (socket) => {
      const auth = socket.data.auth;
      if (auth?.campaignId !== campaignId) return;
      const socketStartedAt = performance.now();
      const snapshot = await buildSnapshot(
        db,
        auth,
        viewedScenes(socket.data),
        readSet,
      );
      const ms = performance.now() - socketStartedAt;
      const { bytes, byField } = measureSnapshot(snapshot);
      perSocket.push({ role: auth.role, bytes, ms });
      fieldReports.push(byField);
      socket.emit("game:snapshot", snapshot);
    }),
  );
  const measurement: BroadcastMeasurement = {
    campaignId,
    sockets: perSocket.length,
    queries: queryCountSince(queryCountAtStart),
    queryCountScope: "PROCESS_WINDOW_ESTIMATE",
    totalBytes: perSocket.reduce((sum, item) => sum + item.bytes, 0),
    totalMs: performance.now() - startedAt,
    perSocket,
    bytesByField: sumByField(fieldReports),
  };
  // Числа, а не игровые данные: количество запросов, байты и миллисекунды.
  console.info(
    "[snapshot-metrics]",
    JSON.stringify({
      ...measurement,
      largest: largestFields(measurement.bytesByField),
    }),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

export function fitFrameToWorld(
  assetWidth: number | null | undefined,
  assetHeight: number | null | undefined,
  worldWidth: number,
  worldHeight: number,
) {
  if (!assetWidth || !assetHeight)
    return { x: 0, y: 0, width: worldWidth, height: worldHeight };
  const scale = Math.min(worldWidth / assetWidth, worldHeight / assetHeight);
  const width = assetWidth * scale;
  const height = assetHeight * scale;
  return {
    x: (worldWidth - width) / 2,
    y: (worldHeight - height) / 2,
    width,
    height,
  };
}

const walletLabels = {
  gold: "золото",
  silver: "серебро",
  copper: "медь",
  sp: "СП",
} as const;

type Wallet = Record<keyof typeof walletLabels, number>;

type WalletAuditSystemData = {
  type: "WALLET_AUDIT";
  before: Wallet;
  after: Wallet;
  lastAt: string;
  operationCount: number;
};

const WALLET_AUDIT_BURST_MS = 5_000;

function isWalletAuditSystemData(
  value: unknown,
): value is WalletAuditSystemData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<WalletAuditSystemData>;
  return (
    data.type === "WALLET_AUDIT" &&
    typeof data.lastAt === "string" &&
    typeof data.operationCount === "number" &&
    Boolean(data.before) &&
    Boolean(data.after)
  );
}

function formatWalletChanges(before: Wallet, after: Wallet) {
  const changes = Object.entries(walletLabels)
    .filter(
      ([key]) => before[key as keyof Wallet] !== after[key as keyof Wallet],
    )
    .map(([key, label]) => {
      const currency = key as keyof Wallet;
      return `${label} ${before[currency]} → ${after[currency]}`;
    });
  return changes.length > 0 ? `кошелёк: ${changes.join(", ")}` : "";
}

type Resources = Record<
  string,
  {
    current: number;
    maximum?: number;
    description?: string;
    imageAssetId?: string | null;
    recoverable?: boolean;
  }
>;

function formatResourceValue(value: Resources[string] | undefined) {
  if (!value) return "удалён";
  return value.maximum === undefined
    ? String(value.current)
    : `${value.current}/${value.maximum}`;
}

/**
 * UIX-476 — имя ресурса принадлежит раскладке кампании, а не ключу JSON.
 * Строка могла быть удалена уже после создания ресурса, поэтому отсутствие
 * подписи штатно: formatter ниже оставляет сам ключ вместо пустого имени.
 */
function resourceLabelsFromLayout(
  layout: ReturnType<typeof resolveStatLayout>,
): ReadonlyMap<string, string> {
  return new Map(
    layout.flatMap((group) =>
      group.rows
        .filter((row) => row.source === "RESOURCE")
        .map((row) => [row.key, row.label] as const),
    ),
  );
}

function formatResourceChanges(
  before: Resources,
  after: Resources,
  labels: ReadonlyMap<string, string>,
) {
  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort();
  const changes = keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => {
      const label = labels.get(key) ?? key;
      if (!before[key])
        return `${label}: добавлен ${formatResourceValue(after[key])}`;
      if (!after[key]) return `${label}: удалён`;
      return `${label}: ${formatResourceValue(before[key])} → ${formatResourceValue(after[key])}`;
    });
  return changes.length > 0 ? `ресурсы: ${changes.join(", ")}` : "";
}

/**
 * UIX-425 — отдых восстанавливает ресурсы на величину регена.
 *
 * Правило системы: длинный отдых даёт реген из карточки персонажа, короткий —
 * половину с округлением **вниз**, сверх максимума не восстанавливается.
 *
 * Было три расхождения сразу, и все в сторону «слишком щедро»: длинный отдых
 * восстанавливал до максимума, короткий давал четверть максимума вместо
 * половины регена, а округление шло вверх. У персонажа с маной 20 и регеном 9
 * длинный отдых давал +20 вместо +9 — ограничение ресурса в игре фактически
 * не работало.
 *
 * Ресурс без строки регена отдыхом не восстанавливается: «на величину регена»
 * у неизвестного ресурса величины не имеет. Такие ресурсы правятся вручную
 * счётчиками рядом с бросками.
 */
function applyCharacterRest(
  resources: Resources,
  rest: "SHORT" | "LONG",
  stats: Record<string, number>,
): Resources {
  return Object.fromEntries(
    Object.entries(resources).map(([key, resource]) => {
      if (resource.recoverable === false) return [key, resource];

      const regenStat = RESOURCE_REGEN_STAT[key];
      const regen = regenStat ? (stats[regenStat] ?? 0) : 0;
      if (regen <= 0) return [key, resource];

      const maximum = resource.maximum ?? resource.current;
      // Половина регена вниз: реген 9 при коротком отдыхе даёт 4, а не 5.
      const gain = rest === "LONG" ? regen : Math.floor(regen / 2);
      return [
        key,
        {
          ...resource,
          current: Math.min(maximum, resource.current + gain),
          maximum,
        },
      ];
    }),
  );
}

async function characterControllerIds(
  db: Database,
  characterId: string,
): Promise<string[]> {
  const rows = await db
    .select({ membershipId: characterControllers.membershipId })
    .from(characterControllers)
    .where(eq(characterControllers.characterId, characterId));
  return rows.map((row) => row.membershipId);
}

async function canAccessCharacter(
  db: Database,
  auth: { role: "GM" | "PLAYER"; membershipId: string },
  character: typeof characters.$inferSelect | undefined,
): Promise<boolean> {
  if (!character) return false;
  if (auth.role === "GM" || character.ownerMembershipId === auth.membershipId)
    return true;
  const [controller] = await db
    .select({ membershipId: characterControllers.membershipId })
    .from(characterControllers)
    .where(
      and(
        eq(characterControllers.characterId, character.id),
        eq(characterControllers.membershipId, auth.membershipId),
      ),
    )
    .limit(1);
  return Boolean(controller);
}

async function findAction(db: Database, campaignId: string, actionId: string) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  return event ?? null;
}

/**
 * UIX-424, шаг 6 — всё в кампании, что может сослаться на характеристику.
 *
 * Архивные персонажи включены намеренно: их навыки никуда не делись, и
 * характеристика, удалённая «потому что она только у архивного», сломает бросок
 * ровно в тот момент, когда персонажа вернут.
 */
async function collectStatReferenceSources(
  db: Database,
  campaignId: string,
): Promise<StatReferenceSources> {
  const characterRows = await db
    .select()
    .from(characters)
    .where(eq(characters.campaignId, campaignId));
  const entryRows = characterRows.length
    ? await db
        .select()
        .from(characterCatalogEntries)
        .where(
          inArray(
            characterCatalogEntries.characterId,
            characterRows.map((character) => character.id),
          ),
        )
    : [];
  const catalogRows = await db
    .select()
    .from(catalogEntries)
    .where(eq(catalogEntries.campaignId, campaignId));

  return {
    characters: characterRows.map((character) => ({
      name: character.name,
      skills: character.skills,
      spells: character.spells,
      entries: entryRows
        .filter((entry) => entry.characterId === character.id)
        .map((entry) => ({ name: entry.name, data: entry.data })),
    })),
    catalogEntries: catalogRows.map((entry) => ({
      name: entry.name,
      data: entry.data,
    })),
  };
}

function sceneDto(
  scene: typeof scenes.$inferSelect,
  activeSceneId: string | null,
) {
  return {
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
    active: activeSceneId === scene.id,
  };
}

async function findSceneDto(db: Database, campaignId: string, sceneId: string) {
  const [row] = await db
    .select({ scene: scenes, activeSceneId: campaigns.activeSceneId })
    .from(scenes)
    .innerJoin(campaigns, eq(campaigns.id, scenes.campaignId))
    .where(and(eq(scenes.id, sceneId), eq(scenes.campaignId, campaignId)))
    .limit(1);
  return row ? sceneDto(row.scene, row.activeSceneId) : null;
}

export async function claimInviteOwnership(
  db: Database,
  invite: typeof invites.$inferSelect,
  displayName: string,
) {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .insert(memberships)
      .values({
        campaignId: invite.campaignId,
        role: "PLAYER",
        displayName,
      })
      .returning();
    if (!member) throw new Error("MEMBER_CREATE_FAILED");
    await tx
      .update(characters)
      .set({ ownerMembershipId: member.id, updatedAt: new Date() })
      .where(
        and(
          eq(characters.id, invite.characterId),
          eq(characters.campaignId, invite.campaignId),
        ),
      );
    await tx
      .insert(characterControllers)
      .values({ characterId: invite.characterId, membershipId: member.id })
      .onConflictDoNothing();
    await tx.execute(sql`insert into token_controllers (token_definition_id, membership_id)
      select d.id, ${member.id} from token_definitions d
      where d.character_id = ${invite.characterId} and d.campaign_id = ${invite.campaignId}
      and not exists (select 1 from token_controllers c where c.token_definition_id = d.id)
      on conflict do nothing`);
    const [claimed] = await tx
      .update(invites)
      .set({ claimedAt: new Date(), claimedByMembershipId: member.id })
      .where(and(eq(invites.id, invite.id), isNull(invites.claimedAt)))
      .returning();
    if (!claimed) throw new Error("INVITE_ALREADY_CLAIMED");
    return member;
  });
}

function playerAccessDto(
  grant: typeof playerAccessGrants.$inferSelect,
  characterId: string | null,
) {
  return {
    id: grant.id,
    membershipId: grant.membershipId,
    characterId,
    label: grant.label,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

async function createPlayerAccess(
  db: Database,
  campaignId: string,
  characterId: string,
  label: string,
  actionId: string,
  actorMembershipId: string,
) {
  const token = randomToken();
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from characters where id = ${characterId} and campaign_id = ${campaignId} for update`,
    );
    const [character] = await tx
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, campaignId),
        ),
      )
      .limit(1);
    if (!character) throw new Error("CHARACTER_NOT_FOUND");
    if (character.ownerMembershipId) {
      const [existing] = await tx
        .select()
        .from(playerAccessGrants)
        .where(
          and(
            eq(playerAccessGrants.campaignId, campaignId),
            eq(playerAccessGrants.membershipId, character.ownerMembershipId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.revokedAt) {
          const [reactivated] = await tx
            .update(playerAccessGrants)
            .set({
              label,
              tokenHash: hashToken(token),
              revokedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(playerAccessGrants.id, existing.id))
            .returning();
          if (!reactivated) throw new Error("ACCESS_GRANT_CREATE_FAILED");
          await tx
            .delete(sessions)
            .where(eq(sessions.membershipId, existing.membershipId));
          await tx.insert(gameEvents).values({
            campaignId,
            actionId,
            membershipId: actorMembershipId,
            type: "player_access.reactivated",
            entityType: "player_access",
            entityId: existing.id,
            payload: { characterId },
          });
          return {
            grant: reactivated,
            memberId: existing.membershipId,
            created: true,
          };
        }
        await tx.insert(gameEvents).values({
          campaignId,
          actionId,
          membershipId: actorMembershipId,
          type: "player_access.reused",
          entityType: "player_access",
          entityId: existing.id,
          payload: { characterId },
        });
        return {
          grant: existing,
          memberId: existing.membershipId,
          created: false,
        };
      }
    }
    const [member] = await tx
      .insert(memberships)
      .values({ campaignId, role: "PLAYER", displayName: label })
      .returning();
    if (!member) throw new Error("MEMBER_CREATE_FAILED");
    await tx
      .update(characters)
      .set({ ownerMembershipId: member.id, updatedAt: new Date() })
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, campaignId),
        ),
      );
    await tx
      .insert(characterControllers)
      .values({ characterId, membershipId: member.id })
      .onConflictDoNothing();
    await tx.execute(sql`insert into token_controllers (token_definition_id, membership_id)
      select d.id, ${member.id} from token_definitions d
      where d.character_id = ${characterId} and d.campaign_id = ${campaignId}
      and not exists (select 1 from token_controllers c where c.token_definition_id = d.id)
      on conflict do nothing`);
    const [grant] = await tx
      .insert(playerAccessGrants)
      .values({
        campaignId,
        membershipId: member.id,
        label,
        tokenHash: hashToken(token),
      })
      .returning();
    if (!grant) throw new Error("ACCESS_GRANT_CREATE_FAILED");
    await tx.insert(gameEvents).values({
      campaignId,
      actionId,
      membershipId: actorMembershipId,
      type: "player_access.created",
      entityType: "player_access",
      entityId: grant.id,
      payload: { membershipId: member.id, characterId },
    });
    return { grant, memberId: member.id, created: true };
  });
  return { ...result, token: result.created ? token : null };
}
type SceneTokenGeometrySnapshot = {
  tokens: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    revision: number;
  }>;
};

const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 1024;
const roundedCanvasValue = (value: number) =>
  Math.round(value * 1_000_000) / 1_000_000;
class SceneGridTokenBoundsError extends Error {
  constructor(
    readonly tokenId: string,
    readonly width: number,
    readonly height: number,
  ) {
    super("SCENE_GRID_TOKEN_BOUNDS");
  }
}
const scaledTokenLength = (value: number, scale: number) =>
  roundedCanvasValue(value * scale);
const scaledGridCoordinate = (
  value: number,
  previousOffset: number,
  nextOffset: number,
  scale: number,
) => roundedCanvasValue(nextOffset + (value - previousOffset) * scale);

export function registerRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
) {
  registerWorldMapRoutes(app, db, (campaignId) =>
    broadcastSnapshots(io, db, campaignId),
  );
  registerStoryRoutes(app, db, io);
  registerOperatorFeedbackRoutes(app, db);
  registerPlayerRequestRoutes(app, db, io);
  registerCharacterMediaRoutes(app, db);
  registerEncounterRoutes(app, db, (campaignId) =>
    broadcastSnapshots(io, db, campaignId),
  );
  registerCampaignPauseRoutes(app, db, (campaignId) =>
    broadcastSnapshots(io, db, campaignId),
  );
  registerWorldContentRoutes(app, db);
  registerWorldContentInstanceRoutes(app, db);
  registerSpellPackRoutes(app, db);
  registerSpellAssignmentRoutes(app, db);
  registerSpellProjectionRoutes(app, db);
  registerAssetLifecycleRoutes(app, db, io, broadcastSnapshots);

  app.get("/healthz", { logLevel: "silent" }, async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return {
        status: "ok",
        database: "ok",
        buildVersion: env.APP_VERSION,
        buildRevision: env.BUILD_REVISION,
        schemaVersion: env.SCHEMA_VERSION,
        time: new Date().toISOString(),
      };
    } catch (error) {
      app.log.error({ error }, "health.database_unavailable");
      return reply.code(503).send({
        status: "error",
        database: "unavailable",
        time: new Date().toISOString(),
      });
    }
  });

  app.post("/api/auth/gm", async (request, reply) => {
    const body = gmLoginSchema.parse(request.body);
    const credentials = await db
      .select({
        membershipId: memberships.id,
        tokenHash: gmAccessCredentials.tokenHash,
      })
      .from(gmAccessCredentials)
      .innerJoin(
        memberships,
        eq(memberships.campaignId, gmAccessCredentials.campaignId),
      )
      .where(eq(memberships.role, "GM"));
    const gm = credentials.find((credential) =>
      safeEqual(hashToken(body.token), credential.tokenHash),
    );
    if (!gm) return reply.code(403).send({ error: "INVALID_MASTER_TOKEN" });
    await createSession(db, reply, gm.membershipId);
    return { ok: true };
  });

  app.post("/api/auth/invite", async (request, reply) => {
    const body = inviteClaimSchema.parse(request.body);
    const tokenHash = hashToken(body.token);
    const [grant] = await db
      .select({ membershipId: playerAccessGrants.membershipId })
      .from(playerAccessGrants)
      .innerJoin(
        memberships,
        eq(playerAccessGrants.membershipId, memberships.id),
      )
      .where(
        and(
          eq(playerAccessGrants.tokenHash, tokenHash),
          isNull(playerAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (grant) {
      if (body.displayName)
        await db
          .update(memberships)
          .set({ displayName: body.displayName })
          .where(eq(memberships.id, grant.membershipId));
      await createSession(db, reply, grant.membershipId);
      return { ok: true };
    }

    const [invite] = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          isNull(invites.claimedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invite) return reply.code(410).send({ error: "INVITE_EXPIRED" });

    const result = await claimInviteOwnership(
      db,
      invite,
      body.displayName ?? invite.label,
    );
    await createSession(db, reply, result.id);
    return { ok: true };
  });

  // Temporary closed-beta shortcut. This intentionally authenticates by a
  // public alias and must be removed when UIX-232's recorded debt is paid.
  app.post("/api/auth/player/:handle", async (request, reply) => {
    const handle = z
      .object({ handle: z.string().min(1).max(40) })
      .parse(request.params).handle;
    const player = betaPlayerByHandle(handle);
    if (!player) return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
    const activeGrants = await db
      .select({
        membershipId: playerAccessGrants.membershipId,
        label: playerAccessGrants.label,
        displayName: memberships.displayName,
      })
      .from(playerAccessGrants)
      .innerJoin(
        memberships,
        eq(playerAccessGrants.membershipId, memberships.id),
      )
      .where(
        and(
          isNull(playerAccessGrants.revokedAt),
          eq(memberships.role, "PLAYER"),
          eq(playerAccessGrants.campaignId, memberships.campaignId),
        ),
      );
    const grant = uniqueBetaPlayerIdentity(player, activeGrants);
    if (!grant) return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
    await createSession(db, reply, grant.membershipId);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (token) {
      const deleted = await db
        .delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(token)))
        .returning({ id: sessions.id });
      for (const session of deleted)
        io.in(sessionRoom(session.id)).disconnectSockets(true);
    }
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.post("/api/gm-access/rotate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = rotateGmAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ ok: true, duplicate: true });
    const result = await db.transaction(async (tx) => {
      const [credential] = await tx
        .select()
        .from(gmAccessCredentials)
        .where(eq(gmAccessCredentials.campaignId, auth.campaignId))
        .limit(1);
      if (!credential) return null;
      const [rotated] = await tx
        .update(gmAccessCredentials)
        .set({
          tokenHash: hashToken(body.token),
          revision: credential.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(gmAccessCredentials.campaignId, auth.campaignId),
            eq(gmAccessCredentials.tokenHash, credential.tokenHash),
            eq(gmAccessCredentials.revision, credential.revision),
          ),
        )
        .returning();
      if (!rotated) return null;
      const gmRows = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "GM"),
          ),
        );
      const gmMembershipIds = gmRows.map((member) => member.id);
      await tx
        .delete(sessions)
        .where(inArray(sessions.membershipId, gmMembershipIds));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "gm_access.rotated",
        entityType: "campaign",
        entityId: auth.campaignId,
      });
      return gmMembershipIds;
    });
    if (!result) return reply.code(409).send({ error: "GM_ACCESS_CONFLICT" });
    for (const membershipId of result)
      io.in(memberRoom(membershipId)).disconnectSockets(true);
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/bootstrap", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    return buildSnapshot(db, auth);
  });

  app.get("/api/diagnostics", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const snapshot = await buildSnapshot(db, auth);
    return {
      status: "ok",
      requestId: request.id,
      buildVersion: snapshot.buildVersion,
      buildRevision: snapshot.buildRevision,
      schemaVersion: snapshot.schemaVersion,
      snapshotVersion: snapshot.snapshotVersion,
      serverTime: snapshot.serverTime,
    };
  });

  app.get("/api/preview/:membershipId", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { membershipId } = z
      .object({ membershipId: z.string().uuid() })
      .parse(request.params);
    const [target] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, membershipId),
          eq(memberships.campaignId, auth.campaignId),
          eq(memberships.role, "PLAYER"),
        ),
      )
      .limit(1);
    if (!target) return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
    return buildSnapshot(db, {
      membershipId: target.id,
      campaignId: target.campaignId,
      role: target.role,
      displayName: target.displayName,
    });
  });

  app.patch("/api/memberships/:id/name", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = renameCommandSchema
      .extend({
        name: z.string().trim().min(1).max(40),
      })
      .parse(request.body);
    if (auth.role !== "GM" && id !== auth.membershipId)
      return reply.code(403).send({ error: "MEMBERSHIP_FORBIDDEN" });
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
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
    if (!current)
      return reply.code(404).send({ error: "MEMBERSHIP_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "MEMBERSHIP_CONFLICT", revision: current.revision });
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(memberships)
        .set({ displayName: body.name, revision: current.revision + 1 })
        .where(
          and(
            eq(memberships.id, id),
            eq(memberships.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "membership.renamed",
        entityType: "membership",
        entityId: next.id,
        entityRevision: next.revision,
        payload: { membershipId: next.id, displayName: next.displayName },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "MEMBERSHIP_CONFLICT" });
    const sockets = await io.in(campaignRoom(auth.campaignId)).fetchSockets();
    for (const socket of sockets) {
      if (socket.data.auth?.membershipId === id)
        socket.data.auth.displayName = updated.displayName;
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.post(
    "/api/client-logs",
    {
      bodyLimit: 4 * 1024,
      config: { rateLimit: { max: 120, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const body = clientEventSchema.parse(request.body);
      app.log[body.level](
        {
          source: "browser",
          buildRevision: env.BUILD_REVISION,
          membershipId: auth.membershipId,
          campaignId: auth.campaignId,
          event: body.event,
          message: safeClientMessage(body.event),
          context: sanitizeClientContext(body.context),
          // Structural-only: class name + bounded stack frames describe
          // code, never user content (see telemetry.ts). occurrenceCount
          // reflects client-side dedup of repeated identical errors.
          // Absent on performance windows, which carry measurements rather
          // than a failure — hence the presence checks rather than a direct
          // read off the union.
          errorName: "errorName" in body ? body.errorName : undefined,
          stack: "stack" in body ? body.stack : undefined,
          occurrenceCount:
            "occurrenceCount" in body ? body.occurrenceCount : undefined,
          requestId: request.id,
        },
        "client.event",
      );
      return reply.code(202).send({ ok: true });
    },
  );

  app.post(
    "/api/feedback/suggestions",
    {
      bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const body = publicSuggestionSchema.parse(request.body);
      // Bots commonly fill this invisible field. Answer successfully without
      // retaining their payload, so the endpoint does not become an oracle.
      if (body.website) return reply.code(202).send({ accepted: true });
      const [created] = await db
        .insert(feedbackReports)
        .values({
          kind: "SUGGESTION",
          description: body.description,
          contact: body.contact || null,
          buildVersion: env.APP_VERSION,
          buildRevision: env.BUILD_REVISION,
          requestId: request.id,
          diagnostics: {},
        })
        .returning({ id: feedbackReports.id });
      request.log.info(
        { reportId: created?.id },
        "feedback.suggestion_received",
      );
      return reply.code(201).send({ id: created?.id, accepted: true });
    },
  );

  app.post(
    "/api/feedback/reports",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (!request.isMultipart())
        return reply.code(415).send({ error: "MULTIPART_REQUIRED" });

      const fields: Record<string, string> = {};
      const uploads: Array<{
        kind: "SCREENSHOT" | "USER_IMAGE";
        buffer: Buffer;
      }> = [];
      for await (const part of request.parts({
        limits: {
          files: 2,
          fields: 5,
          parts: 7,
          fileSize: env.MAX_IMAGE_BYTES,
        },
      })) {
        if (part.type === "file") {
          const kind =
            part.fieldname === "screenshot"
              ? "SCREENSHOT"
              : part.fieldname === "image"
                ? "USER_IMAGE"
                : null;
          if (!kind) {
            part.file.resume();
            return reply.code(400).send({ error: "UNKNOWN_ATTACHMENT_FIELD" });
          }
          if (uploads.some((upload) => upload.kind === kind)) {
            part.file.resume();
            return reply.code(400).send({ error: "DUPLICATE_ATTACHMENT" });
          }
          uploads.push({ kind, buffer: await part.toBuffer() });
        } else {
          if (typeof part.value !== "string" || fields[part.fieldname])
            return reply.code(400).send({ error: "INVALID_FEEDBACK_FIELD" });
          fields[part.fieldname] = part.value;
        }
      }
      const body = authenticatedFeedbackFieldsSchema.parse(fields);
      if (body.website) return reply.code(202).send({ accepted: true });
      const diagnostics = parseFeedbackDiagnostics(body.diagnostics);

      const incomingBytes = uploads.reduce(
        (total, upload) => total + upload.buffer.length,
        0,
      );
      if (incomingBytes > 0) {
        const [assetUsage, attachmentUsage] = await Promise.all([
          db.select({ used: sum(assets.sizeBytes) }).from(assets),
          db
            .select({ used: sum(feedbackAttachments.sizeBytes) })
            .from(feedbackAttachments),
        ]);
        await assertStorageCapacity(
          Number(assetUsage[0]?.used ?? 0) +
            Number(attachmentUsage[0]?.used ?? 0),
          incomingBytes,
        );
      }

      const stored = [] as Array<
        Awaited<ReturnType<typeof storeUpload>> & {
          kind: "SCREENSHOT" | "USER_IMAGE";
        }
      >;
      try {
        for (const upload of uploads)
          stored.push({
            kind: upload.kind,
            ...(await storeUpload(upload.buffer, "image")),
          });
        const report = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(feedbackReports)
            .values({
              kind: body.kind,
              campaignId: auth.campaignId,
              actorMembershipId: auth.membershipId,
              title: body.title,
              description: body.description,
              buildVersion: env.APP_VERSION,
              buildRevision: env.BUILD_REVISION,
              requestId: request.id,
              diagnostics,
            })
            .returning({ id: feedbackReports.id });
          if (!created) throw new Error("FEEDBACK_CREATE_FAILED");
          if (stored.length)
            await tx.insert(feedbackAttachments).values(
              stored.map((attachment) => ({
                reportId: created.id,
                kind: attachment.kind,
                storageKey: attachment.storageKey,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                width: attachment.width!,
                height: attachment.height!,
              })),
            );
          return created;
        });
        request.log.info(
          {
            reportId: report.id,
            kind: body.kind,
            attachmentCount: stored.length,
          },
          "feedback.report_received",
        );
        return reply.code(201).send({ id: report.id, accepted: true });
      } catch (error) {
        await Promise.all(
          stored.map((attachment) => removeStoredUpload(attachment.storageKey)),
        );
        const errorCode = publicUploadError(error);
        if (errorCode !== "UPLOAD_FAILED")
          return reply.code(400).send({ error: errorCode });
        throw error;
      }
    },
  );

  app.post("/api/characters", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createCharacterSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    // A template preset carries over structural fields only (stats/skills/spells/
    // inventory/resources); the client derives it from an existing character and
    // sends a deep-cloned snapshot, so the new character is independent from
    // the moment it is created — never a live-linked clone of its source.
    const starter = createStarterCharacter();
    const template = body.template ?? {};
    const character = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(characters)
        .values({
          campaignId: auth.campaignId,
          name: body.name,
          stats: { ...starter.stats, ...template.stats },
          skills: template.skills ?? starter.skills,
          spells: template.spells ?? starter.spells,
          inventory: template.inventory ?? [],
          resources: template.resources ?? starter.resources,
        })
        .returning();
      if (!created) throw new Error("CHARACTER_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character.created",
        entityType: "character",
        entityId: created.id,
        entityRevision: created.revision,
        payload: { characterId: created.id },
      });
      return created;
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(character);
  });

  app.put("/api/characters/:id/controllers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = replaceCharacterControllersSchema.parse(request.body);
    if (
      new Set(body.controllerMembershipIds).size !==
      body.controllerMembershipIds.length
    )
      return reply.code(400).send({ error: "DUPLICATE_CONTROLLERS" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [character] = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.id, id), eq(characters.campaignId, auth.campaignId)),
      )
      .limit(1);
    if (!character)
      return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    const requestedIds = new Set(body.controllerMembershipIds);
    if (character.ownerMembershipId)
      requestedIds.add(character.ownerMembershipId);
    const controllerMembershipIds = [...requestedIds];
    if (controllerMembershipIds.length) {
      const valid = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "PLAYER"),
          ),
        );
      const validIds = new Set(valid.map((member) => member.id));
      if (
        controllerMembershipIds.some(
          (membershipId) => !validIds.has(membershipId),
        )
      )
        return reply.code(400).send({ error: "INVALID_CONTROLLER" });
    }
    const replaced = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(characters)
        .set({ revision: character.revision + 1, updatedAt: new Date() })
        .where(
          and(eq(characters.id, id), eq(characters.revision, body.revision)),
        )
        .returning();
      if (!updated) return null;
      await tx
        .delete(characterControllers)
        .where(eq(characterControllers.characterId, id));
      if (controllerMembershipIds.length)
        await tx.insert(characterControllers).values(
          controllerMembershipIds.map((membershipId) => ({
            characterId: id,
            membershipId,
          })),
        );
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character.controllers_replaced",
        entityType: "character",
        entityId: id,
        entityRevision: updated.revision,
        payload: { controllerMembershipIds },
      });
      return updated;
    });
    if (!replaced)
      return reply.code(409).send({
        error: "CHARACTER_CONFLICT",
        revision: character.revision,
      });
    await broadcastSnapshots(io, db, auth.campaignId);
    return {
      ok: true,
      controllerMembershipIds,
      revision: replaced.revision,
    };
  });

  app.patch("/api/characters/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = characterCommandSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.id, id), eq(characters.campaignId, auth.campaignId)),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    if (!(await canAccessCharacter(db, auth, current)))
      return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    if (body.revision !== undefined && body.revision !== current.revision)
      return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    const { actionId, revision: _revision, ...updates } = body;
    if (
      auth.role !== "GM" &&
      Object.keys(updates).some(
        (key) =>
          ![
            "name",
            "portraitAssetId",
            "stats",
            "backstory",
            "inventory",
            "notes",
            "resources",
          ].includes(key),
      )
    )
      return reply.code(403).send({ error: "CHARACTER_FIELD_FORBIDDEN" });
    if (updates.portraitAssetId) {
      const [portrait] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, updates.portraitAssetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "PORTRAIT"),
          ),
        )
        .limit(1);
      if (!portrait)
        return reply.code(400).send({ error: "INVALID_PORTRAIT_ASSET" });
      if (
        auth.role !== "GM" &&
        portrait.uploadedByMembershipId !== auth.membershipId
      )
        return reply.code(403).send({ error: "PORTRAIT_ASSET_FORBIDDEN" });
    }
    const mergedUpdates = updates.stats
      ? {
          ...updates,
          stats: {
            ...(current.stats as Record<string, number>),
            ...updates.stats,
          },
        }
      : updates;
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(characters)
        .set({
          ...mergedUpdates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(characters.id, id), eq(characters.revision, current.revision)),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "character.updated",
        entityType: "character",
        entityId: next.id,
        entityRevision: next.revision,
        payload: { characterId: next.id },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    if (updated) {
      await broadcastSnapshots(io, db, auth.campaignId);
    }
    return updated;
  });

  /**
   * GM-only roster of archived characters (UIX-393). A dedicated read
   * endpoint rather than folding archived rows into the main snapshot: the
   * snapshot's `characters` array is gameplay-active state broadcast to
   * every connected client (including players), so archived characters are
   * filtered out of it entirely in `buildSnapshot` (see `snapshot.ts`).
   * This list backs the GM-only restore UI in `CharacterWorkspace.tsx`.
   */
  app.get("/api/characters/archived", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const rows = await db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.campaignId, auth.campaignId),
          eq(characters.lifecycle, "ARCHIVED"),
        ),
      )
      .orderBy(desc(characters.archivedAt));
    if (rows.length === 0) return reply.send([]);
    const entryRows = await db
      .select()
      .from(characterCatalogEntries)
      .where(
        inArray(
          characterCatalogEntries.characterId,
          rows.map((row) => row.id),
        ),
      );
    const controllerRows = await db
      .select()
      .from(characterControllers)
      .where(
        inArray(
          characterControllers.characterId,
          rows.map((row) => row.id),
        ),
      );
    const entriesByCharacter = new Map<string, typeof entryRows>();
    for (const entry of entryRows) {
      const list = entriesByCharacter.get(entry.characterId) ?? [];
      list.push(entry);
      entriesByCharacter.set(entry.characterId, list);
    }
    const controllersByCharacter = new Map<string, string[]>();
    for (const controller of controllerRows) {
      const list = controllersByCharacter.get(controller.characterId) ?? [];
      list.push(controller.membershipId);
      controllersByCharacter.set(controller.characterId, list);
    }
    return reply.send(
      rows.map((row) =>
        characterDto(
          row,
          entriesByCharacter.get(row.id) ?? [],
          controllersByCharacter.get(row.id) ?? [],
        ),
      ),
    );
  });

  /**
   * UIX-393: archive a character (soft-delete — never a hard DELETE, so
   * campaign history/audit stays intact and a GM can always restore). GM-only,
   * campaign-scoped, revision/CAS, idempotent `actionId`. Not eligible
   * (missing, wrong campaign, or already ARCHIVED) all collapse to the same
   * 404 so a cross-campaign or already-archived probe cannot distinguish
   * "doesn't exist" from "exists but not archivable" — mirrors
   * `DELETE /api/sticker-packs/:id`.
   *
   * Dependent-reference policy (see also the `characters` table's doc intent
   * and `snapshot.ts`'s filter of ARCHIVED rows out of gameplay projection):
   *  - `character_controllers` (sheet-access grants): deleted. Purely an
   *    access-control join table, not history; access to an archived sheet
   *    is meaningless, and restore does not reinstate it — the GM re-grants
   *    explicitly.
   *  - `token_definitions.character_id` / `tokens.character_id`: detached
   *    (set NULL), the same outcome a hard delete would already produce via
   *    each column's `onDelete: "set null"`. An archived character must not
   *    remain controllable or placed as a live scene token.
   *  - `invites` for this character: any *unclaimed* invite is expired
   *    immediately (`expiresAt` moved to now) so nobody can claim ownership
   *    of an archived character while it is archived; already-claimed
   *    invites are historical and untouched.
   *  - `character_media`, `character_catalog_entries`: left untouched. Both
   *    are per-character sheet content, not scene-live state; they simply
   *    become unreachable while the character is archived (its sheet drops
   *    out of the snapshot) and reappear intact on restore.
   *  - `chat_messages.character_id`, `game_events`/audit rows: never
   *    touched. Chat attribution and audit history must survive archiving
   *    unchanged (AC: "retaining historical references").
   */
  app.post("/api/characters/:id/archive", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = archiveCharacterSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, id),
          eq(characters.campaignId, auth.campaignId),
          eq(characters.lifecycle, "ACTIVE"),
        ),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    const now = new Date();
    const archived = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(characters)
        .set({
          lifecycle: "ARCHIVED",
          archivedAt: now,
          archivedByMembershipId: auth.membershipId,
          revision: current.revision + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(characters.id, id),
            eq(characters.campaignId, auth.campaignId),
            eq(characters.lifecycle, "ACTIVE"),
            eq(characters.revision, current.revision),
          ),
        )
        .returning();
      if (!updated) return null;
      await tx
        .delete(characterControllers)
        .where(eq(characterControllers.characterId, id));
      /**
       * UIX-400: перед отвязкой имя материализуется.
       *
       * Определение без своего имени зовётся как персонаж; убрав ссылку и не
       * записав имя, мы получили бы токен, у которого подписи взяться неоткуда
       * — и `token_definitions_name_check` этого не позволит. Архивация
       * пакетная и без формы, спросить некого, поэтому имя фиксируется молча:
       * это ровно то, что человек видел на карте до архивации.
       */
      await tx
        .update(tokenDefinitions)
        .set({ name: sql`coalesce(${tokenDefinitions.name}, ${updated.name})` })
        .where(
          and(
            eq(tokenDefinitions.characterId, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        );
      await tx
        .update(tokenDefinitions)
        .set({ characterId: null })
        .where(
          and(
            eq(tokenDefinitions.characterId, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        );
      await tx
        .update(tokens)
        .set({ characterId: null })
        .where(eq(tokens.characterId, id));
      await tx
        .update(invites)
        .set({ expiresAt: now })
        .where(
          and(
            eq(invites.characterId, id),
            eq(invites.campaignId, auth.campaignId),
            isNull(invites.claimedAt),
          ),
        );
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character.archived",
        entityType: "character",
        entityId: id,
        entityRevision: updated.revision,
        payload: { characterId: id, from: "ACTIVE", to: "ARCHIVED" },
      });
      return updated;
    });
    if (!archived) return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.send(characterDto(archived, [], []));
  });

  /**
   * UIX-393: restore an archived character back to ACTIVE. GM-only,
   * campaign-scoped, revision/CAS, idempotent `actionId`. Deliberately does
   * NOT reinstate anything the archive transaction detached (character
   * controllers, token/token-definition links, expired invites) — those
   * were live scene/access state at archive time and may no longer be
   * correct; the GM re-establishes them explicitly, the same way a
   * newly-created character starts with none of them either.
   */
  app.post("/api/characters/:id/restore", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = restoreCharacterSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, id),
          eq(characters.campaignId, auth.campaignId),
          eq(characters.lifecycle, "ARCHIVED"),
        ),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    const now = new Date();
    const restored = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(characters)
        .set({
          lifecycle: "ACTIVE",
          archivedAt: null,
          archivedByMembershipId: null,
          revision: current.revision + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(characters.id, id),
            eq(characters.campaignId, auth.campaignId),
            eq(characters.lifecycle, "ARCHIVED"),
            eq(characters.revision, current.revision),
          ),
        )
        .returning();
      if (!updated) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character.restored",
        entityType: "character",
        entityId: id,
        entityRevision: updated.revision,
        payload: { characterId: id, from: "ARCHIVED", to: "ACTIVE" },
      });
      return updated;
    });
    if (!restored) return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    const [entries, controllers] = await Promise.all([
      db
        .select()
        .from(characterCatalogEntries)
        .where(eq(characterCatalogEntries.characterId, id)),
      db
        .select({ membershipId: characterControllers.membershipId })
        .from(characterControllers)
        .where(eq(characterControllers.characterId, id)),
    ]);
    return reply.send(
      characterDto(
        restored,
        entries,
        controllers.map((row) => row.membershipId),
      ),
    );
  });

  app.post("/api/catalog", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const parsedBody = catalogEntryCommandSchema.safeParse(request.body);
    if (!parsedBody.success)
      return reply.code(400).send({ error: "INVALID_CATALOG_ENTRY" });
    const body = parsedBody.data;
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const { actionId, ...input } = body;
    const created = await db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(catalogEntries)
        .values({ campaignId: auth.campaignId, ...input })
        .returning();
      if (!entry) throw new Error("CATALOG_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "catalog.created",
        entityType: "catalog_entry",
        entityId: entry.id,
        entityRevision: 0,
      });
      return entry;
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(created);
  });

  app.patch("/api/catalog/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const parsedBody = catalogEntryCommandSchema
      .partial()
      .extend({
        actionId: actionIdSchema,
        revision: z.number().int().nonnegative().optional(),
      })
      .safeParse(request.body);
    if (!parsedBody.success)
      return reply.code(400).send({ error: "INVALID_CATALOG_ENTRY" });
    const body = parsedBody.data;
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.id, id),
          eq(catalogEntries.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CATALOG_NOT_FOUND" });
    if (body.revision !== undefined && body.revision !== current.revision)
      return reply.code(409).send({ error: "CATALOG_CONFLICT" });
    const { actionId, revision: _revision, ...updates } = body;
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(catalogEntries)
        .set({
          ...updates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogEntries.id, id),
            eq(catalogEntries.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "catalog.updated",
        entityType: "catalog_entry",
        entityId: id,
        entityRevision: next.revision,
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CATALOG_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.delete("/api/catalog/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = revisionCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ ok: true, duplicate: true });
    const [current] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.id, id),
          eq(catalogEntries.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CATALOG_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply.code(409).send({ error: "CATALOG_CONFLICT" });
    let deleted;
    try {
      deleted = await db.transaction(async (tx) => {
        // Assigned entries are snapshots. Removing a template only severs their
        // provenance link; it must never remove or mutate the character copies.
        await tx
          .update(characterCatalogEntries)
          .set({ sourceCatalogEntryId: null })
          .where(eq(characterCatalogEntries.sourceCatalogEntryId, id));
        const [entry] = await tx
          .delete(catalogEntries)
          .where(
            and(
              eq(catalogEntries.id, id),
              eq(catalogEntries.campaignId, auth.campaignId),
              eq(catalogEntries.revision, body.revision),
            ),
          )
          .returning();
        if (!entry) throw new Error("CATALOG_DELETE_CONFLICT");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "catalog.deleted",
          entityType: "catalog_entry",
          entityId: id,
          entityRevision: body.revision,
        });
        return entry;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CATALOG_DELETE_CONFLICT")
        return reply.code(409).send({ error: "CATALOG_CONFLICT" });
      throw error;
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return { ok: true, deleted };
  });

  app.post("/api/characters/:id/catalog", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const characterId = z
      .object({ id: z.string().uuid() })
      .parse(request.params).id;
    const body = assignCatalogEntrySchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [source] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.id, body.catalogEntryId),
          eq(catalogEntries.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    const [character] = await db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!source || !character)
      return reply.code(404).send({ error: "ASSIGNMENT_SOURCE_NOT_FOUND" });
    const [existingAssignment] = await db
      .select({ id: characterCatalogEntries.id })
      .from(characterCatalogEntries)
      .where(
        and(
          eq(characterCatalogEntries.characterId, characterId),
          eq(characterCatalogEntries.sourceCatalogEntryId, source.id),
        ),
      )
      .limit(1);
    if (existingAssignment)
      return reply.code(409).send({ error: "CATALOG_ALREADY_ASSIGNED" });
    let assigned;
    try {
      assigned = await db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(characterCatalogEntries)
          .values({
            characterId,
            sourceCatalogEntryId: source.id,
            kind: source.kind,
            name: source.name,
            description: source.description,
            data: source.data,
          })
          .returning();
        if (!entry) throw new Error("ASSIGNMENT_CREATE_FAILED");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.assigned",
          entityType: "character_catalog_entry",
          entityId: entry.id,
          entityRevision: 0,
        });
        return entry;
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        return reply.code(409).send({ error: "CATALOG_ALREADY_ASSIGNED" });
      throw error;
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(assigned);
  });

  app.patch(
    "/api/characters/:characterId/catalog/:id",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      const params = z
        .object({ characterId: z.string().uuid(), id: z.string().uuid() })
        .parse(request.params);
      const body = characterCatalogEntryCommandSchema
        .extend({ revision: z.number().int().nonnegative().optional() })
        .parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const [current] = await db
        .select({ entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characterCatalogEntries.id, params.id),
            eq(characterCatalogEntries.characterId, params.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!current)
        return reply.code(404).send({ error: "CHARACTER_ENTRY_NOT_FOUND" });
      if (
        body.revision !== undefined &&
        body.revision !== current.entry.revision
      )
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      const { actionId, revision: _revision, ...updates } = body;
      const updated = await db.transaction(async (tx) => {
        const [next] = await tx
          .update(characterCatalogEntries)
          .set({
            ...updates,
            revision: current.entry.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characterCatalogEntries.id, params.id),
              eq(characterCatalogEntries.revision, current.entry.revision),
            ),
          )
          .returning();
        if (!next) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.updated",
          entityType: "character_catalog_entry",
          entityId: next.id,
          entityRevision: next.revision,
        });
        return next;
      });
      if (!updated)
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      await broadcastSnapshots(io, db, auth.campaignId);
      return updated;
    },
  );

  app.delete(
    "/api/characters/:characterId/catalog/:id",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      const params = z
        .object({ characterId: z.string().uuid(), id: z.string().uuid() })
        .parse(request.params);
      const body = revisionCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ ok: true, duplicate: true });
      const [current] = await db
        .select({ entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characterCatalogEntries.id, params.id),
            eq(characterCatalogEntries.characterId, params.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!current)
        return reply.code(404).send({ error: "CHARACTER_ENTRY_NOT_FOUND" });
      if (current.entry.revision !== body.revision)
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      const deleted = await db.transaction(async (tx) => {
        const [entry] = await tx
          .delete(characterCatalogEntries)
          .where(
            and(
              eq(characterCatalogEntries.id, params.id),
              eq(characterCatalogEntries.characterId, params.characterId),
              eq(characterCatalogEntries.revision, body.revision),
            ),
          )
          .returning();
        if (!entry) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.deleted",
          entityType: "character_catalog_entry",
          entityId: params.id,
          entityRevision: body.revision,
          payload: { characterId: params.characterId },
        });
        return entry;
      });
      if (!deleted)
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      await broadcastSnapshots(io, db, auth.campaignId);
      return { ok: true };
    },
  );

  app.post("/api/invites", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createInviteSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    let access;
    try {
      access = await createPlayerAccess(
        db,
        auth.campaignId,
        body.characterId,
        body.label,
        body.actionId,
        auth.membershipId,
      );
    } catch (error) {
      if (errorMessage(error).includes("CHARACTER_NOT_FOUND"))
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
      throw error;
    }
    return reply.code(access.created ? 201 : 200).send({
      grant: playerAccessDto(access.grant, body.characterId),
      created: access.created,
      url: access.token ? `${env.PUBLIC_URL}/join/${access.token}` : null,
    });
  });

  app.get("/api/player-access", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const rows = await db
      .select({ grant: playerAccessGrants, characterId: characters.id })
      .from(playerAccessGrants)
      .leftJoin(
        characters,
        and(
          eq(characters.campaignId, playerAccessGrants.campaignId),
          eq(characters.ownerMembershipId, playerAccessGrants.membershipId),
        ),
      )
      .where(eq(playerAccessGrants.campaignId, auth.campaignId))
      .orderBy(desc(playerAccessGrants.createdAt));
    return rows.map(({ grant, characterId }) =>
      playerAccessDto(grant, characterId),
    );
  });
  app.post("/api/player-access/:id/revoke", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = rotatePlayerAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    const [grant] = await db
      .select()
      .from(playerAccessGrants)
      .where(
        and(
          eq(playerAccessGrants.id, id),
          eq(playerAccessGrants.campaignId, auth.campaignId),
          isNull(playerAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (!grant)
      return reply.code(404).send({ error: "PLAYER_ACCESS_NOT_FOUND" });
    await db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(playerAccessGrants)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(playerAccessGrants.id, grant.id),
            isNull(playerAccessGrants.revokedAt),
            eq(playerAccessGrants.tokenHash, grant.tokenHash),
          ),
        )
        .returning();
      if (!revoked) throw new Error("PLAYER_ACCESS_CONFLICT");
      await tx
        .delete(sessions)
        .where(eq(sessions.membershipId, grant.membershipId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "player_access.revoked",
        entityType: "player_access",
        entityId: grant.id,
      });
    });
    io.in(memberRoom(grant.membershipId)).disconnectSockets(true);
    return { ok: true };
  });

  app.post("/api/player-access/:id/rotate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = rotatePlayerAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    const [grant] = await db
      .select()
      .from(playerAccessGrants)
      .where(
        and(
          eq(playerAccessGrants.id, id),
          eq(playerAccessGrants.campaignId, auth.campaignId),
          isNull(playerAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (!grant)
      return reply.code(404).send({ error: "PLAYER_ACCESS_NOT_FOUND" });
    const token = randomToken();
    await db.transaction(async (tx) => {
      const [rotated] = await tx
        .update(playerAccessGrants)
        .set({ tokenHash: hashToken(token), updatedAt: new Date() })
        .where(
          and(
            eq(playerAccessGrants.id, grant.id),
            isNull(playerAccessGrants.revokedAt),
            eq(playerAccessGrants.tokenHash, grant.tokenHash),
          ),
        )
        .returning();
      if (!rotated) throw new Error("PLAYER_ACCESS_CONFLICT");
      await tx
        .delete(sessions)
        .where(eq(sessions.membershipId, grant.membershipId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "player_access.rotated",
        entityType: "player_access",
        entityId: grant.id,
      });
    });
    io.in(memberRoom(grant.membershipId)).disconnectSockets(true);
    return {
      grant: playerAccessDto(
        { ...grant, tokenHash: hashToken(token), updatedAt: new Date() },
        null,
      ),
      created: false,
      url: `${env.PUBLIC_URL}/join/${token}`,
    };
  });

  app.post("/api/scenes", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createSceneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const replay = duplicate.entityId
        ? await findSceneDto(db, auth.campaignId, duplicate.entityId)
        : null;
      if (replay) return reply.code(200).send(replay);
      return reply.code(409).send({ error: "ACTION_REPLAY_UNAVAILABLE" });
    }
    const mapAsset = body.mapAssetId
      ? (
          await db
            .select({
              id: assets.id,
              kind: assets.kind,
              width: assets.width,
              height: assets.height,
            })
            .from(assets)
            .where(
              and(
                eq(assets.id, body.mapAssetId),
                eq(assets.campaignId, auth.campaignId),
              ),
            )
            .limit(1)
        )[0]
      : null;
    if (body.mapAssetId && !mapAsset)
      return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    if (mapAsset && mapAsset.kind !== "MAP")
      return reply.code(422).send({ error: "MAP_ASSET_REQUIRED" });
    const initialBackground =
      body.backgroundFrame ??
      fitFrameToWorld(
        mapAsset?.width,
        mapAsset?.height,
        body.width,
        body.height,
      );
    const { actionId, backgroundFrame: _backgroundFrame, ...sceneInput } = body;
    const scene = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(scenes)
        .values({
          campaignId: auth.campaignId,
          ...sceneInput,
          mapAssetId: body.mapAssetId ?? null,
          backgroundX: initialBackground.x,
          backgroundY: initialBackground.y,
          backgroundWidth: initialBackground.width,
          backgroundHeight: initialBackground.height,
        })
        .returning();
      if (!created) throw new Error("SCENE_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "scene.created",
        entityType: "scene",
        entityId: created.id,
        payload: { sceneId: created.id },
      });
      return created;
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(sceneDto(scene, null));
  });

  app.patch("/api/scenes/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsedBody = updateSceneMetadataSchema.safeParse(request.body);
    if (!parsedBody.success)
      return reply.code(400).send({
        error: "INVALID_SCENE_METADATA",
        issues: parsedBody.error.issues,
      });
    const body = parsedBody.data;
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const replay = duplicate.entityId
        ? await findSceneDto(db, auth.campaignId, duplicate.entityId)
        : null;
      if (replay) return reply.code(200).send(replay);
      return reply.code(409).send({ error: "ACTION_REPLAY_UNAVAILABLE" });
    }
    const [current] = await db
      .select()
      .from(scenes)
      .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (body.revision !== current.revision)
      return reply.code(409).send({ error: "SCENE_CONFLICT" });
    const { actionId, revision: _revision, ...sceneUpdates } = body;
    if (body.mapAssetId) {
      const [mapAsset] = await db
        .select({ kind: assets.kind })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.mapAssetId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!mapAsset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      if (mapAsset.kind !== "MAP")
        return reply.code(422).send({ error: "MAP_ASSET_REQUIRED" });
    }
    const scene = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(scenes)
        .set({
          ...sceneUpdates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(scenes.id, id), eq(scenes.revision, current.revision)))
        .returning();
      if (!updated) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "scene.updated",
        entityType: "scene",
        entityId: updated.id,
        payload: { sceneId: updated.id },
      });
      return updated;
    });
    if (!scene) return reply.code(409).send({ error: "SCENE_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    const [campaign] = await db
      .select({ activeSceneId: campaigns.activeSceneId })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    return sceneDto(scene, campaign?.activeSceneId ?? null);
  });

  app.post("/api/scenes/activate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = activateSceneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return { ok: true, duplicate: true };
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    await db.transaction(async (tx) => {
      await tx
        .update(campaigns)
        .set({ activeSceneId: scene.id, updatedAt: new Date() })
        .where(eq(campaigns.id, auth.campaignId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "scene.activated",
        entityType: "scene",
        entityId: scene.id,
        payload: { sceneId: scene.id },
      });
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return { ok: true };
  });

  app.post("/api/tokens", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createTokenSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (body.assetId) {
      const [asset] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.assetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      if (!asset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    }
    const [existingDefinition] = body.definitionId
      ? await db
          .select()
          .from(tokenDefinitions)
          .where(
            and(
              eq(tokenDefinitions.id, body.definitionId),
              eq(tokenDefinitions.campaignId, auth.campaignId),
            ),
          )
          .limit(1)
      : [];
    if (body.definitionId && !existingDefinition)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (existingDefinition && body.controllerMembershipIds !== undefined)
      return reply
        .code(400)
        .send({ error: "CONTROLLERS_BELONG_TO_DEFINITION" });
    let tokenOwnerMembershipId = body.ownerMembershipId ?? null;
    let seededControllerMembershipId: string | null = null;
    if (body.characterId) {
      const [character] = await db
        .select({ ownerMembershipId: characters.ownerMembershipId })
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
      tokenOwnerMembershipId = character.ownerMembershipId;
      seededControllerMembershipId = character.ownerMembershipId;
    } else if (tokenOwnerMembershipId) {
      const [owner] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, tokenOwnerMembershipId),
            eq(memberships.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!owner) return reply.code(404).send({ error: "OWNER_NOT_FOUND" });
    }
    const {
      actionId,
      definitionId: _definitionId,
      controllerMembershipIds: explicitControllers,
      ...tokenInput
    } = body;
    let controllerMembershipIds =
      explicitControllers ??
      (seededControllerMembershipId
        ? [seededControllerMembershipId]
        : tokenOwnerMembershipId
          ? [tokenOwnerMembershipId]
          : []);
    if (
      new Set(controllerMembershipIds).size !== controllerMembershipIds.length
    )
      return reply.code(400).send({ error: "DUPLICATE_CONTROLLERS" });
    if (existingDefinition) {
      controllerMembershipIds = (
        await db
          .select({ membershipId: tokenControllers.membershipId })
          .from(tokenControllers)
          .where(eq(tokenControllers.tokenDefinitionId, existingDefinition.id))
      ).map((item) => item.membershipId);
    }
    if (controllerMembershipIds.length) {
      const valid = await db
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.campaignId, auth.campaignId));
      const validIds = new Set(
        valid
          .filter((member) => member.role === "PLAYER")
          .map((member) => member.id),
      );
      if (controllerMembershipIds.some((id) => !validIds.has(id)))
        return reply.code(404).send({ error: "CONTROLLER_NOT_FOUND" });
    }
    // UIX-400: имя обязательно, когда наследовать не от кого.
    if (!body.name && !body.characterId)
      return reply.code(400).send({ error: "TOKEN_NAME_REQUIRED" });
    const placement = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from scenes where id = ${scene.id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [lockedScene] = await tx
        .select({ id: scenes.id })
        .from(scenes)
        .where(
          and(eq(scenes.id, scene.id), eq(scenes.campaignId, auth.campaignId)),
        )
        .limit(1);
      if (!lockedScene) return null;
      // A character's first placement starts through this legacy route before
      // the client has received its linked definition. Serialize that setup on
      // the character so a repeated click cannot create another starter token.
      if (body.characterId) {
        await tx.execute(
          sql`select id from characters where id = ${body.characterId} and campaign_id = ${auth.campaignId} for update`,
        );
        const [existing] = await tx
          .select({ token: tokens })
          .from(tokens)
          .innerJoin(
            tokenDefinitions,
            eq(tokens.definitionId, tokenDefinitions.id),
          )
          .where(
            and(
              eq(tokens.sceneId, scene.id),
              eq(tokenDefinitions.characterId, body.characterId),
              eq(tokens.x, body.x),
              eq(tokens.y, body.y),
            ),
          )
          .limit(1);
        if (existing) return { token: existing.token, created: false };
      }
      await invalidateRedoBranch(tx, auth, scene.id);
      const [definition] = existingDefinition
        ? [existingDefinition]
        : await tx
            .insert(tokenDefinitions)
            .values({
              campaignId: auth.campaignId,
              characterId: body.characterId ?? null,
              defaultAssetId: body.assetId ?? null,
              // UIX-400: без имени определение наследует его от персонажа.
              name: body.name ?? null,
              defaultWidth: body.width,
              defaultHeight: body.height,
            })
            .returning();
      if (!definition) throw new Error("TOKEN_DEFINITION_CREATE_FAILED");
      if (!existingDefinition && controllerMembershipIds.length)
        await tx.insert(tokenControllers).values(
          controllerMembershipIds.map((membershipId) => ({
            tokenDefinitionId: definition.id,
            membershipId,
          })),
        );
      const [created] = await tx
        .insert(tokens)
        .values({
          ...tokenInput,
          // UIX-400: `tokens.name` только пишется и никогда не читается —
          // подпись всегда берётся из определения. Колонка `notNull`, поэтому
          // отсутствующее имя записывается пустой строкой, а не NULL.
          name: tokenInput.name ?? "",
          definitionId: definition.id,
          characterId: definition.characterId,
          ownerMembershipId: tokenOwnerMembershipId,
          assetId: definition.defaultAssetId,
        })
        .returning();
      if (!created) throw new Error("TOKEN_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "token.created",
        entityType: "token",
        entityId: created.id,
        entityRevision: created.revision,
        payload: { tokenId: created.id },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: created.sceneId,
        actorMembershipId: auth.membershipId,
        actionId,
        scope: created.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_CREATE",
        targetType: "TOKEN",
        targetId: created.id,
        before: null,
        after: created,
        afterRevision: created.revision,
        currentRevision: created.revision,
      });
      return {
        token: {
          ...created,
          definitionId: definition.id,
          controllerMembershipIds,
        },
        created: true,
      };
    });
    if (!placement) return reply.code(409).send({ error: "SCENE_CONFLICT" });
    if (placement.created) await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(placement.created ? 201 : 200).send(placement.token);
  });

  app.post("/api/token-definitions", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createTokenDefinitionSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate?.entityId) {
      const [existing] = await db
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, duplicate.entityId),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (existing) return reply.code(200).send(existing);
    }
    if (body.defaultAssetId) {
      const [asset] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.defaultAssetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      if (!asset)
        return reply.code(404).send({ error: "TOKEN_ASSET_NOT_FOUND" });
    }
    if (body.characterId) {
      const [character] = await db
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    }
    const controllerIds = [...new Set(body.controllerMembershipIds)];
    if (controllerIds.length) {
      const controllers = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "PLAYER"),
            inArray(memberships.id, controllerIds),
          ),
        );
      if (controllers.length !== controllerIds.length)
        return reply.code(404).send({ error: "CONTROLLER_NOT_FOUND" });
    }
    const created = await db.transaction(async (tx) => {
      const [definition] = await tx
        .insert(tokenDefinitions)
        .values({
          campaignId: auth.campaignId,
          name: body.name,
          characterId: body.characterId,
          defaultAssetId: body.defaultAssetId,
          defaultWidth: body.defaultWidth,
          defaultHeight: body.defaultHeight,
        })
        .returning();
      if (!definition) throw new Error("TOKEN_DEFINITION_CREATE_FAILED");
      if (controllerIds.length)
        await tx.insert(tokenControllers).values(
          controllerIds.map((membershipId) => ({
            tokenDefinitionId: definition.id,
            membershipId,
          })),
        );
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token_definition.created",
        entityType: "token_definition",
        entityId: definition.id,
        entityRevision: definition.revision,
      });
      return { ...definition, controllerMembershipIds: controllerIds };
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(created);
  });

  app.post("/api/token-definitions/:id/placements", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = placeTokenDefinitionSchema.parse({
      ...(request.body as Record<string, unknown>),
      definitionId: id,
    });
    const priorAction = await findAction(db, auth.campaignId, body.actionId);
    if (priorAction) {
      if (priorAction.entityType === "token" && priorAction.entityId) {
        const [priorPlacement] = await db
          .select({ token: tokens })
          .from(tokens)
          .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
          .innerJoin(
            tokenDefinitions,
            eq(tokens.definitionId, tokenDefinitions.id),
          )
          .where(
            and(
              eq(tokens.id, priorAction.entityId),
              eq(tokens.definitionId, id),
              eq(scenes.campaignId, auth.campaignId),
              eq(tokenDefinitions.campaignId, auth.campaignId),
            ),
          )
          .limit(1);
        if (priorPlacement) return reply.code(200).send(priorPlacement.token);
      }
      const [definition] = await db
        .select({ id: tokenDefinitions.id })
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!definition)
        return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
      return reply.code(200).send({ duplicate: true });
    }
    const [campaign] = await db
      .select({ activeSceneId: campaigns.activeSceneId })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    const requestedSceneId = body.sceneId ?? campaign?.activeSceneId;
    if (!requestedSceneId)
      return reply.code(409).send({ error: "ACTIVE_SCENE_REQUIRED" });
    if (auth.role !== "GM" && requestedSceneId !== campaign?.activeSceneId)
      return reply.code(403).send({ error: "INACTIVE_SCENE_FORBIDDEN" });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, requestedSceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    const [definition] = await db
      .select()
      .from(tokenDefinitions)
      .where(
        and(
          eq(tokenDefinitions.id, id),
          eq(tokenDefinitions.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene || !definition)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    const controllers = await db
      .select({ membershipId: tokenControllers.membershipId })
      .from(tokenControllers)
      .where(eq(tokenControllers.tokenDefinitionId, definition.id));
    if (
      auth.role !== "GM" &&
      !controllers.some((item) => item.membershipId === auth.membershipId)
    )
      return reply.code(403).send({ error: "TOKEN_DEFINITION_FORBIDDEN" });
    const placement = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from scenes where id = ${scene.id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [lockedScene] = await tx
        .select()
        .from(scenes)
        .where(
          and(eq(scenes.id, scene.id), eq(scenes.campaignId, auth.campaignId)),
        )
        .limit(1);
      if (!lockedScene) return null;
      await tx.execute(
        sql`select id from token_definitions where id = ${definition.id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [lockedDefinition] = await tx
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, definition.id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!lockedDefinition) return null;
      const snapX = (value: number) =>
        lockedScene.grid.enabled
          ? Math.round(
              (value - lockedScene.grid.offsetX) / lockedScene.grid.size,
            ) *
              lockedScene.grid.size +
            lockedScene.grid.offsetX
          : value;
      const snapY = (value: number) =>
        lockedScene.grid.enabled
          ? Math.round(
              (value - lockedScene.grid.offsetY) / lockedScene.grid.size,
            ) *
              lockedScene.grid.size +
            lockedScene.grid.offsetY
          : value;
      const x = snapX(
        body.x ?? lockedScene.width / 2 - lockedDefinition.defaultWidth / 2,
      );
      const y = snapY(
        body.y ?? lockedScene.height / 2 - lockedDefinition.defaultHeight / 2,
      );
      if (lockedDefinition.characterId) {
        const [existing] = await tx
          .select()
          .from(tokens)
          .where(
            and(
              eq(tokens.definitionId, lockedDefinition.id),
              eq(tokens.sceneId, scene.id),
              eq(tokens.x, x),
              eq(tokens.y, y),
            ),
          )
          .limit(1);
        if (existing) return { token: existing, created: false };
      }
      await invalidateRedoBranch(tx, auth, scene.id);
      const [created] = await tx
        .insert(tokens)
        .values({
          definitionId: lockedDefinition.id,
          sceneId: scene.id,
          characterId: lockedDefinition.characterId,
          assetId: lockedDefinition.defaultAssetId,
          // UIX-400: `tokens.name` только пишется и никогда не читается —
          // подпись всегда берётся из определения. Значение здесь остаётся
          // историческим следом, поэтому пустое имя определения замещается
          // разрешённым, а не пишется как NULL в notNull-колонку.
          name: lockedDefinition.name ?? "",
          x,
          y,
          width: lockedDefinition.defaultWidth,
          height: lockedDefinition.defaultHeight,
          layer: "PLAYER",
        })
        .returning();
      if (!created) throw new Error("TOKEN_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token.placed",
        entityType: "token",
        entityId: created.id,
        entityRevision: created.revision,
        payload: { definitionId: definition.id, sceneId: scene.id },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: scene.id,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "TOKEN_CREATE",
        targetType: "TOKEN",
        targetId: created.id,
        before: null,
        after: created,
        afterRevision: created.revision,
        currentRevision: created.revision,
      });
      return { token: created, created: true };
    });
    if (!placement)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_DELETED" });
    if (placement.created) await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(placement.created ? 201 : 200).send(placement.token);
  });

  app.patch("/api/tokens/:id/size", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = resizeTokenSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ token: tokens })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "STALE_REVISION" });
    // The client only exposes a proportional handle, but the server remains
    // authoritative so an older or malicious client cannot distort a token.
    const widthScale = body.width / row.token.width;
    const heightScale = body.height / row.token.height;
    const scale =
      Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
    const boundedScale = Math.min(
      Math.min(1024 / row.token.width, 1024 / row.token.height),
      Math.max(Math.max(16 / row.token.width, 16 / row.token.height), scale),
    );
    const width = Math.round(row.token.width * boundedScale);
    const height = Math.round(row.token.height * boundedScale);
    const updated = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [saved] = await tx
        .update(tokens)
        .set({
          width,
          height,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!saved) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "TOKEN_RESIZED",
        entityType: "TOKEN",
        entityId: id,
        entityRevision: saved.revision,
        payload: { width: saved.width, height: saved.height },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: saved.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: saved.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_RESIZE",
        targetType: "TOKEN",
        targetId: id,
        before: { width: row.token.width, height: row.token.height },
        after: { width: saved.width, height: saved.height },
        beforeRevision: row.token.revision,
        afterRevision: saved.revision,
        currentRevision: saved.revision,
      });
      return saved;
    });
    if (!updated) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.patch("/api/tokens/:id/appearance", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = tokenAppearanceSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ token: tokens })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "STALE_REVISION" });
    const updated = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [saved] = await tx
        .update(tokens)
        .set({
          baseColor: body.baseColor,
          frameColor: body.frameColor,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!saved) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "TOKEN_APPEARANCE_UPDATED",
        entityType: "TOKEN",
        entityId: id,
        entityRevision: saved.revision,
        payload: { baseColor: saved.baseColor, frameColor: saved.frameColor },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: saved.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: saved.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_APPEARANCE",
        targetType: "TOKEN",
        targetId: id,
        before: {
          baseColor: row.token.baseColor,
          frameColor: row.token.frameColor,
        },
        after: { baseColor: saved.baseColor, frameColor: saved.frameColor },
        beforeRevision: row.token.revision,
        afterRevision: saved.revision,
        currentRevision: saved.revision,
      });
      return saved;
    });
    if (!updated) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  /**
   * UIX-471 — состояния фигуры: отравлен, без сознания, обездвижен, распластан.
   *
   * Правит мастер, а также тот, кто ведёт эту фигуру: состояния меняются каждый
   * ход, и гонять их через мастера значило бы повторить историю с бросками
   * инициативы, где посредник был самым частым узким местом (UIX-466).
   *
   * Набор нормализуется схемой: порядок значков не должен зависеть от порядка
   * нажатий, а повторы — множить одну и ту же иконку.
   */
  app.patch("/api/tokens/:id/conditions", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = updateTokenConditionsSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ token: tokens, definitionId: tokens.definitionId })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (auth.role !== "GM") {
      /**
       * Игроку — только своя фигура, и только та, что он и так видит. Скрытая
       * или лежащая на слое мастера не должна выдавать себя даже отказом,
       * отличным от «нет такой»: это тот же запрет, что в UIX-449.
       */
      if (!row.token.visible || row.token.layer === "GM")
        return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
      const [controlled] = await db
        .select({ membershipId: tokenControllers.membershipId })
        .from(tokenControllers)
        .where(
          and(
            eq(tokenControllers.tokenDefinitionId, row.definitionId),
            eq(tokenControllers.membershipId, auth.membershipId),
          ),
        )
        .limit(1);
      if (!controlled)
        return reply.code(403).send({ error: "TOKEN_FORBIDDEN" });
    }
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "STALE_REVISION" });
    const updated = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [saved] = await tx
        .update(tokens)
        .set({
          conditions: body.conditions,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!saved) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "TOKEN_CONDITIONS_UPDATED",
        entityType: "TOKEN",
        entityId: id,
        entityRevision: saved.revision,
        payload: { conditions: saved.conditions },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: saved.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: saved.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_CONDITIONS",
        targetType: "TOKEN",
        targetId: id,
        before: { conditions: row.token.conditions },
        after: { conditions: saved.conditions },
        beforeRevision: row.token.revision,
        afterRevision: saved.revision,
        currentRevision: saved.revision,
      });
      return saved;
    });
    if (!updated) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.delete("/api/tokens/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = deleteTokenSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ ok: true, duplicate: true });
    const [row] = await db
      .select({
        token: tokens,
        definition: tokenDefinitions,
        campaignId: scenes.campaignId,
        activeSceneId: campaigns.activeSceneId,
      })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .innerJoin(campaigns, eq(scenes.campaignId, campaigns.id))
      .innerJoin(tokenDefinitions, eq(tokens.definitionId, tokenDefinitions.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row || row.definition.campaignId !== auth.campaignId)
      return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "STALE_REVISION" });
    if (auth.role !== "GM") {
      const [controller] = await db
        .select()
        .from(tokenControllers)
        .where(
          and(
            eq(tokenControllers.tokenDefinitionId, row.definition.id),
            eq(tokenControllers.membershipId, auth.membershipId),
          ),
        )
        .limit(1);
      if (
        !controller ||
        row.token.locked ||
        !row.token.visible ||
        row.token.layer === "GM" ||
        row.token.sceneId !== row.activeSceneId
      )
        return reply.code(403).send({ error: "TOKEN_FORBIDDEN" });
    }
    const deleted = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [placement] = await tx
        .delete(tokens)
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!placement) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "TOKEN_DELETED",
        entityType: "TOKEN",
        entityId: id,
        entityRevision: body.revision,
        payload: {
          definitionId: row.definition.id,
          sceneId: placement.sceneId,
        },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: placement.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: placement.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_DELETE",
        targetType: "TOKEN",
        targetId: placement.id,
        before: placement,
        after: null,
        beforeRevision: placement.revision,
        currentRevision: placement.revision,
      });
      return placement;
    });
    if (!deleted) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return { ok: true };
  });

  app.put("/api/token-definitions/:id/controllers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = replaceTokenControllersSchema.parse(request.body);
    if (
      new Set(body.controllerMembershipIds).size !==
      body.controllerMembershipIds.length
    )
      return reply.code(400).send({ error: "DUPLICATE_CONTROLLERS" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [definition] = await db
      .select()
      .from(tokenDefinitions)
      .where(
        and(
          eq(tokenDefinitions.id, id),
          eq(tokenDefinitions.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!definition)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (body.controllerMembershipIds.length) {
      const valid = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "PLAYER"),
          ),
        );
      const ids = new Set(valid.map((item) => item.id));
      if (
        body.controllerMembershipIds.some(
          (membershipId) => !ids.has(membershipId),
        )
      )
        return reply.code(400).send({ error: "INVALID_CONTROLLER" });
    }
    const replaced = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(tokenDefinitions)
        .set({ revision: definition.revision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.revision, body.revision),
          ),
        )
        .returning();
      if (!updated) return null;
      await tx
        .delete(tokenControllers)
        .where(eq(tokenControllers.tokenDefinitionId, id));
      if (body.controllerMembershipIds.length)
        await tx.insert(tokenControllers).values(
          body.controllerMembershipIds.map((membershipId) => ({
            tokenDefinitionId: id,
            membershipId,
          })),
        );
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token.controllers_replaced",
        entityType: "token_definition",
        entityId: id,
        payload: { controllerMembershipIds: body.controllerMembershipIds },
      });
      return updated;
    });
    if (!replaced) {
      const [latest] = await db
        .select({ revision: tokenDefinitions.revision })
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      return reply.code(409).send({
        error: "TOKEN_DEFINITION_CONFLICT",
        revision: latest?.revision ?? null,
      });
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return {
      ok: true,
      controllerMembershipIds: body.controllerMembershipIds,
      revision: replaced.revision,
    };
  });

  app.patch("/api/token-definitions/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = tokenDefinitionUpdateSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(tokenDefinitions)
      .where(
        and(
          eq(tokenDefinitions.id, id),
          eq(tokenDefinitions.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_CONFLICT" });
    /**
     * UIX-400: определение без имени и без персонажа наследовать не от кого.
     *
     * Здесь, в отличие от архивации, отвечаем отказом, а не подставляем имя
     * молча: это диалог, мастер на месте, и «сохранили какое-то имя» хуже
     * явного «введите имя». Проверяется состояние **после** патча, иначе
     * снятие персонажа и снятие имени по отдельности прошли бы обе.
     */
    const nextName = body.name === undefined ? current.name : body.name;
    const nextCharacterId =
      body.characterId === undefined ? current.characterId : body.characterId;
    if (!nextName && !nextCharacterId)
      return reply.code(400).send({ error: "TOKEN_NAME_REQUIRED" });
    if (auth.role !== "GM") {
      if (body.defaultWidth !== undefined || body.defaultHeight !== undefined)
        return reply.code(403).send({ error: "TOKEN_SIZE_FORBIDDEN" });
      const [controller] = await db
        .select()
        .from(tokenControllers)
        .where(
          and(
            eq(tokenControllers.tokenDefinitionId, id),
            eq(tokenControllers.membershipId, auth.membershipId),
          ),
        )
        .limit(1);
      if (!controller)
        return reply.code(403).send({ error: "TOKEN_DEFINITION_FORBIDDEN" });
    }
    if (body.defaultAssetId) {
      const [asset] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, body.defaultAssetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      if (
        !asset ||
        (auth.role !== "GM" &&
          asset.uploadedByMembershipId !== auth.membershipId)
      )
        return reply.code(404).send({ error: "TOKEN_ASSET_NOT_FOUND" });
    }
    if (body.characterId) {
      const [character] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character || !(await canAccessCharacter(db, auth, character)))
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    }
    const { actionId, revision: _revision, ...changes } = body;
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(tokenDefinitions)
        .set({
          ...changes,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      if (body.defaultAssetId !== undefined) {
        // Размещённый токен хранит снимок изображения определения. Меняем
        // только экземпляры этого definition в той же транзакции: общий asset
        // может использоваться другими определениями и не должен
        // перезаписываться вместе с одним токеном.
        await tx
          .update(tokens)
          .set({ assetId: body.defaultAssetId, updatedAt: new Date() })
          .where(eq(tokens.definitionId, id));
      }
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "token_definition.updated",
        entityType: "token_definition",
        entityId: id,
        entityRevision: next.revision,
      });
      return next;
    });
    if (!updated)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  app.delete("/api/token-definitions/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = revisionCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from token_definitions where id = ${id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [current] = await tx
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!current) return { outcome: "missing" as const };
      if (current.revision !== body.revision)
        return { outcome: "conflict" as const };
      await tx.execute(
        sql`select id from tokens where definition_id = ${id} for update`,
      );
      const placementRows = await tx
        .select({ id: tokens.id, sceneId: tokens.sceneId })
        .from(tokens)
        .where(eq(tokens.definitionId, id));
      const sceneIds = [...new Set(placementRows.map((row) => row.sceneId))];
      const dependentJournalRows = await tx
        .select({ targetId: actionJournal.targetId })
        .from(actionJournal)
        .where(
          and(
            eq(actionJournal.campaignId, auth.campaignId),
            eq(actionJournal.targetType, "TOKEN"),
            sql`(${actionJournal.before}->>'definitionId' = ${id} or ${actionJournal.after}->>'definitionId' = ${id})`,
          ),
        );
      const affectedTokenIds = [
        ...new Set([
          ...placementRows.map((row) => row.id),
          ...dependentJournalRows.map((row) => row.targetId),
        ]),
      ];
      if (affectedTokenIds.length)
        await tx
          .update(actionJournal)
          .set({
            status: "INVALIDATED",
            transitionSequence: sql`nextval(pg_get_serial_sequence('action_journal', 'transition_sequence'))`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(actionJournal.campaignId, auth.campaignId),
              eq(actionJournal.targetType, "TOKEN"),
              inArray(actionJournal.targetId, affectedTokenIds),
              sql`${actionJournal.status} in ('APPLIED', 'UNDONE')`,
            ),
          );
      const [deleted] = await tx
        .delete(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.revision, current.revision),
          ),
        )
        .returning();
      if (!deleted) throw new Error("TOKEN_DEFINITION_CONFLICT");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token_definition.deleted",
        entityType: "token_definition",
        entityId: id,
        entityRevision: current.revision,
        payload: {
          placementsRemoved: placementRows.length,
          sceneIds,
          undoable: false,
          reason: "destructive definition deletion cascades placements",
        },
      });
      return {
        outcome: "deleted" as const,
        placementsRemoved: placementRows.length,
        sceneIds,
      };
    });
    if (result.outcome === "missing")
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (result.outcome === "conflict")
      return reply.code(409).send({ error: "TOKEN_DEFINITION_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(204).send();
  });

  app.post("/api/fog-reveals", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createFogRevealSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const legacy = !body.geometry;
    const requestedGeometry = body.geometry ?? {
      type: "RECT" as const,
      x: body.x!,
      y: body.y!,
      width: body.width!,
      height: body.height!,
    };
    let canonical;
    try {
      canonical = canonicalizeFogGeometry(requestedGeometry, scene, legacy);
    } catch (error) {
      if (error instanceof FogGeometryError)
        return reply.code(422).send({ error: error.code });
      throw error;
    }
    const { actionId } = body;
    const revealInput = {
      sceneId: scene.id,
      operation: body.operation,
      shape: canonical.geometry.type,
      geometry: canonical.geometry,
      bbox: canonical.bbox,
      x: canonical.bbox.x,
      y: canonical.bbox.y,
      width: canonical.bbox.width,
      height: canonical.bbox.height,
    };
    const result = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, scene.id);
      const [reveal] = await tx
        .insert(fogReveals)
        .values(revealInput)
        .returning();
      if (!reveal) throw new Error("FOG_CREATE_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "fog.created",
          entityType: "fog",
          entityId: reveal.id,
          payload: reveal,
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: scene.id,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "FOG_CREATE",
        targetType: "FOG",
        targetId: reveal.id,
        before: null,
        after: reveal,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { reveal, event };
    });
    const { reveal, event } = result;
    if (reveal) {
      /**
       * UIX-408: событие уходит только тем, у кого эта сцена в снапшоте.
       *
       * Раньше оно летело всей кампании, а лишнее отсеивалось на клиенте при
       * отрисовке. После сужения выборки это перестало быть безобидным:
       * клиент пришивает пришедший туман к `snapshot.fogReveals` без проверки
       * сцены, и накопленное пережило бы любое число рассылок — инвариант «в
       * снапшоте туман только видимых сцен» ломался бы прямо на проводе.
       */
      const envelope = {
        sequence: Number(event.sequence),
        actionId,
        emittedAt: event.createdAt.toISOString(),
        data: reveal,
      };
      const [current] = await db
        .select({ activeSceneId: campaigns.activeSceneId })
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      for (const socket of await io
        .in(campaignRoom(auth.campaignId))
        .fetchSockets())
        if (
          current &&
          canvasSceneVisibleTo(socket.data, current, reveal.sceneId)
        )
          socket.emit("fog:created", envelope);
    }
    return reply.code(201).send(reveal);
  });

  app.delete("/api/fog-reveals/latest", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    return reply.code(410).send({
      error: "LEGACY_FOG_UNDO_REMOVED",
      replacement: "/api/canvas/undo",
    });
  });

  app.patch("/api/tokens/:id/layer", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = changeTokenLayerSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ token: tokens })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    const saved = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [updated] = await tx
        .update(tokens)
        .set({
          layer: body.layer,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, row.token.revision)))
        .returning();
      if (!updated) return null;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "token.layer",
          entityType: "token",
          entityId: id,
          entityRevision: updated.revision,
          payload: updated,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: updated.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope:
          updated.layer === "GM" || row.token.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_LAYER",
        targetType: "TOKEN",
        targetId: id,
        before: { layer: row.token.layer },
        after: { layer: updated.layer },
        beforeRevision: row.token.revision,
        afterRevision: updated.revision,
        currentRevision: updated.revision,
      });
      return { updated, event };
    });
    if (!saved) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return saved.updated;
  });

  app.post("/api/drawings", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createDrawingSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const { actionId, ...input } = body;
    const saved = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, scene.id);
      const [drawing] = await tx
        .insert(drawings)
        .values({ ...input, authorMembershipId: auth.membershipId })
        .returning();
      if (!drawing) throw new Error("DRAWING_CREATE_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "drawing.created",
          entityType: "drawing",
          entityId: drawing.id,
          entityRevision: 0,
          payload: drawing,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: scene.id,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "DRAWING_CREATE",
        targetType: "DRAWING",
        targetId: drawing.id,
        before: null,
        after: drawing,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { drawing, event };
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(saved.drawing);
  });

  app.patch("/api/drawings/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = updateDrawingSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(and(eq(drawings.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (
      !row ||
      (auth.role !== "GM" &&
        row.drawing.authorMembershipId !== auth.membershipId)
    )
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    if (row.drawing.revision !== body.revision)
      return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    const { actionId, revision: _revision, ...changes } = body;
    const saved = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [updated] = await tx
        .update(drawings)
        .set({
          ...changes,
          revision: row.drawing.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(drawings.id, id), eq(drawings.revision, row.drawing.revision)),
        )
        .returning();
      if (!updated) return null;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "drawing.updated",
          entityType: "drawing",
          entityId: id,
          entityRevision: updated.revision,
          payload: updated,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: updated.sceneId,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "DRAWING_UPDATE",
        targetType: "DRAWING",
        targetId: id,
        before: row.drawing,
        after: updated,
        beforeRevision: row.drawing.revision,
        afterRevision: updated.revision,
        currentRevision: updated.revision,
      });
      return { updated, event };
    });
    if (!saved) return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return saved.updated;
  });

  app.post("/api/drawings/:id/copy", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = drawingCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(and(eq(drawings.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (
      !row ||
      (auth.role !== "GM" &&
        row.drawing.authorMembershipId !== auth.membershipId)
    )
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    if (row.drawing.revision !== body.revision)
      return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    const saved = await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [copy] = await tx
        .insert(drawings)
        .values({
          sceneId: row.drawing.sceneId,
          authorMembershipId: auth.membershipId,
          points: row.drawing.points,
          color: row.drawing.color,
          strokeWidth: row.drawing.strokeWidth,
          x: row.drawing.x + 16,
          y: row.drawing.y + 16,
        })
        .returning();
      if (!copy) throw new Error("DRAWING_COPY_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "drawing.copied",
          entityType: "drawing",
          entityId: copy.id,
          entityRevision: 0,
          payload: copy,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: copy.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "DRAWING_CREATE",
        targetType: "DRAWING",
        targetId: copy.id,
        before: null,
        after: copy,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { copy, event };
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(saved.copy);
  });

  app.delete("/api/drawings/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = drawingCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ drawing: drawings })
      .from(drawings)
      .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
      .where(and(eq(drawings.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (
      !row ||
      (auth.role !== "GM" &&
        row.drawing.authorMembershipId !== auth.membershipId)
    )
      return reply.code(403).send({ error: "DRAWING_FORBIDDEN" });
    if (row.drawing.revision !== body.revision)
      return reply.code(409).send({ error: "DRAWING_CONFLICT" });
    await db.transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.drawing.sceneId);
      const [deleted] = await tx
        .delete(drawings)
        .where(
          and(eq(drawings.id, id), eq(drawings.revision, row.drawing.revision)),
        )
        .returning();
      if (!deleted) throw new Error("DRAWING_CONFLICT");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "drawing.deleted",
        entityType: "drawing",
        entityId: id,
        entityRevision: row.drawing.revision,
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: row.drawing.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "DRAWING_DELETE",
        targetType: "DRAWING",
        targetId: id,
        before: row.drawing,
        after: null,
        beforeRevision: row.drawing.revision,
        currentRevision: row.drawing.revision,
      });
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(204).send();
  });

  app.post("/api/canvas/bulk", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = canvasBulkCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    if (
      new Set(
        body.targets.map((target) => `${target.targetType}:${target.targetId}`),
      ).size !== body.targets.length
    )
      return reply.code(422).send({ error: "DUPLICATE_BULK_TARGET" });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const tokenIds = body.targets
      .filter((target) => target.targetType === "TOKEN")
      .map((target) => target.targetId);
    const drawingIds = body.targets
      .filter((target) => target.targetType === "DRAWING")
      .map((target) => target.targetId);
    const tokenRows = tokenIds.length
      ? await db
          .select()
          .from(tokens)
          .where(
            and(inArray(tokens.id, tokenIds), eq(tokens.sceneId, scene.id)),
          )
      : [];
    const drawingRows = drawingIds.length
      ? await db
          .select()
          .from(drawings)
          .where(
            and(
              inArray(drawings.id, drawingIds),
              eq(drawings.sceneId, scene.id),
            ),
          )
      : [];
    if (
      tokenRows.length !== tokenIds.length ||
      drawingRows.length !== drawingIds.length
    )
      return reply.code(404).send({ error: "CANVAS_TARGET_NOT_FOUND" });
    const requested = new Map(
      body.targets.map((target) => [
        `${target.targetType}:${target.targetId}`,
        target,
      ]),
    );
    if (
      [
        ...tokenRows.map((row) => ["TOKEN", row] as const),
        ...drawingRows.map((row) => ["DRAWING", row] as const),
      ].some(
        ([kind, row]) =>
          requested.get(`${kind}:${row.id}`)?.revision !== row.revision,
      )
    )
      return reply.code(409).send({ error: "STALE_REVISION" });
    if (auth.role !== "GM") {
      const controlled = tokenIds.length
        ? await db
            .select({ tokenDefinitionId: tokenControllers.tokenDefinitionId })
            .from(tokenControllers)
            .where(
              and(
                inArray(
                  tokenControllers.tokenDefinitionId,
                  tokenRows.map((row) => row.definitionId),
                ),
                eq(tokenControllers.membershipId, auth.membershipId),
              ),
            )
        : [];
      const controlledIds = new Set(
        controlled.map((row) => row.tokenDefinitionId),
      );
      if (
        tokenRows.some(
          (row) =>
            !controlledIds.has(row.definitionId) ||
            row.locked ||
            !row.visible ||
            row.layer === "GM",
        ) ||
        drawingRows.some((row) => row.authorMembershipId !== auth.membershipId)
      )
        return reply.code(403).send({ error: "CANVAS_TARGET_FORBIDDEN" });
    }
    const result = await db
      .transaction(async (tx) => {
        await invalidateRedoBranch(tx, auth, scene.id);
        const afterTokens: (typeof tokens.$inferSelect)[] = [];
        const afterDrawings: (typeof drawings.$inferSelect)[] = [];
        for (const row of tokenRows) {
          if (body.operation === "DELETE") {
            const [deleted] = await tx
              .delete(tokens)
              .where(
                and(eq(tokens.id, row.id), eq(tokens.revision, row.revision)),
              )
              .returning();
            if (!deleted) throw new Error("BULK_CONFLICT");
          } else {
            const [updated] = await tx
              .update(tokens)
              .set({
                x: row.x + body.deltaX,
                y: row.y + body.deltaY,
                revision: row.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(eq(tokens.id, row.id), eq(tokens.revision, row.revision)),
              )
              .returning();
            if (!updated) throw new Error("BULK_CONFLICT");
            afterTokens.push(updated);
          }
        }
        for (const row of drawingRows) {
          if (body.operation === "DELETE") {
            const [deleted] = await tx
              .delete(drawings)
              .where(
                and(
                  eq(drawings.id, row.id),
                  eq(drawings.revision, row.revision),
                ),
              )
              .returning();
            if (!deleted) throw new Error("BULK_CONFLICT");
          } else {
            const [updated] = await tx
              .update(drawings)
              .set({
                x: row.x + body.deltaX,
                y: row.y + body.deltaY,
                revision: row.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(drawings.id, row.id),
                  eq(drawings.revision, row.revision),
                ),
              )
              .returning();
            if (!updated) throw new Error("BULK_CONFLICT");
            afterDrawings.push(updated);
          }
        }
        const targetRevisions = {
          tokens: Object.fromEntries(
            tokenRows.map((row) => [row.id, row.revision]),
          ),
          drawings: Object.fromEntries(
            drawingRows.map((row) => [row.id, row.revision]),
          ),
        };
        const before = {
          tokens: tokenRows,
          drawings: drawingRows,
          revisions: targetRevisions,
        };
        const after =
          body.operation === "DELETE"
            ? {
                tokens: [],
                drawings: [],
                revisions: targetRevisions,
              }
            : {
                tokens: afterTokens,
                drawings: afterDrawings,
                revisions: {
                  tokens: Object.fromEntries(
                    afterTokens.map((row) => [row.id, row.revision]),
                  ),
                  drawings: Object.fromEntries(
                    afterDrawings.map((row) => [row.id, row.revision]),
                  ),
                },
              };
        await tx.insert(actionJournal).values({
          campaignId: auth.campaignId,
          sceneId: scene.id,
          actorMembershipId: auth.membershipId,
          actionId: body.actionId,
          type: `CANVAS_BULK_${body.operation}`,
          targetType: "CANVAS_BULK",
          targetId: body.actionId,
          before,
          after,
          currentRevision: 0,
          scope: tokenRows.some((row) => row.layer === "GM") ? "GM" : "PUBLIC",
        });
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: `canvas.bulk.${body.operation.toLowerCase()}`,
          entityType: "canvas_bulk",
          entityId: body.actionId,
          payload: { sceneId: scene.id, targets: body.targets },
        });
        return after;
      })
      .catch((error: unknown) =>
        error instanceof Error && error.message === "BULK_CONFLICT"
          ? null
          : Promise.reject(error),
      );
    if (!result) return reply.code(409).send({ error: "CANVAS_BULK_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return { ok: true, ...result };
  });

  app.get("/api/canvas/history", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = z.object({ sceneId: z.string().uuid() }).parse(request.query);
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(
        and(
          eq(scenes.id, query.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const historyColumns = {
      sequence: actionJournal.sequence,
      actorMembershipId: actionJournal.actorMembershipId,
      type: actionJournal.type,
      targetType: actionJournal.targetType,
      targetId: actionJournal.targetId,
      status: actionJournal.status,
      createdAt: actionJournal.createdAt,
    };
    const visibleHistory = and(
      eq(actionJournal.campaignId, auth.campaignId),
      eq(actionJournal.sceneId, scene.id),
      auth.role === "GM"
        ? undefined
        : and(
            eq(actionJournal.actorMembershipId, auth.membershipId),
            eq(actionJournal.scope, "PUBLIC"),
          ),
    );
    const rows = await db
      .select(historyColumns)
      .from(actionJournal)
      .where(visibleHistory)
      // UIX-503: это не лента создания записей, а проекция текущего стека
      // Undo/Redo. Команды ниже выбирают кандидата по transitionSequence;
      // если здесь сортировать по исходному sequence, после двух Undo клиент
      // назовёт одно действие, а сервер повторит другое.
      .orderBy(desc(actionJournal.transitionSequence))
      .limit(100);
    const candidates = await db
      .selectDistinctOn([actionJournal.status], historyColumns)
      .from(actionJournal)
      .where(
        and(
          visibleHistory,
          inArray(actionJournal.status, ["APPLIED", "UNDONE"]),
        ),
      )
      .orderBy(actionJournal.status, desc(actionJournal.transitionSequence));
    const nextDirections = new Map(
      candidates.map((candidate) => [
        candidate.sequence,
        candidate.status === "APPLIED" ? ("undo" as const) : ("redo" as const),
      ]),
    );
    const recentSequences = new Set(rows.map((row) => row.sequence));
    // После ста переходов кандидат противоположного статуса может оказаться за
    // пределами обычной страницы. Добавляем его отдельно и маркируем, чтобы UI
    // по-прежнему обещал ровно ту команду, которую выберет POST ниже.
    return [
      ...rows.map((row) => ({
        ...row,
        nextDirection: nextDirections.get(row.sequence) ?? null,
      })),
      ...candidates
        .filter((candidate) => !recentSequences.has(candidate.sequence))
        .map((candidate) => ({
          ...candidate,
          nextDirection: nextDirections.get(candidate.sequence) ?? null,
        })),
    ];
  });

  for (const direction of ["undo", "redo"] as const) {
    app.post(`/api/canvas/${direction}`, async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const body = historyCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const desiredStatus = direction === "undo" ? "APPLIED" : "UNDONE";
      const [candidateCommand] = await db
        .select()
        .from(actionJournal)
        .where(
          and(
            eq(actionJournal.campaignId, auth.campaignId),
            eq(actionJournal.sceneId, body.sceneId),
            eq(actionJournal.status, desiredStatus),
            auth.role === "GM"
              ? undefined
              : and(
                  eq(actionJournal.actorMembershipId, auth.membershipId),
                  eq(actionJournal.scope, "PUBLIC"),
                ),
          ),
        )
        .orderBy(desc(actionJournal.transitionSequence))
        .limit(1);
      if (!candidateCommand)
        return reply.code(404).send({ error: "HISTORY_ACTION_NOT_FOUND" });
      const saved = await db
        .transaction(async (tx) => {
          // Every canvas mutation that can create or restore tokens takes the
          // scene lock first. Grid rescale uses the same lock, making token
          // placement and history replay linearizable with the rescale.
          await tx.execute(
            sql`select id from scenes where id = ${body.sceneId} and campaign_id = ${auth.campaignId} for update`,
          );
          await tx.execute(
            sql`select sequence from action_journal where sequence = ${candidateCommand.sequence} for update`,
          );
          const [command] = await tx
            .select()
            .from(actionJournal)
            .where(eq(actionJournal.sequence, candidateCommand.sequence))
            .limit(1);
          if (!command || command.status !== desiredStatus) return null;
          const snapshot =
            direction === "undo" ? command.before : command.after;
          let targetRevision = command.currentRevision;
          if (command.targetType === "CANVAS_BULK") {
            const conflict = (): never => {
              throw new Error("CANVAS_BULK_HISTORY_CONFLICT");
            };
            type StoredToken = Omit<typeof tokens.$inferSelect, "updatedAt"> & {
              updatedAt: Date | string;
            };
            type StoredDrawing = Omit<
              typeof drawings.$inferSelect,
              "createdAt" | "updatedAt"
            > & {
              createdAt: Date | string;
              updatedAt: Date | string;
            };
            type CompoundSnapshot = {
              tokens: StoredToken[];
              drawings: StoredDrawing[];
              revisions?: {
                tokens?: Record<string, number>;
                drawings?: Record<string, number>;
              };
            };
            const desired = snapshot as CompoundSnapshot;
            const current = (
              direction === "undo" ? command.after : command.before
            ) as CompoundSnapshot;
            const tokenIds = new Set([
              ...desired.tokens.map((row) => row.id),
              ...current.tokens.map((row) => row.id),
              ...Object.keys(desired.revisions?.tokens ?? {}),
              ...Object.keys(current.revisions?.tokens ?? {}),
            ]);
            const drawingIds = new Set([
              ...desired.drawings.map((row) => row.id),
              ...current.drawings.map((row) => row.id),
              ...Object.keys(desired.revisions?.drawings ?? {}),
              ...Object.keys(current.revisions?.drawings ?? {}),
            ]);
            const currentTokens = tokenIds.size
              ? await tx
                  .select()
                  .from(tokens)
                  .where(inArray(tokens.id, [...tokenIds]))
              : [];
            const currentDrawings = drawingIds.size
              ? await tx
                  .select()
                  .from(drawings)
                  .where(inArray(drawings.id, [...drawingIds]))
              : [];
            const currentTokenRows = new Map(
              currentTokens.map((row) => [row.id, row]),
            );
            const currentDrawingRows = new Map(
              currentDrawings.map((row) => [row.id, row]),
            );
            const expectedTokenRows = new Map(
              current.tokens.map((row) => [row.id, row]),
            );
            const expectedDrawingRows = new Map(
              current.drawings.map((row) => [row.id, row]),
            );
            for (const id of tokenIds) {
              const actual = currentTokenRows.get(id);
              const expected = expectedTokenRows.get(id);
              if (
                Boolean(actual) !== Boolean(expected) ||
                (actual &&
                  actual.revision !==
                    (current.revisions?.tokens?.[id] ?? expected?.revision))
              )
                conflict();
            }
            for (const id of drawingIds) {
              const actual = currentDrawingRows.get(id);
              const expected = expectedDrawingRows.get(id);
              if (
                Boolean(actual) !== Boolean(expected) ||
                (actual &&
                  actual.revision !==
                    (current.revisions?.drawings?.[id] ?? expected?.revision))
              )
                conflict();
            }
            const desiredTokenIds = new Set(
              desired.tokens.map((row) => row.id),
            );
            const desiredDrawingIds = new Set(
              desired.drawings.map((row) => row.id),
            );
            const nextTokenRevisions = {
              ...(desired.revisions?.tokens ?? {}),
            };
            const nextDrawingRevisions = {
              ...(desired.revisions?.drawings ?? {}),
            };
            const nextTokens: StoredToken[] = [];
            const nextDrawings: StoredDrawing[] = [];
            for (const prior of current.tokens) {
              if (desiredTokenIds.has(prior.id)) continue;
              const [deleted] = await tx
                .delete(tokens)
                .where(
                  and(
                    eq(tokens.id, prior.id),
                    eq(
                      tokens.revision,
                      current.revisions?.tokens?.[prior.id] ?? prior.revision,
                    ),
                  ),
                )
                .returning();
              const deletedRow = deleted ?? conflict();
              nextTokenRevisions[prior.id] = deletedRow.revision;
            }
            for (const prior of current.drawings) {
              if (desiredDrawingIds.has(prior.id)) continue;
              const [deleted] = await tx
                .delete(drawings)
                .where(
                  and(
                    eq(drawings.id, prior.id),
                    eq(
                      drawings.revision,
                      current.revisions?.drawings?.[prior.id] ?? prior.revision,
                    ),
                  ),
                )
                .returning();
              const deletedRow = deleted ?? conflict();
              nextDrawingRevisions[prior.id] = deletedRow.revision;
            }
            for (const token of desired.tokens) {
              const existing = currentTokenRows.get(token.id);
              const nextRevision =
                (current.revisions?.tokens?.[token.id] ??
                  desired.revisions?.tokens?.[token.id] ??
                  token.revision) + 1;
              if (existing) {
                const [updated] = await tx
                  .update(tokens)
                  .set({
                    definitionId: token.definitionId,
                    sceneId: token.sceneId,
                    characterId: token.characterId,
                    ownerMembershipId: token.ownerMembershipId,
                    assetId: token.assetId,
                    levelId: token.levelId,
                    layer: token.layer,
                    name: token.name,
                    x: token.x,
                    y: token.y,
                    z: token.z,
                    width: token.width,
                    height: token.height,
                    rotation: token.rotation,
                    visible: token.visible,
                    locked: token.locked,
                    baseColor: token.baseColor,
                    frameColor: token.frameColor,
                    revision: nextRevision,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(tokens.id, token.id),
                      eq(tokens.revision, existing.revision),
                    ),
                  )
                  .returning();
                const updatedRow = updated ?? conflict();
                nextTokens.push(updatedRow);
                nextTokenRevisions[token.id] = updatedRow.revision;
              } else {
                const [restored] = await tx
                  .insert(tokens)
                  .values({
                    id: token.id,
                    definitionId: token.definitionId,
                    sceneId: token.sceneId,
                    characterId: token.characterId,
                    ownerMembershipId: token.ownerMembershipId,
                    assetId: token.assetId,
                    levelId: token.levelId,
                    layer: token.layer,
                    name: token.name,
                    x: token.x,
                    y: token.y,
                    z: token.z,
                    width: token.width,
                    height: token.height,
                    rotation: token.rotation,
                    visible: token.visible,
                    locked: token.locked,
                    baseColor: token.baseColor,
                    frameColor: token.frameColor,
                    revision: nextRevision,
                    updatedAt: new Date(token.updatedAt),
                  })
                  .returning();
                const restoredRow = restored ?? conflict();
                nextTokens.push(restoredRow);
                nextTokenRevisions[token.id] = restoredRow.revision;
              }
            }
            for (const drawing of desired.drawings) {
              const existing = currentDrawingRows.get(drawing.id);
              const nextRevision =
                (current.revisions?.drawings?.[drawing.id] ??
                  desired.revisions?.drawings?.[drawing.id] ??
                  drawing.revision) + 1;
              if (existing) {
                const [updated] = await tx
                  .update(drawings)
                  .set({
                    sceneId: drawing.sceneId,
                    authorMembershipId: drawing.authorMembershipId,
                    points: drawing.points,
                    color: drawing.color,
                    x: drawing.x,
                    y: drawing.y,
                    revision: nextRevision,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(drawings.id, drawing.id),
                      eq(drawings.revision, existing.revision),
                    ),
                  )
                  .returning();
                const updatedRow = updated ?? conflict();
                nextDrawings.push(updatedRow);
                nextDrawingRevisions[drawing.id] = updatedRow.revision;
              } else {
                const [restored] = await tx
                  .insert(drawings)
                  .values({
                    id: drawing.id,
                    sceneId: drawing.sceneId,
                    authorMembershipId: drawing.authorMembershipId,
                    points: drawing.points,
                    color: drawing.color,
                    x: drawing.x,
                    y: drawing.y,
                    revision: nextRevision,
                    createdAt: new Date(drawing.createdAt),
                    updatedAt: new Date(drawing.updatedAt),
                  })
                  .returning();
                const restoredRow = restored ?? conflict();
                nextDrawings.push(restoredRow);
                nextDrawingRevisions[drawing.id] = restoredRow.revision;
              }
            }
            const nextSnapshot: CompoundSnapshot = {
              tokens: nextTokens,
              drawings: nextDrawings,
              revisions: {
                tokens: nextTokenRevisions,
                drawings: nextDrawingRevisions,
              },
            };
            if (direction === "undo") command.before = nextSnapshot;
            else command.after = nextSnapshot;
            targetRevision = (targetRevision ?? 0) + 1;
          } else if (command.targetType === "DRAWING") {
            if (snapshot === null) {
              const [deleted] = await tx
                .delete(drawings)
                .where(
                  and(
                    eq(drawings.id, command.targetId),
                    targetRevision === null
                      ? undefined
                      : eq(drawings.revision, targetRevision),
                  ),
                )
                .returning();
              if (!deleted) return null;
            } else {
              const drawing = snapshot as typeof drawings.$inferSelect;
              const [existing] = await tx
                .select()
                .from(drawings)
                .where(eq(drawings.id, command.targetId))
                .limit(1);
              if (existing) {
                if (
                  targetRevision === null ||
                  existing.revision !== targetRevision
                )
                  return null;
                const [updated] = await tx
                  .update(drawings)
                  .set({
                    points: drawing.points,
                    color: drawing.color,
                    x: drawing.x,
                    y: drawing.y,
                    revision: existing.revision + 1,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(drawings.id, command.targetId),
                      eq(drawings.revision, existing.revision),
                    ),
                  )
                  .returning();
                if (!updated) return null;
                targetRevision = updated.revision;
              } else {
                const nextRevision = (targetRevision ?? drawing.revision) + 1;
                const [restored] = await tx
                  .insert(drawings)
                  .values({
                    id: command.targetId,
                    sceneId: drawing.sceneId,
                    authorMembershipId: drawing.authorMembershipId,
                    points: drawing.points,
                    color: drawing.color,
                    x: drawing.x,
                    y: drawing.y,
                    revision: nextRevision,
                  })
                  .returning();
                if (!restored) return null;
                targetRevision = restored.revision;
              }
            }
          } else if (command.targetType === "TOKEN") {
            if (snapshot === null) {
              const [deleted] = await tx
                .delete(tokens)
                .where(
                  and(
                    eq(tokens.id, command.targetId),
                    command.currentRevision === null
                      ? undefined
                      : eq(tokens.revision, command.currentRevision),
                  ),
                )
                .returning();
              if (!deleted) return null;
              targetRevision = deleted.revision;
            } else if (
              command.type === "TOKEN_DELETE" ||
              command.type === "TOKEN_CREATE"
            ) {
              const token = snapshot as typeof tokens.$inferSelect;
              const [existing] = await tx
                .select({ id: tokens.id })
                .from(tokens)
                .where(eq(tokens.id, command.targetId))
                .limit(1);
              if (existing) return null;
              const nextRevision = (targetRevision ?? token.revision) + 1;
              const [restored] = await tx
                .insert(tokens)
                .values({
                  id: token.id,
                  definitionId: token.definitionId,
                  sceneId: token.sceneId,
                  characterId: token.characterId,
                  ownerMembershipId: token.ownerMembershipId,
                  assetId: token.assetId,
                  levelId: token.levelId,
                  layer: token.layer,
                  name: token.name,
                  x: token.x,
                  y: token.y,
                  z: token.z,
                  width: token.width,
                  height: token.height,
                  rotation: token.rotation,
                  visible: token.visible,
                  locked: token.locked,
                  baseColor: token.baseColor,
                  frameColor: token.frameColor,
                  revision: nextRevision,
                })
                .returning();
              if (!restored) return null;
              targetRevision = restored.revision;
            } else {
              const values = snapshot as {
                layer?: "MAP" | "GM" | "PLAYER";
                x?: number;
                y?: number;
                z?: number;
                levelId?: string | null;
                width?: number;
                height?: number;
                baseColor?: string;
                frameColor?: string | null;
              } | null;
              if (!values || targetRevision === null) return null;
              const [updated] = await tx
                .update(tokens)
                .set({
                  ...(values.layer ? { layer: values.layer } : {}),
                  ...(values.x !== undefined ? { x: values.x } : {}),
                  ...(values.y !== undefined ? { y: values.y } : {}),
                  ...(values.z !== undefined ? { z: values.z } : {}),
                  ...(values.levelId !== undefined
                    ? { levelId: values.levelId }
                    : {}),
                  ...(values.width !== undefined
                    ? { width: values.width }
                    : {}),
                  ...(values.height !== undefined
                    ? { height: values.height }
                    : {}),
                  ...(values.baseColor !== undefined
                    ? { baseColor: values.baseColor }
                    : {}),
                  ...(values.frameColor !== undefined
                    ? { frameColor: values.frameColor }
                    : {}),
                  revision: targetRevision + 1,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(tokens.id, command.targetId),
                    eq(tokens.revision, targetRevision),
                  ),
                )
                .returning();
              if (!updated) return null;
              targetRevision = updated.revision;
            }
          } else if (command.targetType === "FOG") {
            if (snapshot === null) {
              const [deleted] = await tx
                .delete(fogReveals)
                .where(eq(fogReveals.id, command.targetId))
                .returning();
              if (!deleted) return null;
            } else {
              const fog = snapshot as typeof fogReveals.$inferSelect;
              const [restored] = await tx
                .insert(fogReveals)
                .values({
                  id: command.targetId,
                  sceneId: fog.sceneId,
                  x: fog.x,
                  y: fog.y,
                  width: fog.width,
                  height: fog.height,
                  operation: fog.operation,
                  shape: fog.shape,
                  geometry: fog.geometry,
                  bbox: fog.bbox,
                  sequence: fog.sequence,
                  revision: (targetRevision ?? fog.revision) + 1,
                })
                .returning();
              if (!restored) return null;
              targetRevision = restored.revision;
            }
          } else if (command.targetType === "SCENE") {
            if (snapshot === null) return null;
            const values = snapshot as {
              name?: string;
              mapAssetId?: string | null;
              grid: typeof scenes.$inferSelect.grid;
              mapScale: number;
              world?: { width: number; height: number };
              backgroundFrame?: {
                x: number;
                y: number;
                width: number;
                height: number;
              };
              tokenGeometry?: SceneTokenGeometrySnapshot;
            };
            const expectedValues = (
              direction === "undo" ? command.after : command.before
            ) as typeof values;
            const [currentScene] = await tx
              .select({ revision: scenes.revision })
              .from(scenes)
              .where(
                and(
                  eq(scenes.id, command.targetId),
                  eq(scenes.campaignId, auth.campaignId),
                ),
              )
              .limit(1);
            if (
              !currentScene ||
              (command.currentRevision !== null &&
                currentScene.revision !== command.currentRevision)
            )
              return null;
            if (
              Boolean(values.tokenGeometry) !==
              Boolean(expectedValues.tokenGeometry)
            )
              return null;
            if (values.tokenGeometry && expectedValues.tokenGeometry) {
              const desired = values.tokenGeometry;
              const expected = expectedValues.tokenGeometry;
              const desiredTokenIds = desired.tokens
                .map((row) => row.id)
                .sort();
              const expectedTokenIds = expected.tokens
                .map((row) => row.id)
                .sort();
              if (desiredTokenIds.join() !== expectedTokenIds.join())
                return null;
              const currentTokens = desiredTokenIds.length
                ? await tx
                    .select({
                      id: tokens.id,
                      revision: tokens.revision,
                    })
                    .from(tokens)
                    .where(inArray(tokens.id, desiredTokenIds))
                : [];
              const expectedTokens = new Map(
                expected.tokens.map((row) => [row.id, row]),
              );
              if (
                currentTokens.length !== desiredTokenIds.length ||
                currentTokens.some(
                  (row) =>
                    row.revision !== expectedTokens.get(row.id)?.revision,
                )
              )
                return null;
              const nextTokens: SceneTokenGeometrySnapshot["tokens"] = [];
              for (const token of desired.tokens) {
                const expectedRevision = expectedTokens.get(token.id)!.revision;
                const [saved] = await tx
                  .update(tokens)
                  .set({
                    x: token.x,
                    y: token.y,
                    width: token.width,
                    height: token.height,
                    revision: expectedRevision + 1,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(tokens.id, token.id),
                      eq(tokens.revision, expectedRevision),
                    ),
                  )
                  .returning({
                    id: tokens.id,
                    x: tokens.x,
                    y: tokens.y,
                    width: tokens.width,
                    height: tokens.height,
                    revision: tokens.revision,
                  });
                if (!saved) throw new Error("SCENE_GRID_HISTORY_CONFLICT");
                nextTokens.push(saved);
              }
              values.tokenGeometry = { tokens: nextTokens };
              if (direction === "undo") command.before = values;
              else command.after = values;
            }
            const [updated] = await tx
              .update(scenes)
              .set({
                ...(values.name !== undefined ? { name: values.name } : {}),
                ...(values.mapAssetId !== undefined
                  ? { mapAssetId: values.mapAssetId }
                  : {}),
                grid: values.grid,
                mapScale: values.mapScale,
                ...(values.world
                  ? { width: values.world.width, height: values.world.height }
                  : {}),
                ...(values.backgroundFrame
                  ? {
                      backgroundX: values.backgroundFrame.x,
                      backgroundY: values.backgroundFrame.y,
                      backgroundWidth: values.backgroundFrame.width,
                      backgroundHeight: values.backgroundFrame.height,
                    }
                  : {}),
                revision: currentScene.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(scenes.id, command.targetId),
                  eq(scenes.revision, currentScene.revision),
                  eq(scenes.campaignId, auth.campaignId),
                ),
              )
              .returning();
            if (!updated) throw new Error("SCENE_GRID_HISTORY_CONFLICT");
            targetRevision = updated.revision;
          } else return null;
          const nextStatus = direction === "undo" ? "UNDONE" : "APPLIED";
          const [journal] = await tx
            .update(actionJournal)
            .set({
              status: nextStatus,
              currentRevision: targetRevision,
              ...(["CANVAS_BULK", "SCENE"].includes(command.targetType)
                ? { before: command.before, after: command.after }
                : {}),
              transitionSequence: sql`nextval(pg_get_serial_sequence('action_journal', 'transition_sequence'))`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(actionJournal.sequence, command.sequence),
                eq(actionJournal.status, desiredStatus),
              ),
            )
            .returning();
          if (!journal) throw new Error("HISTORY_JOURNAL_CONFLICT");
          const [event] = await tx
            .insert(gameEvents)
            .values({
              campaignId: auth.campaignId,
              actionId: body.actionId,
              membershipId: auth.membershipId,
              type: `canvas.${direction}`,
              entityType: command.targetType.toLowerCase(),
              entityId: command.targetId,
              entityRevision: targetRevision,
              payload: { journalSequence: command.sequence },
            })
            .returning();
          if (!event) throw new Error("EVENT_RECORD_FAILED");
          return { journal, event };
        })
        .catch((error: unknown) =>
          error instanceof Error &&
          [
            "CANVAS_BULK_HISTORY_CONFLICT",
            "SCENE_GRID_HISTORY_CONFLICT",
            "HISTORY_JOURNAL_CONFLICT",
          ].includes(error.message)
            ? null
            : Promise.reject(error),
        );
      if (!saved)
        return reply.code(409).send({ error: "HISTORY_CONFLICT_RESYNC" });
      await broadcastSnapshots(io, db, auth.campaignId);
      return {
        sequence: saved.journal.sequence,
        status: saved.journal.status,
        eventSequence: Number(saved.event.sequence),
      };
    });
  }

  app.patch("/api/scenes/:id/canvas", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = sceneCanvasConfigSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    if (body.mapAssetId) {
      const [mapAsset] = await db
        .select({ kind: assets.kind })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.mapAssetId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!mapAsset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      if (mapAsset.kind !== "MAP")
        return reply.code(422).send({ error: "MAP_ASSET_REQUIRED" });
    }
    const result = await db
      .transaction(async (tx) => {
        // Scene mutation, token placement, and token-restoring history all use
        // this same row lock. The token set below is therefore a complete,
        // linearizable snapshot for this rescale.
        await tx.execute(
          sql`select id from scenes where id = ${id} and campaign_id = ${auth.campaignId} for update`,
        );
        const [current] = await tx
          .select()
          .from(scenes)
          .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId)))
          .limit(1);
        if (!current) return { status: "not_found" as const };
        if (current.revision !== body.revision)
          return { status: "conflict" as const };

        const shouldRescaleTokenGeometry = Boolean(
          body.grid &&
          current.grid.enabled &&
          body.grid.enabled &&
          current.grid.size !== body.grid.size,
        );
        const currentTokenGeometry = shouldRescaleTokenGeometry
          ? await tx
              .select({
                id: tokens.id,
                x: tokens.x,
                y: tokens.y,
                width: tokens.width,
                height: tokens.height,
                revision: tokens.revision,
              })
              .from(tokens)
              .where(eq(tokens.sceneId, id))
          : [];
        const scale =
          shouldRescaleTokenGeometry && body.grid
            ? body.grid.size / current.grid.size
            : 1;
        const plannedTokenGeometry = currentTokenGeometry.map((token) => ({
          ...token,
          x: scaledGridCoordinate(
            token.x,
            current.grid.offsetX,
            body.grid!.offsetX,
            scale,
          ),
          y: scaledGridCoordinate(
            token.y,
            current.grid.offsetY,
            body.grid!.offsetY,
            scale,
          ),
          width: scaledTokenLength(token.width, scale),
          height: scaledTokenLength(token.height, scale),
        }));
        const outOfBounds = plannedTokenGeometry.find(
          (token) =>
            token.width < MIN_TOKEN_LENGTH ||
            token.width > MAX_TOKEN_LENGTH ||
            token.height < MIN_TOKEN_LENGTH ||
            token.height > MAX_TOKEN_LENGTH,
        );
        if (outOfBounds)
          throw new SceneGridTokenBoundsError(
            outOfBounds.id,
            outOfBounds.width,
            outOfBounds.height,
          );

        await invalidateRedoBranch(tx, auth, id);
        const [next] = await tx
          .update(scenes)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.mapAssetId !== undefined
              ? { mapAssetId: body.mapAssetId }
              : {}),
            ...(body.grid ? { grid: body.grid } : {}),
            ...(body.mapScale !== undefined ? { mapScale: body.mapScale } : {}),
            ...(body.world
              ? { width: body.world.width, height: body.world.height }
              : {}),
            ...(body.backgroundFrame
              ? {
                  backgroundX: body.backgroundFrame.x,
                  backgroundY: body.backgroundFrame.y,
                  backgroundWidth: body.backgroundFrame.width,
                  backgroundHeight: body.backgroundFrame.height,
                }
              : {}),
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(scenes.id, id),
              eq(scenes.campaignId, auth.campaignId),
              eq(scenes.revision, current.revision),
            ),
          )
          .returning();
        if (!next) throw new Error("SCENE_GRID_RESCALE_CONFLICT");

        let beforeTokenGeometry: SceneTokenGeometrySnapshot | undefined;
        let afterTokenGeometry: SceneTokenGeometrySnapshot | undefined;
        if (shouldRescaleTokenGeometry && body.grid) {
          beforeTokenGeometry = { tokens: currentTokenGeometry };
          const nextTokens: SceneTokenGeometrySnapshot["tokens"] = [];
          for (const token of plannedTokenGeometry) {
            const [saved] = await tx
              .update(tokens)
              .set({
                x: token.x,
                y: token.y,
                width: token.width,
                height: token.height,
                revision: token.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(tokens.id, token.id),
                  eq(tokens.revision, token.revision),
                ),
              )
              .returning({
                id: tokens.id,
                x: tokens.x,
                y: tokens.y,
                width: tokens.width,
                height: tokens.height,
                revision: tokens.revision,
              });
            if (!saved) throw new Error("SCENE_GRID_RESCALE_CONFLICT");
            nextTokens.push(saved);
          }
          afterTokenGeometry = { tokens: nextTokens };
          // Earlier token snapshots use the previous grid coordinate system.
          // Retire them so later history never replays stale pixel geometry;
          // drawing and fog actions remain independently undoable.
          if (nextTokens.length)
            await tx
              .update(actionJournal)
              .set({
                status: "INVALIDATED",
                transitionSequence: sql`nextval(pg_get_serial_sequence('action_journal', 'transition_sequence'))`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(actionJournal.campaignId, auth.campaignId),
                  eq(actionJournal.sceneId, id),
                  eq(actionJournal.targetType, "TOKEN"),
                  inArray(
                    actionJournal.targetId,
                    nextTokens.map((token) => token.id),
                  ),
                  eq(actionJournal.status, "APPLIED"),
                ),
              );
        }
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "scene.canvas",
          entityType: "scene",
          entityId: id,
          entityRevision: next.revision,
          payload: {
            name: next.name,
            mapAssetId: next.mapAssetId,
            grid: next.grid,
            mapScale: next.mapScale,
            world: { width: next.width, height: next.height },
            backgroundFrame: {
              x: next.backgroundX,
              y: next.backgroundY,
              width: next.backgroundWidth,
              height: next.backgroundHeight,
            },
            ...(afterTokenGeometry
              ? { rescaledTokens: afterTokenGeometry.tokens.length }
              : {}),
          },
        });
        await tx.insert(actionJournal).values({
          campaignId: auth.campaignId,
          sceneId: id,
          actorMembershipId: auth.membershipId,
          actionId: body.actionId,
          type: "SCENE_CANVAS",
          targetType: "SCENE",
          targetId: id,
          before: {
            name: current.name,
            mapAssetId: current.mapAssetId,
            grid: current.grid,
            mapScale: current.mapScale,
            world: { width: current.width, height: current.height },
            backgroundFrame: {
              x: current.backgroundX,
              y: current.backgroundY,
              width: current.backgroundWidth,
              height: current.backgroundHeight,
            },
            ...(beforeTokenGeometry
              ? { tokenGeometry: beforeTokenGeometry }
              : {}),
          },
          after: {
            name: next.name,
            mapAssetId: next.mapAssetId,
            grid: next.grid,
            mapScale: next.mapScale,
            world: { width: next.width, height: next.height },
            backgroundFrame: {
              x: next.backgroundX,
              y: next.backgroundY,
              width: next.backgroundWidth,
              height: next.backgroundHeight,
            },
            ...(afterTokenGeometry
              ? { tokenGeometry: afterTokenGeometry }
              : {}),
          },
          beforeRevision: current.revision,
          afterRevision: next.revision,
          currentRevision: next.revision,
        });
        return { status: "ok" as const, scene: next };
      })
      .catch((error: unknown) => {
        if (error instanceof SceneGridTokenBoundsError)
          return {
            status: "bounds" as const,
            tokenId: error.tokenId,
            width: error.width,
            height: error.height,
          };
        if (
          error instanceof Error &&
          error.message === "SCENE_GRID_RESCALE_CONFLICT"
        )
          return { status: "conflict" as const };
        return Promise.reject(error);
      });
    if (result.status === "not_found")
      return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (result.status === "conflict")
      return reply.code(409).send({ error: "SCENE_CONFLICT" });
    if (result.status === "bounds")
      return reply.code(422).send({
        error: "SCENE_GRID_TOKEN_BOUNDS",
        policy: "REJECT",
        min: MIN_TOKEN_LENGTH,
        max: MAX_TOKEN_LENGTH,
        tokenId: result.tokenId,
        width: result.width,
        height: result.height,
      });
    await broadcastSnapshots(io, db, auth.campaignId);
    return result.scene;
  });

  const stickerPackInputSchema = z
    .object({
      name: z.string().trim().min(1).max(120),
      subject: stickerPackSubjectSchema,
      subjectCharacterId: z.string().uuid().nullable().optional(),
      subjectMembershipId: z.string().uuid().nullable().optional(),
      subjectLabel: z.string().trim().min(1).max(80).nullable().optional(),
      audience: stickerPackAudienceSchema.default("CAMPAIGN"),
      sendPolicy: stickerPackSendPolicySchema.default("ALL_MEMBERS"),
    })
    .strict();
  const stickerMetadataSchema = z
    .object({
      name: z.string().trim().min(1).max(80),
      altText: z.string().trim().min(1).max(240),
      provenanceType: stickerProvenanceTypeSchema,
      sourceReference: z.string().trim().min(1).max(1000).optional(),
      authorCredit: z.string().trim().min(1).max(200).optional(),
      licenseNote: z.string().trim().min(1).max(1000).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.provenanceType === "IMPORTED" &&
        (!value.sourceReference || !value.authorCredit || !value.licenseNote)
      )
        context.addIssue({
          code: "custom",
          message: "Imported stickers require provenance",
        });
    });
  const requireGm = async (
    request: Parameters<typeof requireAuth>[0],
    reply: Parameters<typeof requireAuth>[1],
  ) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth || auth.role !== "GM") {
      if (auth) reply.code(403).send({ error: "GM_REQUIRED" });
      return null;
    }
    return auth;
  };

  app.post("/api/sticker-packs", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const body = stickerPackInputSchema.parse(request.body);
    const shapeValid =
      body.subject === "CHARACTER"
        ? !!body.subjectCharacterId &&
          !body.subjectMembershipId &&
          !body.subjectLabel
        : body.subject === "PLAYER"
          ? !!body.subjectMembershipId &&
            !body.subjectCharacterId &&
            !body.subjectLabel
          : !!body.subjectLabel &&
            !body.subjectCharacterId &&
            !body.subjectMembershipId;
    if (!shapeValid)
      return reply.code(422).send({ error: "INVALID_STICKER_PACK_SUBJECT" });
    if (body.subjectMembershipId) {
      const [member] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.id, body.subjectMembershipId),
          ),
        )
        .limit(1);
      if (!member)
        return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    }
    if (body.subjectCharacterId) {
      const [character] = await db
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            eq(characters.campaignId, auth.campaignId),
            eq(characters.id, body.subjectCharacterId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    }
    const [created] = await db
      .insert(stickerPacks)
      .values({ campaignId: auth.campaignId, ...body })
      .returning();
    return reply.code(201).send(created);
  });

  app.patch("/api/sticker-packs/:id", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        revision: z.number().int().nonnegative(),
        name: z.string().trim().min(1).max(120).optional(),
        audience: stickerPackAudienceSchema.optional(),
        sendPolicy: stickerPackSendPolicySchema.optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.name !== undefined ||
          value.audience !== undefined ||
          value.sendPolicy !== undefined,
      )
      .parse(request.body);
    const [updated] = await db
      .update(stickerPacks)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.audience !== undefined ? { audience: body.audience } : {}),
        ...(body.sendPolicy !== undefined
          ? { sendPolicy: body.sendPolicy }
          : {}),
        revision: body.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "DRAFT"),
          eq(stickerPacks.revision, body.revision),
        ),
      )
      .returning();
    if (!updated)
      return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    return updated;
  });

  app.delete("/api/sticker-packs/:id", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [updated] = await db
      .update(stickerPacks)
      .set({ lifecycle: "ARCHIVED", deprecatedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          inArray(stickerPacks.lifecycle, ["DRAFT", "DEPRECATED"]),
        ),
      )
      .returning({ id: stickerPacks.id });
    if (!updated)
      return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    return reply.code(204).send();
  });

  app.post("/api/sticker-packs/:id/stickers", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const metadata = stickerMetadataSchema.parse(request.query);
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "DRAFT"),
        ),
      )
      .limit(1);
    if (!pack) return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    const file = await request.file({
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    });
    if (!file) return reply.code(400).send({ error: "UPLOAD_REQUIRED" });
    const buffer = await file.toBuffer();
    const [assetUsage, feedbackUsage, chatUsage, stickerUsage] =
      await Promise.all([
        db.select({ used: sum(assets.sizeBytes) }).from(assets),
        db
          .select({ used: sum(feedbackAttachments.sizeBytes) })
          .from(feedbackAttachments),
        db
          .select({ used: sum(chatAttachmentUploads.sizeBytes) })
          .from(chatAttachmentUploads),
        db.select({ used: sum(stickerMedia.sizeBytes) }).from(stickerMedia),
      ]);
    await assertStorageCapacity(
      Number(assetUsage[0]?.used ?? 0) +
        Number(feedbackUsage[0]?.used ?? 0) +
        Number(chatUsage[0]?.used ?? 0) +
        Number(stickerUsage[0]?.used ?? 0),
      buffer.length,
    );
    let stored: Awaited<ReturnType<typeof storeUpload>> | undefined;
    try {
      stored = await storeUpload(buffer, "image");
      if (
        stored.mimeType !== "image/webp" ||
        !stored.width ||
        !stored.height ||
        stored.width > 4096 ||
        stored.height > 4096
      )
        throw new Error("INVALID_STICKER_MEDIA");
      const result = await db.transaction(async (tx) => {
        const [media] = await tx
          .insert(stickerMedia)
          .values({
            campaignId: auth.campaignId,
            uploadedByMembershipId: auth.membershipId,
            storageKey: stored!.storageKey,
            mimeType: stored!.mimeType,
            sizeBytes: stored!.sizeBytes,
            width: stored!.width!,
            height: stored!.height!,
            sha256: createHash("sha256").update(buffer).digest("hex"),
          })
          .returning();
        const [sticker] = await tx
          .insert(stickers)
          .values({
            campaignId: auth.campaignId,
            packId: pack.id,
            mediaId: media!.id,
            ...metadata,
          })
          .returning();
        return sticker!;
      });
      return reply.code(201).send(result);
    } catch (error) {
      if (stored) await removeStoredUpload(stored.storageKey);
      return reply.code(400).send({ error: publicUploadError(error) });
    }
  });

  app.post("/api/sticker-packs/:id/publish", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "DRAFT"),
        ),
      )
      .limit(1);
    if (!pack) return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    if (pack.subject === "PLAYER") {
      const [consent] = await db
        .select()
        .from(playerLikenessConsents)
        .where(
          and(
            eq(playerLikenessConsents.campaignId, auth.campaignId),
            eq(playerLikenessConsents.packId, id),
            eq(playerLikenessConsents.membershipId, pack.subjectMembershipId!),
            eq(playerLikenessConsents.status, "GRANTED"),
          ),
        )
        .limit(1);
      if (!consent)
        return reply.code(409).send({ error: "LIKENESS_CONSENT_REQUIRED" });
    }
    const [item] = await db
      .select({ id: stickers.id })
      .from(stickers)
      .where(
        and(eq(stickers.campaignId, auth.campaignId), eq(stickers.packId, id)),
      )
      .limit(1);
    if (!item) return reply.code(409).send({ error: "STICKER_PACK_EMPTY" });
    const [updated] = await db
      .update(stickerPacks)
      .set({
        lifecycle: "ACTIVE",
        revision: pack.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(eq(stickerPacks.id, id), eq(stickerPacks.revision, pack.revision)),
      )
      .returning();
    return updated ?? reply.code(409).send({ error: "STICKER_PACK_CONFLICT" });
  });

  app.post("/api/sticker-packs/:id/deprecate", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [updated] = await db
      .update(stickerPacks)
      .set({
        lifecycle: "DEPRECATED",
        deprecatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "ACTIVE"),
        ),
      )
      .returning();
    if (!updated)
      return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    return updated;
  });

  app.put(
    "/api/sticker-packs/:id/entitlements/:membershipId",
    async (request, reply) => {
      const auth = await requireGm(request, reply);
      if (!auth) return;
      const params = z
        .object({ id: z.string().uuid(), membershipId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({ granted: z.boolean() })
        .strict()
        .parse(request.body);
      const [pack] = await db
        .select({ id: stickerPacks.id })
        .from(stickerPacks)
        .where(
          and(
            eq(stickerPacks.campaignId, auth.campaignId),
            eq(stickerPacks.id, params.id),
          ),
        )
        .limit(1);
      const [member] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.id, params.membershipId),
          ),
        )
        .limit(1);
      if (!pack || !member)
        return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
      if (body.granted)
        await db
          .insert(stickerPackEntitlements)
          .values({
            campaignId: auth.campaignId,
            packId: params.id,
            membershipId: params.membershipId,
          })
          .onConflictDoNothing();
      else
        await db
          .delete(stickerPackEntitlements)
          .where(
            and(
              eq(stickerPackEntitlements.campaignId, auth.campaignId),
              eq(stickerPackEntitlements.packId, params.id),
              eq(stickerPackEntitlements.membershipId, params.membershipId),
            ),
          );
      return reply.code(204).send();
    },
  );

  app.put("/api/sticker-packs/:id/consent", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { granted } = z
      .object({ granted: z.boolean() })
      .strict()
      .parse(request.body);
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.subject, "PLAYER"),
          eq(stickerPacks.subjectMembershipId, auth.membershipId),
        ),
      )
      .limit(1);
    if (!pack) return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .insert(playerLikenessConsents)
        .values({
          campaignId: auth.campaignId,
          packId: id,
          membershipId: auth.membershipId,
          status: granted ? "GRANTED" : "REVOKED",
          grantedAt: now,
          revokedAt: granted ? null : now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            playerLikenessConsents.packId,
            playerLikenessConsents.membershipId,
          ],
          set: {
            status: granted ? "GRANTED" : "REVOKED",
            grantedAt: granted
              ? now
              : sql`coalesce(${playerLikenessConsents.grantedAt}, ${now})`,
            revokedAt: granted ? null : now,
            updatedAt: now,
          },
        });
      if (!granted)
        await tx
          .update(stickerPacks)
          .set({
            lifecycle: "DEPRECATED",
            deprecatedAt: now,
            revision: pack.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(stickerPacks.id, id),
              eq(stickerPacks.campaignId, auth.campaignId),
            ),
          );
    });
    await invalidateStickerConsentClients(
      (campaignId) => broadcastSnapshots(io, db, campaignId),
      auth.campaignId,
    );
    return reply.code(204).send();
  });

  app.get("/api/stickers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const packs = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.lifecycle, "ACTIVE"),
        ),
      );
    const result = [];
    for (const pack of packs) {
      if (
        !(await canMembersViewPack(db, auth.campaignId, pack, [
          auth.membershipId,
        ]))
      )
        continue;
      const items = await db
        .select({ sticker: stickers, media: stickerMedia })
        .from(stickers)
        .innerJoin(
          stickerMedia,
          and(
            eq(stickerMedia.id, stickers.mediaId),
            eq(stickerMedia.campaignId, stickers.campaignId),
          ),
        )
        .where(
          and(
            eq(stickers.campaignId, auth.campaignId),
            eq(stickers.packId, pack.id),
          ),
        );
      result.push({
        id: pack.id,
        name: pack.name,
        subject: pack.subject,
        subjectCharacterId: pack.subjectCharacterId,
        subjectMembershipId: pack.subjectMembershipId,
        subjectLabel: pack.subjectLabel,
        lifecycle: pack.lifecycle,
        canSend: await canMemberSendPack(db, auth, pack),
        stickers: items.map(({ sticker, media }) => ({
          id: sticker.id,
          packId: sticker.packId,
          name: sticker.name,
          altText: sticker.altText,
          url: stickerAssetUrl(sticker.id),
          width: media.width,
          height: media.height,
          attribution: {
            authorCredit: sticker.authorCredit,
            licenseNote: sticker.licenseNote,
          },
        })),
      });
    }
    reply.header("Cache-Control", "private, no-store");
    return result;
  });

  app.get("/api/stickers/:id/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = await resolveSticker(db, auth, id);
    if (!row || !["ACTIVE", "DEPRECATED"].includes(row.pack.lifecycle))
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const [revokedConsent] =
      row.pack.subject === "PLAYER"
        ? await db
            .select({ status: playerLikenessConsents.status })
            .from(playerLikenessConsents)
            .where(
              and(
                eq(playerLikenessConsents.campaignId, auth.campaignId),
                eq(playerLikenessConsents.packId, row.pack.id),
                eq(playerLikenessConsents.status, "REVOKED"),
              ),
            )
            .limit(1)
        : [];
    if (revokedConsent)
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const currentlyVisible = await canMembersViewPack(
      db,
      auth.campaignId,
      row.pack,
      [auth.membershipId],
    );
    const [historicalMessage] = currentlyVisible
      ? []
      : await db
          .select({
            id: chatMessages.id,
            viewers: chatMessages.stickerViewerMembershipIds,
          })
          .from(chatMessages)
          .innerJoin(
            chatThreads,
            and(
              eq(chatThreads.id, chatMessages.threadId),
              eq(chatThreads.campaignId, chatMessages.campaignId),
            ),
          )
          .where(
            and(
              eq(chatMessages.campaignId, auth.campaignId),
              eq(chatMessages.stickerId, row.sticker.id),
              chatVisibilityFilter(auth),
              or(
                eq(chatThreads.type, "STREAM"),
                eq(chatThreads.participantAMembershipId, auth.membershipId),
                eq(chatThreads.participantBMembershipId, auth.membershipId),
              ),
            ),
          )
          .limit(1);
    const visibleHistoricalMessage =
      historicalMessage &&
      (!historicalMessage.viewers ||
        historicalMessage.viewers.includes(auth.membershipId));
    if (!currentlyVisible && !visibleHistoricalMessage)
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    try {
      const file = await openStoredFile(
        row.media.storageKey,
        request.headers.range,
      );
      reply.header("Content-Type", row.media.mimeType);
      reply.header("Cache-Control", "private, no-store");
      reply.header("Content-Length", String(file.end - file.start + 1));
      if (file.partial) {
        reply.code(206);
        reply.header(
          "Content-Range",
          `bytes ${file.start}-${file.end}/${file.size}`,
        );
      }
      return reply.send(file.stream);
    } catch {
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    }
  });

  app.post("/api/chat/stickers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createStickerMessageSchema.parse(request.body);
    let thread;
    try {
      thread = await resolveChatThread(db, auth, body, ["TABLE", "STORY"], {
        allowDirect: true,
      });
    } catch {
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    }
    if (
      thread.type === "STREAM" &&
      (!thread.stream || !canPostToStream(auth, thread.stream))
    )
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate)
      return isMatchingStickerReplay(duplicate, {
        membershipId: auth.membershipId,
        threadId: thread.id,
        stickerId: body.stickerId,
      })
        ? reply.code(200).send(duplicate.payload)
        : reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    const resolved = await resolveSticker(db, auth, body.stickerId);
    if (
      !resolved ||
      resolved.pack.lifecycle !== "ACTIVE" ||
      !(await canMemberSendPack(db, auth, resolved.pack))
    )
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const viewers =
      thread.type === "DIRECT" ? directThreadMemberIds(thread) : [];
    if (
      viewers.length &&
      !(await canMembersViewPack(db, auth.campaignId, resolved.pack, viewers))
    )
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const presentation = stickerPresentation(resolved);
    let audienceMembershipIds: string[] | null = null;
    if (thread.type === "DIRECT") {
      audienceMembershipIds = viewers;
    } else if (resolved.pack.audience !== "CAMPAIGN") {
      const recipientRows =
        resolved.pack.audience === "GM_ONLY"
          ? await db
              .select({ id: memberships.id })
              .from(memberships)
              .where(
                and(
                  eq(memberships.campaignId, auth.campaignId),
                  eq(memberships.role, "GM"),
                ),
              )
          : await db
              .select({ id: memberships.id })
              .from(memberships)
              .leftJoin(
                stickerPackEntitlements,
                and(
                  eq(
                    stickerPackEntitlements.campaignId,
                    memberships.campaignId,
                  ),
                  eq(stickerPackEntitlements.membershipId, memberships.id),
                  eq(stickerPackEntitlements.packId, resolved.pack.id),
                ),
              )
              .where(
                and(
                  eq(memberships.campaignId, auth.campaignId),
                  or(
                    eq(memberships.role, "GM"),
                    eq(stickerPackEntitlements.packId, resolved.pack.id),
                  ),
                ),
              );
      audienceMembershipIds = [
        ...new Set([
          ...recipientRows.map((item) => item.id),
          auth.membershipId,
        ]),
      ];
    }
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(chatMessages)
        .values({
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
          characterId: null,
          kind: "TEXT",
          threadId: thread.id,
          visibility: stickerMessageVisibility(resolved.pack.audience),
          body: "",
          stickerId: resolved.sticker.id,
          stickerPresentation: presentation,
          stickerViewerMembershipIds: audienceMembershipIds,
        })
        .returning();
      const dto = chatMessageDto(row!, auth.displayName, thread.stream);
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "chat.created",
          entityType: "chat",
          entityId: row!.id,
          payload: dto,
        })
        .returning();
      return { dto, event: event! };
    });
    const envelope = {
      sequence: Number(saved.event.sequence),
      actionId: body.actionId,
      emittedAt: saved.event.createdAt.toISOString(),
      data: saved.dto,
    };
    if (audienceMembershipIds) {
      for (const membershipId of audienceMembershipIds)
        io.to(memberRoom(membershipId)).emit("chat:created", envelope);
    } else {
      io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
    }
    return reply.code(201).send(saved.dto);
  });

  app.post("/api/chat/attachments", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const expired = await db
      .select({
        id: chatAttachmentUploads.id,
        storageKey: chatAttachmentUploads.storageKey,
      })
      .from(chatAttachmentUploads)
      .where(
        and(
          eq(chatAttachmentUploads.status, "STAGED"),
          lt(chatAttachmentUploads.expiresAt, new Date()),
        ),
      )
      .limit(25);
    if (expired.length) {
      await Promise.all(
        expired.map((item) => removeStoredUpload(item.storageKey)),
      );
      await db.delete(chatAttachmentUploads).where(
        inArray(
          chatAttachmentUploads.id,
          expired.map((item) => item.id),
        ),
      );
    }
    const file = await request.file({
      limits: { files: 1, fileSize: env.MAX_IMAGE_BYTES },
    });
    if (!file) return reply.code(400).send({ error: "UPLOAD_REQUIRED" });
    const buffer = await file.toBuffer();
    if (file.file.truncated)
      return reply.code(400).send({ error: "IMAGE_TOO_LARGE" });
    const [assetUsage, feedbackUsage, chatUsage] = await Promise.all([
      db.select({ used: sum(assets.sizeBytes) }).from(assets),
      db
        .select({ used: sum(feedbackAttachments.sizeBytes) })
        .from(feedbackAttachments),
      db
        .select({ used: sum(chatAttachmentUploads.sizeBytes) })
        .from(chatAttachmentUploads),
    ]);
    const usedBytes =
      Number(assetUsage[0]?.used ?? 0) +
      Number(feedbackUsage[0]?.used ?? 0) +
      Number(chatUsage[0]?.used ?? 0);
    await assertStorageCapacity(usedBytes, buffer.length);
    let stored: Awaited<ReturnType<typeof storeUpload>> | undefined;
    try {
      stored = await storeUpload(buffer, "image");
      const [upload] = await db
        .insert(chatAttachmentUploads)
        .values({
          campaignId: auth.campaignId,
          uploadedByMembershipId: auth.membershipId,
          fileName: file.filename.slice(0, 255),
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          width: stored.width,
          height: stored.height,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .returning();
      if (!upload) throw new Error("UPLOAD_FAILED");
      return reply.code(201).send({
        contentId: upload.contentId,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        width: upload.width,
        height: upload.height,
        createdAt: upload.createdAt.toISOString(),
      });
    } catch (error) {
      if (stored) await removeStoredUpload(stored.storageKey);
      return reply.code(400).send({ error: publicUploadError(error) });
    }
  });

  app.get(
    "/api/chat/attachments/:contentId/content",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const { contentId } = z
        .object({ contentId: z.string().uuid() })
        .parse(request.params);
      const [item] = await db
        .select({ upload: chatAttachmentUploads, thread: chatThreads })
        .from(chatAttachments)
        .innerJoin(
          chatAttachmentUploads,
          and(
            eq(chatAttachmentUploads.campaignId, chatAttachments.campaignId),
            eq(chatAttachmentUploads.contentId, chatAttachments.contentId),
          ),
        )
        .innerJoin(
          chatThreads,
          and(
            eq(chatThreads.campaignId, chatAttachments.campaignId),
            eq(chatThreads.id, chatAttachments.threadId),
          ),
        )
        .where(
          and(
            eq(chatAttachments.campaignId, auth.campaignId),
            eq(chatAttachments.contentId, contentId),
            or(
              and(
                eq(chatThreads.type, "STREAM"),
                eq(
                  chatAttachmentUploads.uploadedByMembershipId,
                  auth.membershipId,
                ),
              ),
              eq(chatThreads.participantAMembershipId, auth.membershipId),
              eq(chatThreads.participantBMembershipId, auth.membershipId),
            ),
          ),
        )
        .limit(1);
      if (!item) return reply.code(404).send({ error: "NOT_FOUND" });
      try {
        const opened = await openStoredFile(item.upload.storageKey, undefined);
        reply.header("Content-Type", item.upload.mimeType);
        reply.header("Content-Length", String(opened.size));
        reply.header("Cache-Control", "private, no-store");
        return reply.send(opened.stream);
      } catch {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
    },
  );

  app.post("/api/chat/direct", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createOrGetDirectChatThreadSchema.parse(request.body);
    const [participant] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.campaignId, auth.campaignId),
          eq(memberships.id, body.participantMembershipId),
        ),
      )
      .limit(1);
    if (!participant || participant.id === auth.membershipId)
      return reply.code(404).send({ error: "CHAT_THREAD_NOT_FOUND" });
    const { thread, created } = await createOrGetDirectThread(
      db,
      auth,
      participant.id,
    );
    const participantIds = directThreadMemberIds(thread);
    const participantRows = await db
      .select({
        membershipId: memberships.id,
        displayName: memberships.displayName,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.campaignId, auth.campaignId),
          inArray(memberships.id, participantIds),
        ),
      );
    const byId = new Map(
      participantRows.map((item) => [item.membershipId, item]),
    );
    const dto = {
      id: thread.id,
      campaignId: thread.campaignId,
      type: "DIRECT" as const,
      stream: null,
      participants: participantIds
        .map((id) => byId.get(id)!)
        .filter(Boolean) as [
        { membershipId: string; displayName: string },
        { membershipId: string; displayName: string },
      ],
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    };
    if (created) {
      const event = {
        thread: dto,
        state: {
          threadId: thread.id,
          stream: null,
          lastReadSequence: 0,
          latestSequence: 0,
          unreadCount: 0,
        },
      };
      for (const membershipId of participantIds)
        io.to(memberRoom(membershipId)).emit("chat:thread_created", event);
    }
    return reply.code(created ? 201 : 200).send(dto);
  });

  app.post("/api/chat/direct/messages", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createDirectChatMessageSchema.parse(request.body);
    let thread;
    try {
      thread = await resolveChatThread(
        db,
        auth,
        { threadId: body.threadId },
        [],
        { allowDirect: true },
      );
    } catch {
      return reply.code(404).send({ error: "CHAT_THREAD_NOT_FOUND" });
    }
    if (thread.type !== "DIRECT")
      return reply.code(404).send({ error: "CHAT_THREAD_NOT_FOUND" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      if (
        duplicate.membershipId === auth.membershipId &&
        duplicate.type === "chat.created" &&
        duplicate.payload &&
        typeof duplicate.payload === "object" &&
        "threadId" in duplicate.payload &&
        duplicate.payload.threadId === thread.id
      )
        return reply.code(200).send(duplicate.payload);
      return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    }
    let saved;
    try {
      saved = await db.transaction(async (tx) => {
        const attachmentIds = body.attachmentContentIds;
        const staged = attachmentIds.length
          ? await tx
              .select()
              .from(chatAttachmentUploads)
              .where(
                and(
                  eq(chatAttachmentUploads.campaignId, auth.campaignId),
                  eq(
                    chatAttachmentUploads.uploadedByMembershipId,
                    auth.membershipId,
                  ),
                  eq(chatAttachmentUploads.status, "STAGED"),
                  gt(chatAttachmentUploads.expiresAt, new Date()),
                  inArray(chatAttachmentUploads.contentId, attachmentIds),
                ),
              )
          : [];
        if (staged.length !== attachmentIds.length)
          throw new Error("CHAT_ATTACHMENT_NOT_FOUND");
        const [row] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: null,
            threadId: thread.id,
            body: body.body,
            visibility: "PUBLIC",
          })
          .returning();
        if (!row) throw new Error("MESSAGE_CREATE_FAILED");
        if (staged.length) {
          await tx.insert(chatAttachments).values(
            staged.map((upload) => ({
              contentId: upload.contentId,
              campaignId: auth.campaignId,
              threadId: thread.id,
              messageId: row.id,
            })),
          );
          await tx
            .update(chatAttachmentUploads)
            .set({ status: "CLAIMED" })
            .where(inArray(chatAttachmentUploads.contentId, attachmentIds));
        }
        const dto = {
          ...chatMessageDto(row, auth.displayName, null),
          attachments: staged.map((upload) => ({
            contentId: upload.contentId,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            width: upload.width,
            height: upload.height,
            createdAt: upload.createdAt.toISOString(),
          })),
        };
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: "chat.created",
            entityType: "chat",
            entityId: row.id,
            payload: dto,
          })
          .returning();
        if (!event) throw new Error("EVENT_RECORD_FAILED");
        return { dto, event };
      });
    } catch (error) {
      const replay = await findAction(db, auth.campaignId, body.actionId);
      if (
        replay?.membershipId === auth.membershipId &&
        replay.type === "chat.created" &&
        replay.payload &&
        typeof replay.payload === "object" &&
        "threadId" in replay.payload &&
        replay.payload.threadId === thread.id
      )
        return reply.code(200).send(replay.payload);
      if (replay) return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
      if (
        error instanceof Error &&
        error.message === "CHAT_ATTACHMENT_NOT_FOUND"
      )
        return reply.code(404).send({ error: "CHAT_ATTACHMENT_NOT_FOUND" });
      throw error;
    }

    const envelope = {
      sequence: Number(saved.event.sequence),
      actionId: body.actionId,
      emittedAt: saved.event.createdAt.toISOString(),
      data: saved.dto,
    };
    for (const membershipId of directThreadMemberIds(thread))
      io.to(memberRoom(membershipId)).emit("chat:created", envelope);
    return reply.code(201).send(saved.dto);
  });

  /**
   * UIX-450 — страница истории одного потока.
   *
   * До этого маршрута истории неоткуда было взяться, кроме снапшота, и именно
   * поэтому снапшот вёз по 200 сообщений на поток каждому при каждом действии:
   * две трети всего трафика рассылки (1 726 КБ из 2 580 на боевых данных).
   *
   * Проекция — общая с снапшотом (`projectChatMessages`), включая проверки
   * видимости стикеров, вложений и заявок. Своей копии здесь нет намеренно:
   * разойдясь, она разошлась бы в сторону «показали лишнее».
   */
  app.get("/api/chat/threads/:threadId/messages", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const params = z
      .object({ threadId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);

    const memberRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.campaignId, auth.campaignId));
    const visibleRequests = await listVisiblePlayerRequests(db, auth);

    reply.header("Cache-Control", "private, no-store");
    return loadThreadHistory(db, auth, {
      threadId: params.threadId,
      before: query.before,
      limit: query.limit,
      memberNameById: new Map(
        memberRows.map((member) => [member.id, member.displayName]),
      ),
      visiblePlayerRequestIds: new Set(
        visibleRequests.map((item: { id: string }) => item.id),
      ),
    });
  });

  app.post("/api/chat", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createChatMessageSchema.parse(request.body);
    let thread;
    try {
      thread = await resolveChatThread(db, auth, body, ["TABLE", "STORY"]);
      if (thread.type !== "STREAM" || !thread.stream)
        throw new Error("CHAT_THREAD_NOT_FOUND");
      if (!canPostToStream(auth, thread.stream))
        throw new Error("CHAT_THREAD_FORBIDDEN");
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "CHAT_THREAD_FORBIDDEN";
      return reply
        .code(code === "CHAT_THREAD_NOT_FOUND" ? 404 : 403)
        .send({ error: code });
    }
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    let characterId: string | null = null;
    if (body.characterId) {
      const [character] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character || !(await canAccessCharacter(db, auth, character)))
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
      characterId = character.id;
    }
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(chatMessages)
        .values({
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
          characterId,
          threadId: thread.id,
          body: body.body,
          visibility: body.visibility,
        })
        .returning();
      if (!row) throw new Error("MESSAGE_CREATE_FAILED");
      const dto = chatMessageDto(row, auth.displayName, thread.stream);
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "chat.created",
          entityType: "chat",
          entityId: row.id,
          payload: dto,
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      return { row, dto, event };
    });
    const { row, dto, event } = saved;
    const envelope = {
      sequence: Number(event.sequence),
      actionId: body.actionId,
      emittedAt: event.createdAt.toISOString(),
      data: dto,
    };
    if (chatBroadcastAudience(row.visibility) === "CAMPAIGN")
      io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
    else {
      io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
      io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
    }
    return reply.code(201).send(dto);
  });

  app.post("/api/chat/read", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = markChatThreadReadSchema.parse(request.body);
    let thread;
    try {
      thread = await resolveChatThread(
        db,
        auth,
        { threadId: body.threadId },
        ["ROLLS", "STORY", "TABLE"],
        { allowDirect: true },
      );
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "CHAT_THREAD_FORBIDDEN";
      return reply
        .code(code === "CHAT_THREAD_NOT_FOUND" ? 404 : 403)
        .send({ error: code });
    }
    const visiblePlayerRequestIds = new Set(
      (await listVisiblePlayerRequests(db, auth)).map((item) => item.id),
    );
    const [latest] = await db
      .select({ sequence: chatMessages.sequence })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.campaignId, auth.campaignId),
          eq(chatMessages.threadId, thread.id),
          fullChatVisibilityFilter(auth, visiblePlayerRequestIds),
        ),
      )
      .orderBy(desc(chatMessages.sequence))
      .limit(1);
    const [previousCursor] = await db
      .select({ lastReadSequence: chatReadCursors.lastReadSequence })
      .from(chatReadCursors)
      .where(
        and(
          eq(chatReadCursors.membershipId, auth.membershipId),
          eq(chatReadCursors.threadId, thread.id),
        ),
      )
      .limit(1);
    const nextSequence = clampReadSequence(
      previousCursor?.lastReadSequence ?? 0,
      body.sequence,
      latest?.sequence ?? 0,
    );
    const [cursor] = await db
      .insert(chatReadCursors)
      .values({
        campaignId: auth.campaignId,
        membershipId: auth.membershipId,
        threadId: thread.id,
        lastReadSequence: nextSequence,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [chatReadCursors.membershipId, chatReadCursors.threadId],
        set: {
          lastReadSequence: sql`greatest(${chatReadCursors.lastReadSequence}, ${nextSequence})`,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!cursor) throw new Error("CHAT_CURSOR_UPDATE_FAILED");
    return {
      campaignId: cursor.campaignId,
      threadId: cursor.threadId,
      lastReadSequence: cursor.lastReadSequence,
      updatedAt: cursor.updatedAt.toISOString(),
    };
  });

  app.post("/api/campaign/clock", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = campaignClockCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    const resetsClock = body.command === "RESET_CLOCK";
    const legacyBattleCommand =
      body.command === "START_BATTLE" || body.command === "END_BATTLE";
    const [activeEncounter] =
      resetsClock || legacyBattleCommand
        ? await db
            .select({ id: encounters.id })
            .from(encounters)
            .where(
              and(
                eq(encounters.campaignId, auth.campaignId),
                eq(encounters.status, "ACTIVE"),
              ),
            )
            .limit(1)
        : [];
    if (legacyBattleCommand && activeEncounter)
      return reply.code(409).send({ error: "ENCOUNTER_ACTIVE" });
    if (resetsClock) {
      if (current.battleActive || activeEncounter)
        return reply.code(409).send({ error: "BATTLE_ACTIVE" });
      const anchorsNeedReset = await campaignRechargeAnchorsNeedReset(
        db,
        auth.campaignId,
      );
      if (
        current.day === 1 &&
        current.battleCounter === 0 &&
        current.initiative.length === 0 &&
        !anchorsNeedReset
      )
        return reply.code(400).send({ error: "CLOCK_ALREADY_RESET" });
    }
    if (body.command === "START_BATTLE" && current.battleActive)
      return reply.code(409).send({ error: "BATTLE_ALREADY_ACTIVE" });
    if (body.command === "END_BATTLE" && !current.battleActive)
      return reply.code(409).send({ error: "BATTLE_NOT_ACTIVE" });
    const advancesDay =
      body.command === "ADVANCE_DAY" || body.command === "LONG_REST";
    const nextDay = resetsClock ? 1 : current.day + (advancesDay ? 1 : 0);
    const nextBattle = resetsClock
      ? 0
      : current.battleCounter + (body.command === "START_BATTLE" ? 1 : 0);
    /**
     * UIX-466 п. 3 — начало боя собирает состав по зоне.
     *
     * Снимок, а не живой состав: вошедший в рамку позже не появляется в очереди
     * сам, вышедший из неё не исчезает. Живой пересчёт означал бы, что случайно
     * задетая мышью фигура меняет порядок ходов посреди хода. Подтянуть
     * опоздавших мастер может отдельным действием.
     *
     * Зона не задана — начало боя работает как раньше: состав собирается рамкой
     * выделения. Отказывать здесь нельзя, иначе бой стал бы невозможен, пока
     * поле не обведено.
     */
    const recruited =
      body.command === "START_BATTLE" && current.battleZone
        ? await recruitFromBattleZone(
            db,
            auth.campaignId,
            current.battleZone,
            current.initiative.map((participant) => ({
              ...participant,
              initiative: null,
            })),
          )
        : null;
    const tableThread = await ensureStreamThread(db, auth.campaignId, "TABLE");
    let result;
    try {
      result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(campaigns)
          .set({
            day: nextDay,
            battleActive: resetsClock
              ? false
              : body.command === "START_BATTLE"
                ? true
                : body.command === "END_BATTLE"
                  ? false
                  : current.battleActive,
            battleCounter: nextBattle,
            /**
             * UIX-431: новый бой обнуляет броски, но сохраняет состав.
             *
             * Те же противники часто дерутся снова, и собирать очередь заново
             * каждый раз — работа руками посреди игры. А вот старые числа,
             * оставшись, выглядели бы как уже сделанные броски: мастер повёл бы
             * бой по прошлой инициативе, не заметив подмены.
             *
             * UIX-466: `END_BATTLE` теперь очищает очередь целиком. Прежде она
             * сохранялась — на случай, что состав пригодится снова. На игре это
             * решение не сработало: между боями в очереди оставались убитые и
             * ушедшие, и следующий бой начинался с вычёркивания прошлого. Состав
             * собирается заново — рамкой на карте это несколько секунд.
             */
            initiative: resetsClock
              ? []
              : body.command === "START_BATTLE"
                ? (recruited ??
                  current.initiative.map((participant) => ({
                    ...participant,
                    initiative: null,
                  })))
                : body.command === "END_BATTLE"
                  ? []
                  : current.initiative,
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaigns.id, auth.campaignId),
              eq(campaigns.revision, current.revision),
            ),
          )
          .returning();
        if (!updated) throw new Error("CAMPAIGN_CONFLICT");
        const rechargeTrigger =
          body.command === "ADVANCE_DAY" ||
          body.command === "LONG_REST" ||
          body.command === "END_BATTLE"
            ? body.command
            : null;
        const recharged = rechargeTrigger
          ? await rechargeCampaignCatalogEntries(tx, auth.campaignId, {
              trigger: rechargeTrigger,
              day: nextDay,
              battleCounter: nextBattle,
            })
          : 0;
        const rebasedEntries = resetsClock
          ? await resetCampaignRechargeAnchors(tx, auth.campaignId)
          : 0;
        let restoredCharacters = 0;
        if (body.command === "LONG_REST") {
          const characterRows = await tx
            .select()
            .from(characters)
            .where(eq(characters.campaignId, auth.campaignId));
          for (const character of characterRows) {
            const beforeResources = character.resources as Resources;
            const afterResources = applyCharacterRest(
              beforeResources,
              "LONG",
              normalizeLegacyStats(character.stats),
            );
            if (
              JSON.stringify(beforeResources) === JSON.stringify(afterResources)
            )
              continue;
            const [restoredCharacter] = await tx
              .update(characters)
              .set({
                resources: afterResources,
                revision: character.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(characters.id, character.id),
                  eq(characters.revision, character.revision),
                ),
              )
              .returning({ id: characters.id });
            if (!restoredCharacter) throw new Error("CHARACTER_CONFLICT");
            restoredCharacters++;
          }
        }
        const label =
          body.command === "RESET_CLOCK"
            ? "Время кампании сброшено: день 1, боёв 0"
            : body.command === "LONG_REST"
              ? "Длинный отдых завершён"
              : body.command === "ADVANCE_DAY"
                ? `День кампании: ${nextDay}`
                : body.command === "START_BATTLE"
                  ? `Бой #${nextBattle} начат`
                  : `Бой #${current.battleCounter} завершён`;
        const [message] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            kind: "SYSTEM",
            threadId: tableThread.id,
            visibility: "PUBLIC",
            body:
              recharged > 0
                ? `${label}. Перезаряжено: ${recharged}.`
                : `${label}.`,
          })
          .returning();
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "campaign.clock",
          entityType: "campaign",
          entityId: auth.campaignId,
          entityRevision: updated.revision,
          payload: {
            command: body.command,
            previousDay: current.day,
            previousBattleCounter: current.battleCounter,
            day: nextDay,
            battleCounter: nextBattle,
            recharged,
            rebasedEntries,
            restoredCharacters,
          },
        });
        return { updated, message };
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "CAMPAIGN_CONFLICT" ||
          error.message === "ENTRY_CONFLICT" ||
          error.message === "CHARACTER_CONFLICT")
      )
        return reply.code(409).send({ error: error.message });
      throw error;
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    return result.updated;
  });

  app.patch("/api/campaign", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = renameCampaignSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const [replayed] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      return replayed
        ? reply.code(200).send(replayed)
        : reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    }
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          name: body.name,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.renamed",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: { name: next.name },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  /**
   * UIX-424, шаг 5 — правка раскладки характеристик кампании.
   *
   * Раскладка одна на всех, поэтому это команда мастера под ревизией кампании,
   * рядом с переименованием. Что именно разрешено менять — в
   * `rejectDestructiveLayoutChange`: пока набор ключей может только расти.
   */
  app.patch("/api/campaign/stat-layout", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = updateStatLayoutSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const [replayed] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      return replayed
        ? reply.code(200).send(replayed)
        : reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    }
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    // Сравнение с **разрешённой** раскладкой, а не с сохранённой: у кампании,
    // которая раскладку ни разу не правила, в базе пусто, а видит она
    // стартовую. Сравнив с пустым, сервер пропустил бы удаление любой строки.
    const resolved = resolveStatLayout(current.statLayout);
    const rejection = rejectDestructiveLayoutChange(
      resolved,
      body.layout,
      // Ссылки ищутся только когда что-то удаляют: обычная правка раскладки —
      // добавление и переименование, и тянуть ради неё всех персонажей с их
      // записями значило бы платить за редкий случай на каждом нажатии.
      removedStatKeys(resolved, body.layout).length > 0
        ? await collectStatReferenceSources(db, auth.campaignId)
        : { characters: [], catalogEntries: [] },
    );
    if (rejection) return reply.code(409).send(rejection);
    const updatedLayout = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          statLayout: body.layout,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.stat-layout.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        // Ключи, а не раскладка целиком: журнал должен отвечать на вопрос
        // «когда появилась эта строка», не храня копию всей структуры.
        payload: {
          keys: body.layout.flatMap((group) =>
            group.rows.map((row) => row.key),
          ),
        },
      });
      return next;
    });
    if (!updatedLayout)
      return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updatedLayout;
  });

  /**
   * UIX-431 — очередь ходов правится целиком и только мастером.
   *
   * Список приходит с клиента, поэтому каждая ссылка на токен проверяется здесь:
   * рамка выделения на карте отбирает токены по правам на клиенте, но это
   * удобство, а не защита. Токен чужой кампании в очереди дал бы мастеру строку
   * с именем из другой игры.
   */
  app.patch("/api/campaign/initiative", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    // Состав очереди ведёт мастер. Игрок вносит только своё значение — узкой
    // операцией `/api/campaign/initiative/self` ниже.
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = updateInitiativeSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const [replayed] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      return replayed
        ? reply.code(200).send(replayed)
        : reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    }
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    const referenced = body.participants
      .map((participant) => participant.tokenId)
      .filter((tokenId): tokenId is string => Boolean(tokenId));
    if (referenced.length > 0) {
      const known = await db
        .select({ id: tokens.id })
        .from(tokens)
        .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
        .where(
          and(
            eq(scenes.campaignId, auth.campaignId),
            inArray(tokens.id, referenced),
          ),
        );
      const knownIds = new Set(known.map((row) => row.id));
      const foreign = referenced.filter((tokenId) => !knownIds.has(tokenId));
      if (foreign.length > 0)
        return reply
          .code(400)
          .send({ error: "TOKEN_NOT_FOUND", tokenIds: foreign });
    }
    /**
     * UIX-466: порядок — производная от введённых значений, а не отдельное
     * намерение. Раньше его собирали руками, а сортировка была кнопкой; теперь
     * очередь пересобирается после каждой правки.
     *
     * Исключение — строки, закреплённые мастером (`pinned`): они держат своё
     * место, остальные сортируются вокруг них. Закрепление приезжает в составе
     * очереди, поэтому отдельной операции «переставить» нет — есть присланный
     * порядок, который сервер обязан воспроизвести ровно там, где его закрепили.
     *
     * Сортировка живёт здесь, а не на клиенте: значения вносят и мастер, и
     * игрок, и порядок обязан получиться один и тот же у всех — независимо от
     * того, чей клиент прислал правку.
     */
    const ordered = orderInitiative(body.participants);
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          initiative: ordered,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.initiative.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: { participants: body.participants.length },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updated;
  });

  /**
   * UIX-466 — «поставить своей строке значение».
   *
   * Отдельно от маршрута выше, потому что тот принимает очередь целиком, а
   * игрок видит её отфильтрованной: строк противников у него нет, и прислать
   * полный состав он не может физически. Первая попытка дать ему общий маршрут
   * так и провалилась — сервер видел «участники исчезли» и отвечал отказом.
   *
   * Здесь передаётся только намерение, а состав и порядок остаются серверными.
   * Мастеру этот маршрут тоже открыт: свой персонаж есть и у него.
   */
  app.patch("/api/campaign/initiative/self", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = setOwnInitiativeSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });

    const roster = current.initiative ?? [];
    const target = roster.find((row) => row.id === body.participantId);
    if (!target)
      return reply.code(404).send({ error: "PARTICIPANT_NOT_FOUND" });

    /**
     * Право проверяется по персонажу, стоящему за токеном строки, а не по тому,
     * что прислал клиент. Мастеру разрешено всё: он ведёт и NPC.
     */
    if (auth.role !== "GM") {
      if (!target.tokenId)
        return reply.code(403).send({ error: "NOT_YOUR_PARTICIPANT" });
      const [owned] = await db
        .select({ id: tokens.id })
        .from(tokens)
        .innerJoin(
          tokenDefinitions,
          eq(tokens.definitionId, tokenDefinitions.id),
        )
        .innerJoin(characters, eq(tokenDefinitions.characterId, characters.id))
        .leftJoin(
          characterControllers,
          eq(characterControllers.characterId, characters.id),
        )
        .where(
          and(
            eq(tokens.id, target.tokenId),
            eq(characters.campaignId, auth.campaignId),
            or(
              eq(characters.ownerMembershipId, auth.membershipId),
              eq(characterControllers.membershipId, auth.membershipId),
            ),
          ),
        )
        .limit(1);
      if (!owned)
        return reply.code(403).send({ error: "NOT_YOUR_PARTICIPANT" });
    }

    const ordered = orderInitiative(
      roster.map((row) =>
        row.id === body.participantId
          ? { ...row, initiative: body.initiative }
          : row,
      ),
    );
    const updatedSelf = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          initiative: ordered,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.initiative.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: { participants: ordered.length },
      });
      return next;
    });
    if (!updatedSelf)
      return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updatedSelf;
  });

  /**
   * UIX-466 п. 4 — мастер обводит поле боя.
   *
   * Зона живёт отдельно от очереди и переживает бой: `END_BATTLE` очищает
   * состав, но не рамку. На той же карте следующий бой начинается с уже
   * обведённым полем.
   *
   * Сцена в теле не принимается на веру — она обязана существовать и
   * принадлежать этой кампании, иначе зона указывала бы на чужую карту, а
   * пополнение состава по ней молча не находило бы никого.
   */
  app.put("/api/campaign/battle-zone", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    // Поле боя обводит мастер. Игроку эта ручка не нужна и опасна: зоной
    // задаётся, кто вообще участвует в бою.
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = setBattleZoneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    if (body.zone) {
      const [scene] = await db
        .select({ id: scenes.id })
        .from(scenes)
        .where(
          and(
            eq(scenes.id, body.zone.sceneId),
            eq(scenes.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    }
    const updatedZone = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          battleZone: body.zone,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.battle_zone.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: { cleared: body.zone === null },
      });
      return next;
    });
    if (!updatedZone)
      return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updatedZone;
  });

  /**
   * UIX-466 п. 3 — пополнить очередь теми, кто сейчас в зоне.
   *
   * **Добавляет, но не выбрасывает.** Вышедший из зоны остаётся в бою: он мог
   * отступить, а не выйти из боя, и стирать его строку вместе с уже внесённым
   * броском значило бы наказывать за отступление. Убирает участников мастер
   * сам — крестиком в строке.
   *
   * Отдельная операция, а не пересчёт на каждое движение токена: живой состав
   * означал бы, что случайно задетая мышью фигура меняет очередь посреди хода.
   */
  app.post("/api/campaign/initiative/from-zone", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = revisionCommandSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    if (!current.battleZone)
      return reply.code(409).send({ error: "BATTLE_ZONE_NOT_SET" });
    const roster = await recruitFromBattleZone(
      db,
      auth.campaignId,
      current.battleZone,
      current.initiative,
    );
    // Сцена зоны исчезла между её установкой и этим вызовом. Пустой состав
    // выглядел бы как «в зоне никого», и мастер начал бы бой без противников.
    if (!roster)
      return reply.code(409).send({ error: "BATTLE_ZONE_SCENE_MISSING" });
    const updatedRoster = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          initiative: roster,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.initiative.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: {
          participants: roster.length,
          added: roster.length - current.initiative.length,
        },
      });
      return next;
    });
    if (!updatedRoster)
      return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return updatedRoster;
  });

  app.patch("/api/characters/:id/counters", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = characterCountersCommandSchema.parse(request.body);
    const loadCharacter = async () => {
      const [row] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, id),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      return row;
    };
    const canEditCharacter = (
      character: typeof characters.$inferSelect | undefined,
    ) => canAccessCharacter(db, auth, character);
    const sendReplay = async (
      action: NonNullable<Awaited<ReturnType<typeof findAction>>>,
    ) => {
      if (action.type !== "character.counters" || action.entityId !== id)
        return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
      // The action may have committed after this request read the character.
      // Reload after observing the receipt so replay always returns the
      // canonical post-commit revision/wallet, never that stale pre-read row.
      const canonical = await loadCharacter();
      if (!(await canEditCharacter(canonical)))
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
      const assignedEntries = await db
        .select()
        .from(characterCatalogEntries)
        .where(eq(characterCatalogEntries.characterId, id));
      return reply
        .code(200)
        .send(
          characterDto(
            canonical!,
            assignedEntries,
            await characterControllerIds(db, id),
          ),
        );
    };

    // Check the receipt before loading the entity. This ordering guarantees a
    // normal replay reads its character after the original transaction commit.
    const priorAction = await findAction(db, auth.campaignId, body.actionId);
    const character = await loadCharacter();
    if (!(await canEditCharacter(character)))
      return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    if (priorAction) return sendReplay(priorAction);
    if (character!.revision !== body.revision) {
      const racedAction = await findAction(db, auth.campaignId, body.actionId);
      if (racedAction) return sendReplay(racedAction);
      return reply
        .code(409)
        .send({ error: "CHARACTER_CONFLICT", revision: character!.revision });
    }
    const nextResources = body.rest
      ? applyCharacterRest(
          (character!.resources ?? {}) as Resources,
          body.rest,
          normalizeLegacyStats(character!.stats),
        )
      : body.resources;
    let resourceLabels: ReadonlyMap<string, string> = new Map();
    if (nextResources) {
      const [campaign] = await db
        .select({ statLayout: campaigns.statLayout })
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      resourceLabels = resourceLabelsFromLayout(
        resolveStatLayout(campaign?.statLayout),
      );
    }
    const changes = [
      body.wallet
        ? formatWalletChanges(
            normalizeCharacterWallet(character!.wallet),
            body.wallet,
          )
        : "",
      nextResources
        ? formatResourceChanges(
            (character!.resources ?? {}) as Resources,
            nextResources,
            resourceLabels,
          )
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    if (!changes) return reply.code(400).send({ error: "NO_COUNTER_CHANGES" });
    const tableThread = await ensureStreamThread(db, auth.campaignId, "TABLE");
    const walletOnly = Boolean(body.wallet) && !nextResources && !body.rest;
    const walletBefore = normalizeCharacterWallet(character!.wallet);
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(characters)
        .set({
          ...(body.wallet ? { wallet: body.wallet } : {}),
          ...(nextResources ? { resources: nextResources } : {}),
          revision: character!.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(characters.id, id),
            eq(characters.revision, character!.revision),
          ),
        )
        .returning();
      if (!updated) return null;
      const now = new Date();
      const walletData: WalletAuditSystemData | null =
        walletOnly && body.wallet
          ? {
              type: "WALLET_AUDIT",
              before: walletBefore,
              after: body.wallet,
              lastAt: now.toISOString(),
              operationCount: 1,
            }
          : null;
      const [latestMessage] = walletData
        ? await tx
            .select()
            .from(chatMessages)
            .where(eq(chatMessages.threadId, tableThread.id))
            .orderBy(desc(chatMessages.sequence))
            .limit(1)
            .for("update")
        : [];
      const latestWalletData = latestMessage?.systemData;
      const lastAt = isWalletAuditSystemData(latestWalletData)
        ? Date.parse(latestWalletData.lastAt)
        : Number.NaN;
      const elapsed = now.getTime() - lastAt;
      const canAggregate =
        latestMessage?.kind === "SYSTEM" &&
        latestMessage.visibility === "PUBLIC" &&
        latestMessage.membershipId === auth.membershipId &&
        latestMessage.characterId === id &&
        isWalletAuditSystemData(latestWalletData) &&
        elapsed >= 0 &&
        elapsed <= WALLET_AUDIT_BURST_MS;
      const aggregateData: WalletAuditSystemData | null =
        canAggregate && body.wallet
          ? {
              ...latestWalletData,
              after: body.wallet,
              lastAt: now.toISOString(),
              operationCount: latestWalletData.operationCount + 1,
            }
          : null;
      const [message] =
        aggregateData && latestMessage
          ? await tx
              .update(chatMessages)
              .set({
                body: `${character!.name} \u2014 ${formatWalletChanges(
                  aggregateData.before,
                  aggregateData.after,
                )}`,
                systemData: aggregateData,
              })
              .where(eq(chatMessages.id, latestMessage.id))
              .returning()
          : await tx
              .insert(chatMessages)
              .values({
                campaignId: auth.campaignId,
                membershipId: auth.membershipId,
                characterId: id,
                kind: "SYSTEM",
                threadId: tableThread.id,
                visibility: "PUBLIC",
                body: `${character!.name} \u2014 ${changes}`,
                systemData: walletData,
              })
              .returning();
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character.counters",
        entityType: "character",
        entityId: id,
        entityRevision: updated.revision,
        payload: {
          wallet: body.wallet,
          resources: nextResources,
          rest: body.rest,
        },
      });
      return { updated, message };
    });
    if (!result) {
      const racedAction = await findAction(db, auth.campaignId, body.actionId);
      if (racedAction) return sendReplay(racedAction);
      return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    }
    await broadcastSnapshots(io, db, auth.campaignId);
    const assignedEntries = await db
      .select()
      .from(characterCatalogEntries)
      .where(eq(characterCatalogEntries.characterId, id));
    return characterDto(
      result.updated,
      assignedEntries,
      await characterControllerIds(db, id),
    );
  });

  app.post(
    "/api/characters/:characterId/catalog/:entryId/recharge",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
        .parse(request.params);
      const body = rechargeEntryCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const [row] = await db
        .select({ character: characters, entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characters.id, params.characterId),
            eq(characterCatalogEntries.id, params.entryId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!row || !(await canAccessCharacter(db, auth, row.character)))
        return reply.code(403).send({ error: "CHARACTER_ENTRY_FORBIDDEN" });
      if (row.entry.revision !== body.revision)
        return reply
          .code(409)
          .send({ error: "ENTRY_CONFLICT", revision: row.entry.revision });
      const parsed = entryDataSchema.safeParse(
        normalizeLegacyEntryData(row.entry.data),
      );
      if (!parsed.success || !parsed.data.uses)
        return reply.code(400).send({ error: "ENTRY_HAS_NO_USES" });
      const tableThread = await ensureStreamThread(
        db,
        auth.campaignId,
        "TABLE",
      );
      const result = await db.transaction(async (tx) => {
        const [clock] = await tx
          .select({
            day: campaigns.day,
            battleCounter: campaigns.battleCounter,
          })
          .from(campaigns)
          .where(eq(campaigns.id, auth.campaignId))
          .limit(1);
        if (!clock) throw new Error("CAMPAIGN_NOT_FOUND");
        const anchoredUses = {
          ...parsed.data.uses!,
          current: parsed.data.uses!.max,
          ...(parsed.data.uses!.recharge === "DAY" ||
          parsed.data.uses!.recharge === "WEEK"
            ? { lastRechargeDay: clock.day }
            : {}),
          ...(parsed.data.uses!.recharge === "BATTLE"
            ? { lastBattleCounter: clock.battleCounter }
            : {}),
        };
        const [updated] = await tx
          .update(characterCatalogEntries)
          .set({
            data: {
              ...parsed.data,
              uses: anchoredUses,
            },
            revision: row.entry.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characterCatalogEntries.id, row.entry.id),
              eq(characterCatalogEntries.revision, row.entry.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        const [message] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: row.character.id,
            kind: "SYSTEM",
            threadId: tableThread.id,
            visibility: "PUBLIC",
            body: `${auth.displayName}: ${row.entry.name} перезаряжена (${parsed.data.uses!.max}/${parsed.data.uses!.max})`,
          })
          .returning();
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "entry.recharged",
          entityType: "character_catalog_entry",
          entityId: row.entry.id,
          entityRevision: updated.revision,
        });
        return { updated, message };
      });
      if (!result) return reply.code(409).send({ error: "ENTRY_CONFLICT" });
      await broadcastSnapshots(io, db, auth.campaignId);
      return result.updated;
    },
  );

  app.post(
    "/api/characters/:characterId/catalog/:entryId/roll",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
        .parse(request.params);
      const body = entryRollRequestSchema.parse(request.body);
      const mode = body.mode ?? "EXECUTE";
      const replay = await findAction(db, auth.campaignId, body.actionId);
      if (replay) return reply.code(200).send({ duplicate: true });
      if (auth.role !== "GM" && body.visibility === "GM_ONLY")
        return reply.code(403).send({ error: "GM_ONLY_VISIBILITY_FORBIDDEN" });
      const [row] = await db
        .select({ character: characters, entry: characterCatalogEntries })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characters.id, params.characterId),
            eq(characterCatalogEntries.id, params.entryId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!row || !(await canAccessCharacter(db, auth, row.character)))
        return reply.code(403).send({ error: "CHARACTER_ENTRY_FORBIDDEN" });
      if (
        body.entryRevision !== undefined &&
        body.entryRevision !== row.entry.revision
      )
        return reply
          .code(409)
          .send({ error: "ENTRY_CONFLICT", revision: row.entry.revision });
      const parsedData = entryDataSchema.safeParse(
        normalizeLegacyEntryData(row.entry.data),
      );
      if (!parsedData.success)
        return reply.code(400).send({ error: "INVALID_ENTRY_DATA" });
      const rollsThread = await ensureStreamThread(
        db,
        auth.campaignId,
        "ROLLS",
      );
      let action:
        NonNullable<typeof parsedData.data.rollActions>[number] | undefined;
      let formula: string | null = null;
      let result: ReturnType<typeof rollFormulaWithMode> | null = null;
      if (mode === "EXECUTE") {
        action = parsedData.data.rollActions?.find(
          (candidate) => candidate.id === body.rollActionId,
        );
        if (!action)
          return reply.code(404).send({ error: "ROLL_ACTION_NOT_FOUND" });
        const values: Record<string, number> = {};
        const formulaParts = [action.dice];
        for (const [index, source] of action.modifiers.entries()) {
          if (source.type === "CONSTANT") {
            formulaParts.push(String(source.value));
            continue;
          }
          if (source.type === "FORMULA") {
            const terms = source.formula.match(/[+-]?\d+/g);
            if (!terms)
              return reply
                .code(400)
                .send({ error: "INVALID_MODIFIER_FORMULA" });
            formulaParts.push(
              String(terms.reduce((sum, term) => sum + Number(term), 0)),
            );
            continue;
          }
          const key = `modifier_${index}`;
          const value =
            source.type === "CHARACTERISTIC"
              ? normalizeLegacyStats(row.character.stats)[source.key]
              : parsedData.data.values?.[source.key];
          if (value === undefined || !Number.isFinite(value))
            return reply
              .code(400)
              .send({ error: "MISSING_MODIFIER_SOURCE", source });
          values[key] = value;
          formulaParts.push(key);
        }
        formula = formulaParts.join(" + ");
        result = rollFormulaWithMode(
          formula,
          values,
          body.rollMode ?? (action.advantage ? "ADVANTAGE" : "NORMAL"),
          randomInt,
          action.label,
        );
        if (
          action.consumeUse &&
          (!parsedData.data.uses || parsedData.data.uses.current < 1)
        )
          return reply.code(409).send({ error: "NO_ABILITY_USES" });
      }
      const cost = mode === "EXECUTE" ? action?.cost : undefined;
      const resourceKey =
        cost?.type === "physical"
          ? "physicalPower"
          : cost?.type === "magic"
            ? "magicPower"
            : null;
      const resources = normalizeCharacterResources(row.character.resources);
      const resourceBefore = resourceKey
        ? (resources[resourceKey]?.current ?? 0)
        : null;
      if (cost && resourceBefore !== null && resourceBefore < cost.amount)
        return reply.code(409).send({
          error: "INSUFFICIENT_CHARACTER_RESOURCE",
          resource: cost.type,
          required: cost.amount,
          available: resourceBefore,
        });
      const afterResources =
        cost && resourceKey && resourceBefore !== null
          ? {
              ...resources,
              [resourceKey]: {
                ...resources[resourceKey],
                current: resourceBefore - cost.amount,
              },
            }
          : resources;
      const uses = parsedData.data.uses;
      const afterUses =
        mode === "EXECUTE" && action?.consumeUse && uses
          ? { ...uses, current: uses.current - 1 }
          : uses;
      const skillCard = {
        version: 1 as const,
        execution:
          mode === "EXECUTE" ? ("EXECUTED" as const) : ("SHARED" as const),
        entry: {
          id: row.entry.id,
          revision: row.entry.revision,
          sourceCatalogEntryId: row.entry.sourceCatalogEntryId,
          kind: row.entry.kind,
          name: row.entry.name,
          description: row.entry.description,
          notes: parsedData.data.notes ?? null,
        },
        actor: {
          membershipId: auth.membershipId,
          displayName: auth.displayName,
          characterId: row.character.id,
          characterName: row.character.name,
        },
        action: action
          ? {
              id: action.id,
              kind: action.kind,
              label: action.label,
              dice: action.dice,
              advantage: action.advantage,
              consumeUse: action.consumeUse,
              cost: action.cost,
            }
          : null,
        formula,
        result,
        uses: uses
          ? {
              before: uses.current,
              after: afterUses!.current,
              max: uses.max,
              recharge: uses.recharge,
            }
          : null,
        visibility: body.visibility,
      };
      let saved: {
        message: typeof chatMessages.$inferSelect;
        event: typeof gameEvents.$inferSelect;
      } | null;
      try {
        saved = await db.transaction(async (tx) => {
          if (cost && resourceKey) {
            const [resourceUpdated] = await tx
              .update(characters)
              .set({
                resources: afterResources,
                revision: row.character.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(characters.id, row.character.id),
                  eq(characters.revision, row.character.revision),
                ),
              )
              .returning({ id: characters.id });
            if (!resourceUpdated) return null;
          }
          if (mode === "EXECUTE" && action?.consumeUse) {
            const [updated] = await tx
              .update(characterCatalogEntries)
              .set({
                data: { ...parsedData.data, uses: afterUses! },
                revision: row.entry.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(characterCatalogEntries.id, row.entry.id),
                  eq(characterCatalogEntries.revision, row.entry.revision),
                ),
              )
              .returning({ id: characterCatalogEntries.id });
            if (!updated) return null;
          }
          const [message] = await tx
            .insert(chatMessages)
            .values({
              campaignId: auth.campaignId,
              membershipId: auth.membershipId,
              characterId: row.character.id,
              kind: "DICE",
              threadId: rollsThread.id,
              visibility: body.visibility,
              body: [
                action?.label ?? row.entry.name,
                row.entry.description,
                parsedData.data.notes,
              ]
                .filter(Boolean)
                .join(" - "),
              dice: result ? { ...result, skillCard } : { skillCard },
            })
            .returning();
          if (!message) throw new Error("ROLL_SAVE_FAILED");
          const [event] = await tx
            .insert(gameEvents)
            .values({
              campaignId: auth.campaignId,
              actionId: body.actionId,
              membershipId: auth.membershipId,
              type: mode === "EXECUTE" ? "entry.roll" : "entry.shared",
              entityType: "chat",
              entityId: message.id,
              entityRevision:
                mode === "EXECUTE" && action?.consumeUse
                  ? row.entry.revision + 1
                  : row.entry.revision,
              payload: {
                skillCard,
                messageId: message.id,
                resourceCost: cost
                  ? {
                      type: cost.type,
                      amount: cost.amount,
                      before: resourceBefore,
                      after: resourceBefore! - cost.amount,
                    }
                  : null,
              },
            })
            .returning();
          if (!event) throw new Error("EVENT_RECORD_FAILED");
          return { message, event };
        });
      } catch (error) {
        // A concurrent retry may lose only at the unique action receipt. The
        // transaction rolls back its message/resource changes, then replay it.
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505" &&
          (await findAction(db, auth.campaignId, body.actionId))
        )
          return reply.code(200).send({ duplicate: true });
        throw error;
      }
      if (!saved) {
        // A concurrent request with this same action can commit between our
        // preflight receipt lookup and the entry CAS. Its receipt is the
        // authoritative idempotent result; only a different stale action is
        // an optimistic-concurrency conflict.
        if (await findAction(db, auth.campaignId, body.actionId))
          return reply.code(200).send({ duplicate: true });
        return reply.code(409).send({ error: "ENTRY_CONFLICT" });
      }
      const dto = chatMessageDto(
        saved.message,
        auth.displayName,
        rollsThread.stream,
      );
      const envelope = {
        sequence: Number(saved.event.sequence),
        actionId: body.actionId,
        emittedAt: saved.event.createdAt.toISOString(),
        data: dto,
      };
      if (chatBroadcastAudience(saved.message.visibility) === "CAMPAIGN")
        io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      else {
        io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
        io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
      }
      await broadcastSnapshots(io, db, auth.campaignId);
      return reply
        .code(201)
        .send({ ...(result ?? {}), skillCard, messageId: saved.message.id });
    },
  );

  app.post("/api/dice", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = diceRequestSchema.parse(request.body);
    const rollsThread = await ensureStreamThread(db, auth.campaignId, "ROLLS");
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    let character = null;
    if (body.characterId) {
      [character] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character || !(await canAccessCharacter(db, auth, character)))
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    } else if (auth.role === "PLAYER") {
      [character] = await db
        .select({ character: characters })
        .from(characters)
        .leftJoin(
          characterControllers,
          eq(characterControllers.characterId, characters.id),
        )
        .where(
          and(
            eq(characters.campaignId, auth.campaignId),
            or(
              eq(characters.ownerMembershipId, auth.membershipId),
              eq(characterControllers.membershipId, auth.membershipId),
            ),
          ),
        )
        .orderBy(
          desc(sql`${characters.ownerMembershipId} = ${auth.membershipId}`),
        )
        .limit(1)
        .then((rows) => rows.map((row) => row.character));
    }
    try {
      const normalizedFormula = normalizeLegacyFormula(body.formula);
      const modeLabel =
        body.rollMode === "ADVANTAGE"
          ? "преимущество"
          : body.rollMode === "DISADVANTAGE"
            ? "помеха"
            : null;
      const rollLabel = `${body.label ?? body.formula}${modeLabel ? ` · ${modeLabel}` : ""}`;
      const result = rollFormulaWithMode(
        normalizedFormula,
        normalizeLegacyStats(character?.stats),
        body.rollMode ?? "NORMAL",
        randomInt,
        rollLabel,
      );
      const saved = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: character?.id ?? null,
            kind: "DICE",
            threadId: rollsThread.id,
            visibility: body.visibility,
            body: rollLabel,
            dice: result,
          })
          .returning();
        if (!row) throw new Error("ROLL_SAVE_FAILED");
        const dto = chatMessageDto(row, auth.displayName, rollsThread.stream);
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: "dice.created",
            entityType: "chat",
            entityId: row.id,
            payload: dto,
          })
          .returning();
        if (!event) throw new Error("EVENT_RECORD_FAILED");
        return { row, dto, event };
      });
      const { row, dto, event } = saved;
      const envelope = {
        sequence: Number(event.sequence),
        actionId: body.actionId,
        emittedAt: event.createdAt.toISOString(),
        data: dto,
      };
      if (chatBroadcastAudience(row.visibility) === "CAMPAIGN")
        io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      else {
        io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
        io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
      }
      return reply.code(201).send(dto);
    } catch (error) {
      if (error instanceof DiceFormulaError)
        return reply
          .code(400)
          .send({ error: "INVALID_DICE_FORMULA", message: error.message });
      throw error;
    }
  });

  app.post("/api/assets/:sourceAssetId/token", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { sourceAssetId } = z
      .object({ sourceAssetId: z.string().uuid() })
      .parse(request.params);
    const actionId = actionIdSchema.parse(request.headers["x-action-id"]);
    const body = generateTokenAssetSchema.parse(request.body);

    const replayAsset = async () => {
      const event = await findAction(db, auth.campaignId, actionId);
      if (
        !event ||
        event.membershipId !== auth.membershipId ||
        event.type !== "asset.created" ||
        event.entityType !== "asset" ||
        !event.entityId ||
        !event.payload ||
        typeof event.payload !== "object" ||
        !("sourceAssetId" in event.payload) ||
        event.payload.sourceAssetId !== sourceAssetId
      )
        return null;
      const [asset] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, event.entityId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      return asset ?? null;
    };
    const dto = (asset: typeof assets.$inferSelect) => ({
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
    });

    const replay = await replayAsset();
    if (replay) return reply.code(200).send(dto(replay));
    if (await findAction(db, auth.campaignId, actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });

    const [source] = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, sourceAssetId),
          eq(assets.campaignId, auth.campaignId),
          eq(assets.kind, "IMAGE"),
        ),
      )
      .limit(1);
    if (!source)
      return reply.code(404).send({ error: "SOURCE_IMAGE_NOT_FOUND" });

    let stored: Awaited<ReturnType<typeof storeGeneratedToken>> | undefined;
    let committed = false;
    try {
      const sourceBuffer = await readStoredImage(source.storageKey);
      const rendered = await renderTokenAsset(sourceBuffer, body);
      const [usage] = await db
        .select({ used: sum(assets.sizeBytes) })
        .from(assets)
        .where(eq(assets.campaignId, auth.campaignId));
      await assertStorageCapacity(Number(usage?.used ?? 0), rendered.length);
      stored = await storeGeneratedToken(rendered);
      const created = await db.transaction(async (tx) => {
        // Serialize the final quota check so concurrent derivatives cannot
        // jointly push the campaign beyond its configured media allowance.
        await tx.execute(
          sql`select id from campaigns where id = ${auth.campaignId} for update`,
        );
        const [lockedUsage] = await tx
          .select({ used: sum(assets.sizeBytes) })
          .from(assets)
          .where(eq(assets.campaignId, auth.campaignId));
        assertStorageQuota(Number(lockedUsage?.used ?? 0), stored!.sizeBytes);
        const [asset] = await tx
          .insert(assets)
          .values({
            campaignId: auth.campaignId,
            uploadedByMembershipId: auth.membershipId,
            kind: "TOKEN",
            name:
              body.name ?? `${source.name.slice(0, 94)} token`.slice(0, 100),
            ...stored!,
          })
          .returning();
        if (!asset) throw new Error("ASSET_CREATE_FAILED");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "asset.created",
          entityType: "asset",
          entityId: asset.id,
          payload: {
            assetId: asset.id,
            kind: asset.kind,
            sourceAssetId,
            transform: body,
          },
        });
        return asset;
      });
      committed = true;
      await broadcastSnapshots(io, db, auth.campaignId);
      return reply.code(201).send(dto(created));
    } catch (error) {
      // Once the transaction commits, the file is authoritative media and
      // must survive best-effort realtime notification failures.
      if (committed) throw error;
      if (stored) await removeStoredUpload(stored.storageKey);
      const concurrentReplay = await replayAsset();
      if (concurrentReplay) return reply.code(200).send(dto(concurrentReplay));
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return reply
          .code(404)
          .send({ error: "SOURCE_IMAGE_CONTENT_NOT_FOUND" });
      const errorCode = publicUploadError(error);
      request.log.warn(
        { errorCode, actionId },
        "asset.token_generation_rejected",
      );
      return reply.code(400).send({ error: errorCode });
    }
  });

  app.post("/api/assets", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = z.object({ kind: assetKindSchema }).parse(request.query);
    if (auth.role !== "GM" && !["TOKEN", "PORTRAIT"].includes(query.kind))
      return reply.code(403).send({ error: "ASSET_FORBIDDEN" });
    const actionId = actionIdSchema.parse(request.headers["x-action-id"]);
    const duplicate = await findAction(db, auth.campaignId, actionId);
    if (duplicate?.entityId) {
      const [existing] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, duplicate.entityId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (existing) return reply.code(200).send(existing);
    }
    const file = await request.file({
      limits: {
        fileSize:
          query.kind === "AUDIO" ? env.MAX_AUDIO_BYTES : env.MAX_IMAGE_BYTES,
        files: 1,
      },
    });
    if (!file) return reply.code(400).send({ error: "FILE_REQUIRED" });
    const buffer = await file.toBuffer();
    const [usage] = await db
      .select({ used: sum(assets.sizeBytes) })
      .from(assets)
      .where(eq(assets.campaignId, auth.campaignId));
    await assertStorageCapacity(Number(usage?.used ?? 0), buffer.length);
    try {
      const stored = await storeUpload(
        buffer,
        query.kind === "AUDIO" ? "audio" : "image",
      );
      const asset = await db
        .transaction(async (tx) => {
          const [created] = await tx
            .insert(assets)
            .values({
              campaignId: auth.campaignId,
              uploadedByMembershipId: auth.membershipId,
              kind: query.kind,
              name: displayNameFromUpload(file.filename),
              ...stored,
            })
            .returning();
          if (!created) throw new Error("ASSET_CREATE_FAILED");
          await tx.insert(gameEvents).values({
            campaignId: auth.campaignId,
            actionId,
            membershipId: auth.membershipId,
            type: "asset.created",
            entityType: "asset",
            entityId: created.id,
            payload: { assetId: created.id, kind: created.kind },
          });
          return created;
        })
        .catch(async (error) => {
          await removeStoredUpload(stored.storageKey);
          throw error;
        });
      await broadcastSnapshots(io, db, auth.campaignId);
      return reply.code(201).send(asset);
    } catch (error) {
      const errorCode = publicUploadError(error);
      request.log.warn({ errorCode, actionId }, "asset.upload_rejected");
      return reply.code(400).send({ error: errorCode });
    }
  });

  app.get("/api/assets/:id/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [asset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
      .limit(1);
    if (!asset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    if (auth.role !== "GM") {
      const snapshot = await buildSnapshot(db, auth);
      if (!snapshot.assets.some((visible) => visible.id === asset.id))
        return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    }
    try {
      const file = await openStoredFile(
        asset.storageKey,
        request.headers.range,
      );
      const etag = assetContentVersion(asset.storageKey);
      reply.header("ETag", etag);
      reply.header("Cache-Control", "private, no-cache");
      if (request.headers["if-none-match"] === etag) {
        file.stream.destroy();
        return reply.code(304).send();
      }
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Type", asset.mimeType);
      reply.header("Content-Length", String(file.end - file.start + 1));
      if (file.partial) {
        reply.code(206);
        reply.header(
          "Content-Range",
          `bytes ${file.start}-${file.end}/${file.size}`,
        );
      }
      return reply.send(file.stream);
    } catch (error) {
      if (errorMessage(error) === "INVALID_RANGE")
        return reply.code(416).send({ error: "INVALID_RANGE" });
      // UIX-474: строка в `assets` есть, файла по ней нет. Клиенту это по-
      // прежнему 404 — показать нечего, — но в журнале сервера случай обязан
      // быть отличим от «такого ассета нет». Именно из-за неразличимости
      // вопрос «битая запись или потерянный файл» пришлось разбирать в
      // браузере: снаружи оба ответа выглядели одинаково.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        request.log.warn(
          { assetId: asset.id, storageKey: asset.storageKey },
          "asset.content_missing",
        );
        return reply.code(404).send({ error: "ASSET_CONTENT_NOT_FOUND" });
      }
      // Отказ прав, каталог вместо файла, сбой диска — это не «нет файла».
      // Раньше всё это превращалось в 404, и авария хранилища выглядела
      // потерянным ассетом: чинили бы не то.
      request.log.error(
        { assetId: asset.id, storageKey: asset.storageKey, error },
        "asset.content_unreadable",
      );
      return reply.code(500).send({ error: "ASSET_CONTENT_UNREADABLE" });
    }
  });
}
