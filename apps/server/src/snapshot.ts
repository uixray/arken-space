import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  max,
  ne,
  or,
} from "drizzle-orm";
import { starterStatLayout } from "@arken/system";
import {
  fogHiddenTokenIds,
  statLayoutSchema,
  type StatLayout,
} from "@arken/contracts";
import {
  assets,
  campaigns,
  catalogEntries,
  characterCatalogEntries,
  characterControllers,
  characters,
  chatMessages,
  chatReadCursors,
  chatThreads,
  drawings,
  fogReveals,
  gameEvents,
  memberships,
  scenes,
  tokens,
  tokenControllers,
  tokenDefinitions,
} from "@arken/db";
import type { AuthContext } from "./auth.js";
import type { CatalogEntryDto, GameSnapshot } from "@arken/contracts";
import { env } from "./env.js";
import { normalizeLegacyEntryData } from "./entry-data.js";
import { normalizeAudioTrackDeadlines } from "./audio-state.js";
import {
  chatVisibilityFilter,
  canAccessStream,
  unknownPlayerDisplayName,
} from "./chat.js";
import { buildWorldMapsSnapshot } from "./world-maps.js";
import { characterDto } from "./character-dto.js";
import { projectChatMessages } from "./chat-history.js";
import { resolveTokenName } from "./token-name.js";
import { projectInitiative } from "./initiative.js";
import { listVisiblePlayerRequests } from "./player-requests.js";
import { listEncounters } from "./encounters.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/**
 * UIX-424: раскладка приходит из `jsonb`, то есть может быть чем угодно —
 * написанным старой версией, поправленным руками в базе, недописанным. Поэтому
 * она разбирается схемой, а не приводится к типу: неверная раскладка иначе
 * молча уехала бы всем клиентам и сломала карточку у каждого.
 *
 * Пустая колонка — это кампания, созданная до появления раскладки. Стартовая
 * подставляется при чтении, а не миграцией данных: такая кампания ничем не
 * отличается от новой, и записывать ей копию значения по умолчанию незачем.
 */
/**
 * UIX-450 — сколько последних сообщений потока едет в снапшоте.
 *
 * Было 200 на поток, и это давало две трети всего трафика рассылки: 1 726 КБ
 * из 2 580 на боевых данных, по 246 КБ каждому сокету на каждое движение
 * токена. Потоков минимум три — их создаёт триггер при вставке кампании, —
 * значит потолок был шестьсот сообщений на сборку, семь раз за действие.
 *
 * Двадцать, а не ноль: лента при подключении не должна быть пустой, и
 * реконнект не должен выглядеть как потеря переписки. Остальное подгружается
 * маршрутом `/api/chat/threads/:threadId/messages` по кнопке.
 */
export const SNAPSHOT_MESSAGES_PER_THREAD = 20;

/** Заведомо несуществующая сцена: см. `canvasSceneIds` ниже. */
const NO_SCENE = "00000000-0000-0000-0000-000000000000";

export function resolveStatLayout(stored: unknown): StatLayout {
  const parsed = statLayoutSchema.safeParse(stored);
  if (parsed.success && parsed.data.length > 0) return parsed.data;
  return statLayoutSchema.parse(starterStatLayout);
}

/**
 * UIX-409 — чтения, зависящие только от кампании.
 *
 * **Не принимает `auth` намеренно.** Внутри физически нечем отфильтровать по
 * членству, и это проверяется одной сигнатурой, а не внимательностью: набор,
 * который нельзя персонализировать, нельзя и персонализировать неправильно.
 *
 * Набор помнит свою кампанию — `buildSnapshot` сверяет и падает при
 * расхождении. Живёт он только внутри одного вызова рассылки: кеша со временем
 * жизни здесь нет и не будет, у него нет естественной границы инвалидации и
 * есть все шансы пережить мутацию.
 */
export interface CampaignReadSet {
  campaignId: string;
  memberRows: Awaited<ReturnType<typeof loadMembers>>;
  characterRows: Awaited<ReturnType<typeof loadCharacters>>;
  characterControllerRows: Awaited<ReturnType<typeof loadCharacterControllers>>;
  sceneRows: Awaited<ReturnType<typeof loadScenes>>;
  tokenRows: Awaited<ReturnType<typeof loadTokens>>;
  controllerRows: Awaited<ReturnType<typeof loadTokenControllers>>;
  definitionRows: Awaited<ReturnType<typeof loadTokenDefinitions>>;
  catalogRows: Awaited<ReturnType<typeof loadCatalog>>;
  assignedRows: Awaited<ReturnType<typeof loadAssignedEntries>>;
  assetRows: Awaited<ReturnType<typeof loadAssets>>;
  sequenceRows: Awaited<ReturnType<typeof loadSequence>>;
  /**
   * UIX-409: нормализация дедлайнов аудио — это **запись** в БД внутри пути
   * чтения. При рассылке она выполнялась семь раз одновременно; CAS спасал
   * данные, но шесть из семи попыток проваливали `update` и уходили в лишний
   * `select`. Одна нормализация на рассылку — и экономия, и снятая гонка, и
   * совпадающий `updatedAt` во всех семи снапшотах.
   */
  audioTracks: Awaited<ReturnType<typeof normalizeAudioTrackDeadlines>>;
}

const loadMembers = (db: Database, campaignId: string) =>
  db
    .select()
    .from(memberships)
    .where(eq(memberships.campaignId, campaignId))
    .orderBy(asc(memberships.createdAt));

const loadCharacters = (db: Database, campaignId: string) =>
  db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.campaignId, campaignId),
        eq(characters.lifecycle, "ACTIVE"),
      ),
    )
    .orderBy(asc(characters.createdAt));

const loadCharacterControllers = (db: Database, campaignId: string) =>
  db
    .select({ controller: characterControllers })
    .from(characterControllers)
    .innerJoin(characters, eq(characterControllers.characterId, characters.id))
    .where(
      and(
        eq(characters.campaignId, campaignId),
        eq(characters.lifecycle, "ACTIVE"),
      ),
    );

const loadScenes = (db: Database, campaignId: string) =>
  db
    .select()
    .from(scenes)
    .where(eq(scenes.campaignId, campaignId))
    .orderBy(asc(scenes.createdAt));

const loadTokens = (db: Database, campaignId: string) =>
  db
    .select({ token: tokens, definition: tokenDefinitions })
    .from(tokens)
    .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
    .innerJoin(tokenDefinitions, eq(tokens.definitionId, tokenDefinitions.id))
    .where(eq(scenes.campaignId, campaignId));

const loadTokenControllers = (db: Database, campaignId: string) =>
  db
    .select()
    .from(tokenControllers)
    .innerJoin(
      tokenDefinitions,
      eq(tokenControllers.tokenDefinitionId, tokenDefinitions.id),
    )
    .where(eq(tokenDefinitions.campaignId, campaignId));

const loadTokenDefinitions = (db: Database, campaignId: string) =>
  db
    .select()
    .from(tokenDefinitions)
    .where(eq(tokenDefinitions.campaignId, campaignId))
    .orderBy(asc(tokenDefinitions.createdAt));

const loadCatalog = (db: Database, campaignId: string) =>
  db
    .select()
    .from(catalogEntries)
    .where(eq(catalogEntries.campaignId, campaignId))
    .orderBy(asc(catalogEntries.createdAt));

const loadAssignedEntries = (db: Database, campaignId: string) =>
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
    .where(eq(characters.campaignId, campaignId));

const loadAssets = (db: Database, campaignId: string) =>
  db
    .select()
    .from(assets)
    .where(eq(assets.campaignId, campaignId))
    .orderBy(desc(assets.createdAt));

const loadSequence = (db: Database, campaignId: string) =>
  db
    .select({ value: max(gameEvents.sequence) })
    .from(gameEvents)
    .where(eq(gameEvents.campaignId, campaignId));

export async function loadCampaignReadSet(
  db: Database,
  campaignId: string,
): Promise<CampaignReadSet> {
  const [
    memberRows,
    characterRows,
    characterControllerRows,
    sceneRows,
    tokenRows,
    controllerRows,
    definitionRows,
    catalogRows,
    assignedRows,
    assetRows,
    sequenceRows,
    audioTracks,
  ] = await Promise.all([
    loadMembers(db, campaignId),
    loadCharacters(db, campaignId),
    loadCharacterControllers(db, campaignId),
    loadScenes(db, campaignId),
    loadTokens(db, campaignId),
    loadTokenControllers(db, campaignId),
    loadTokenDefinitions(db, campaignId),
    loadCatalog(db, campaignId),
    loadAssignedEntries(db, campaignId),
    loadAssets(db, campaignId),
    loadSequence(db, campaignId),
    normalizeAudioTrackDeadlines(db, campaignId),
  ]);
  return {
    campaignId,
    memberRows,
    characterRows,
    characterControllerRows,
    sceneRows,
    tokenRows,
    controllerRows,
    definitionRows,
    catalogRows,
    assignedRows,
    assetRows,
    sequenceRows,
    audioTracks,
  };
}

export async function buildSnapshot(
  db: Database,
  auth: AuthContext,
  /**
   * UIX-408 — сцены сверх активной, туман и рисунки которых нужны этому
   * зрителю. На практике это одна сцена: та, которую мастер рассматривает, не
   * переключая игроков (`scene:view`).
   *
   * Пусто по умолчанию, поэтому все шесть прочих вызовов `buildSnapshot`
   * (bootstrap, диагностика, предпросмотр глазами игрока, проверка доступа к
   * файлу) работают без правок.
   */
  extraSceneIds: readonly string[] = [],
  /**
   * UIX-409 — кампанийные чтения, сделанные один раз на всю рассылку.
   *
   * Не передан — снапшот читает сам, как и раньше. Поэтому все шесть прочих
   * вызовов (bootstrap, диагностика, предпросмотр глазами игрока, проверка
   * доступа к файлу) работают без единой правки.
   */
  readSet?: CampaignReadSet,
): Promise<GameSnapshot> {
  // Сверка до любой работы: набор чужой кампании обязан упасть здесь, а не
  // растворить чужие строки в проекции.
  if (readSet && readSet.campaignId !== auth.campaignId)
    throw new Error("CAMPAIGN_READ_SET_MISMATCH");

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, auth.campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found");

  /**
   * UIX-408 — сцены, чей канвас нужен этому зрителю.
   *
   * Игроку это ровно транслируемая сцена. Мастеру — она же плюс та, которую
   * он рассматривает: две из шести, а не «все на всякий случай». Раньше
   * тянулись все, а лишнее отсеивалось уже в DTO — 270 записей тумана и 114
   * рисунков читались на каждый из семи сокетов при каждом действии.
   *
   * Пустой список сюда попасть не должен: `inArray` по пустому массиву — это
   * запрос, который никогда ничего не вернёт, и туман пропал бы у всех.
   */
  const canvasSceneIds = [
    ...new Set(
      [
        campaign.activeSceneId,
        ...(auth.role === "GM" ? extraSceneIds : []),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  // У кампании без активной сцены канвас показывать нечего; заведомо пустой
  // идентификатор оставляет запрос корректным и результат пустым.
  if (canvasSceneIds.length === 0) canvasSceneIds.push(NO_SCENE);

  /**
   * UIX-409 — кампанийные чтения берутся из общего набора, если его дали.
   *
   * Одна рассылка строит семь снапшотов, и около половины запросов в каждом
   * зависят только от кампании: 239 запросов на рассылку при пуле в десять
   * соединений — это очередь, а не работа, и время рассылки складывается
   * именно из неё.
   *
   * Туман и рисунки в общий набор **не входят**: после UIX-408 их выборка
   * зависит от того, какую сцену рассматривает конкретный зритель.
   */
  const shared = readSet ?? (await loadCampaignReadSet(db, auth.campaignId));
  const {
    memberRows,
    characterRows,
    characterControllerRows,
    sceneRows,
    tokenRows,
    controllerRows,
    definitionRows,
    catalogRows,
    assignedRows,
    assetRows,
    sequenceRows,
    audioTracks: normalizedAudioTracks,
  } = shared;

  const [fogRows, drawingRows, threadRows, cursorRows, playerRequestRows] =
    await Promise.all([
      db
        .select({ fog: fogReveals })
        .from(fogReveals)
        // `innerJoin` остаётся: у `fog_reveals` нет колонки кампании, и
        // принадлежность определяется только через сцену. Замена join'а на
        // отбор по списку id сняла бы единственную проверку арендатора.
        .innerJoin(scenes, eq(fogReveals.sceneId, scenes.id))
        .where(
          and(
            eq(scenes.campaignId, auth.campaignId),
            inArray(fogReveals.sceneId, canvasSceneIds),
          ),
        )
        .orderBy(asc(fogReveals.sequence)),
      db
        .select({ drawing: drawings })
        .from(drawings)
        .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
        .where(
          and(
            eq(scenes.campaignId, auth.campaignId),
            inArray(drawings.sceneId, canvasSceneIds),
          ),
        )
        .orderBy(asc(drawings.createdAt)),
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
      listVisiblePlayerRequests(db, auth),
    ]);

  const worldMapProjection = await buildWorldMapsSnapshot(db, auth);
  const encounterRows = await listEncounters(db, auth.campaignId);

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
        .limit(SNAPSHOT_MESSAGES_PER_THREAD),
    ),
  );
  const visiblePlayerRequestIds = new Set(
    playerRequestRows.map((request) => request.id),
  );
  const messageRows = visibleThreadRows.flatMap((thread, index) =>
    (messageGroups[index] ?? []).map((message) => ({ message, thread })),
  );
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
            ne(chatMessages.membershipId, auth.membershipId),
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
  // UIX-400: имена всех персонажей кампании, включая архивных, — определение
  // токена может ссылаться на архивного, и подпись у него должна остаться.
  const characterNameById = new Map(
    characterRows.map((character) => [character.id, character.name]),
  );
  const memberNameById = new Map(
    memberRows.map((member) => [member.id, member.displayName]),
  );
  const me = memberRows.find((member) => member.id === auth.membershipId);
  if (!me) throw new Error("Membership not found");
  const audio = normalizedAudioTracks[0];
  const snapshotVersion = Number(sequenceRows[0]?.value ?? 0);
  const visibleScenes =
    auth.role === "GM"
      ? sceneRows
      : sceneRows.filter((scene) => scene.id === campaign.activeSceneId);
  const visibleSceneIds = new Set(visibleScenes.map((scene) => scene.id));
  const controllersByCharacter = new Map<string, string[]>();
  for (const { controller } of characterControllerRows) {
    const list = controllersByCharacter.get(controller.characterId) ?? [];
    list.push(controller.membershipId);
    controllersByCharacter.set(controller.characterId, list);
  }
  const visibleCharacters =
    auth.role === "GM"
      ? characterRows
      : characterRows.filter(
          (character) =>
            character.ownerMembershipId === auth.membershipId ||
            controllersByCharacter
              .get(character.id)
              ?.includes(auth.membershipId),
        );
  const allowedTokens = tokenRows.filter(
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

  /**
   * UIX-449 — токен целиком под туманом игроку не отправляется вовсе.
   *
   * Раньше туман скрывал его только на отрисовке, а координаты уходили: игрок,
   * открывший devtools, видел, где стоит засада и сколько там юнитов. Правило
   * скрытия — то же самое, что у рендера (`fogHiddenTokenIds` из контракта), а
   * не вторая его копия: разойдясь, они дали бы либо утечку, либо токен,
   * пропавший с экрана без причины.
   *
   * Частично вышедший из тумана токен по-прежнему отправляется и рисуется
   * частично — правило UIX-426 не трогаем.
   *
   * Порядок операций тумана значим (поздние перекрывают ранние), поэтому
   * группировка идёт по уже отсортированным строкам.
   */
  const revealsByScene = new Map<string, (typeof fogRows)[number]["fog"][]>();
  for (const { fog } of fogRows) {
    const list = revealsByScene.get(fog.sceneId) ?? [];
    list.push(fog);
    revealsByScene.set(fog.sceneId, list);
  }
  const hiddenByFog = new Set<string>();
  if (auth.role !== "GM")
    for (const sceneId of new Set(
      allowedTokens.map(({ token }) => token.sceneId),
    )) {
      const sceneTokens = allowedTokens
        .filter(({ token }) => token.sceneId === sceneId)
        .map(({ token, definition }) => ({
          id: token.id,
          x: token.x,
          y: token.y,
          width: token.width,
          height: token.height,
          controllerMembershipIds:
            controllersByDefinition.get(definition.id) ?? [],
        }));
      for (const id of fogHiddenTokenIds(
        sceneTokens,
        revealsByScene.get(sceneId) ?? [],
        { role: auth.role, membershipId: auth.membershipId },
      ))
        hiddenByFog.add(id);
    }
  const visibleTokens = allowedTokens.filter(
    ({ token }) => !hiddenByFog.has(token.id),
  );
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
  for (const track of normalizedAudioTracks) {
    if (track.assetId) visibleAssetIds.add(track.assetId);
  }
  for (const assetId of worldMapProjection.backgroundAssetIds)
    visibleAssetIds.add(assetId);
  const visibleAssets =
    auth.role === "GM"
      ? assetRows
      : assetRows.filter(
          (asset) =>
            visibleAssetIds.has(asset.id) ||
            (asset.uploadedByMembershipId === auth.membershipId &&
              (asset.kind === "TOKEN" || asset.kind === "PORTRAIT")),
        );

  // UIX-450: та же проекция, что отдаёт маршрут истории. Копия этих четырёх
  // проверок видимости разошлась бы с оригиналом в сторону «показали лишнее».
  const projectedMessages = await projectChatMessages(db, auth, {
    rows: messageRows,
    memberNameById,
    visiblePlayerRequestIds,
  });

  /**
   * UIX-431: очередь ходов опирается на уже посчитанный набор видимых токенов —
   * тот же, что отдаётся в `tokens`. Своей проверки видимости у панели нет
   * намеренно: разойдясь с этой, она либо выдала бы засаду, либо потеряла
   * участника, стоящего на виду.
   */
  const visibleTokenNames = new Map(
    visibleTokens.map(({ token, definition }) => [
      token.id,
      resolveTokenName({
        name: definition.name,
        characterName: characterNameById.get(definition.characterId ?? ""),
      }),
    ]),
  );

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      day: campaign.day,
      battleActive: campaign.battleActive,
      battleCounter: campaign.battleCounter,
      statLayout: resolveStatLayout(campaign.statLayout),
      initiative: projectInitiative(campaign.initiative ?? [], {
        visibleTokenNames,
        role: auth.role,
      }),
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
    directChatContacts: memberRows
      .filter((member) => member.id !== auth.membershipId)
      .map((member) => ({
        membershipId: member.id,
        displayName: member.displayName,
      })),
    characters: visibleCharacters.map((character) =>
      characterDto(
        character,
        entriesByCharacter.get(character.id) ?? [],
        auth.role === "GM"
          ? (controllersByCharacter.get(character.id) ?? [])
          : (controllersByCharacter.get(character.id) ?? []).filter(
              (id) => id === auth.membershipId,
            ),
      ),
    ),
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
        // UIX-400: имя разрешается в одном месте — здесь. Собственное, либо
        // унаследованное от персонажа.
        name: resolveTokenName({
          name: definition.name,
          characterName: characterNameById.get(definition.characterId ?? ""),
        }),
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
      name: resolveTokenName({
        name: definition.name,
        characterName: characterNameById.get(definition.characterId ?? ""),
      }),
      ownName: definition.name,
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
        geometry: fog.geometry,
        bbox: fog.bbox,
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
        strokeWidth: drawing.strokeWidth,
        x: drawing.x,
        y: drawing.y,
        revision: drawing.revision,
      })),
    worldMaps: worldMapProjection.snapshot,
    playerRequests: playerRequestRows,
    encounters: encounterRows,
    messages: projectedMessages,
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
    audioTracks: normalizedAudioTracks.map((track) => ({
      id: track.id,
      assetId: track.assetId,
      mixVolume: track.mixVolume,
      playing: track.playing,
      positionSeconds: track.positionSeconds,
      loop: track.loop,
      startedAt: track.startedAt?.toISOString() ?? null,
      slotOrder: track.slotOrder,
      revision: track.revision,
      updatedAt: track.updatedAt.toISOString(),
    })),
    snapshotVersion,
    schemaVersion: env.SCHEMA_VERSION,
    buildVersion: env.APP_VERSION,
    buildRevision: env.BUILD_REVISION,
    serverTime: new Date().toISOString(),
  };
}
