import { z } from "zod";
export * from "./fog-geometry.js";
export * from "./fog-visibility.js";
export * from "./spell-schools.js";
import { fogGeometrySchema } from "./fog-geometry.js";
export * from "./ruler-geometry.js";
import { rulerUpdateSchema } from "./ruler-geometry.js";
export {
  betaPlayerByHandle,
  betaPlayers,
  matchesBetaPlayerIdentity,
  uniqueBetaPlayerIdentity,
} from "./beta-players.js";

export const roleSchema = z.enum(["GM", "PLAYER"]);
export const projectionSchema = z.enum([
  "ORTHOGRAPHIC_2D",
  "ISOMETRIC",
  "THREE_D",
]);
export const assetKindSchema = z.enum([
  "MAP",
  "TOKEN",
  "PORTRAIT",
  "IMAGE",
  "AUDIO",
]);
export const tokenFramePresetSchema = z.enum([
  "NONE",
  "BRONZE",
  "SILVER",
  "OBSIDIAN",
]);
export const messageVisibilitySchema = z.enum(["PUBLIC", "GM_ONLY"]);
export const chatStreamSchema = z.enum(["ROLLS", "STORY", "TABLE"]);
export const chatThreadTypeSchema = z.enum(["STREAM", "DIRECT"]);
export const stickerPackSubjectSchema = z.enum([
  "CHARACTER",
  "PLAYER",
  "NPC",
  "CREATURE",
]);
export const stickerPackAudienceSchema = z.enum([
  "CAMPAIGN",
  "ENTITLED",
  "GM_ONLY",
]);
export const stickerPackSendPolicySchema = z.enum([
  "ALL_MEMBERS",
  "ENTITLED_ONLY",
  "GM_ONLY",
]);
export const stickerPackLifecycleSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "DEPRECATED",
  "ARCHIVED",
]);
export const stickerProvenanceTypeSchema = z.enum([
  "ORIGINAL",
  "COMMISSIONED",
  "IMPORTED",
]);
export const storyPostLifecycleSchema = z.enum([
  "DRAFT",
  "PUBLISHED",
  "CORRECTED",
  "ARCHIVED",
]);
/** Rights are verified by the GM during the review-first import workflow. */
export const storyRightsStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);
export const storyEntityLinkKindSchema = z.enum([
  "WORLD_MAP",
  "LOCATION",
  "SCENE",
  "CHRONICLE",
]);
export const storyImportProviderSchema = z.literal("TELEGRAM");

export const worldMapLifecycleSchema = z.enum([
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
]);
export const worldMapVisibilitySchema = z.enum(["CAMPAIGN", "GM_ONLY"]);
/** Maps have a scope label but MVP deliberately has no editable parent hierarchy. */
export const worldMapScopeSchema = z.enum(["WORLD", "REGION"]);
export const worldMapLocationKindSchema = z.enum([
  "SETTLEMENT",
  "LANDMARK",
  "REGION",
  "OTHER",
]);
/** DISCOVERED is campaign-wide in the MVP; future per-player discovery needs a new model. */
export const worldMapLocationVisibilitySchema = z.enum([
  "PUBLIC",
  "DISCOVERED",
  "GM_ONLY",
]);

export type Role = z.infer<typeof roleSchema>;
export type Projection = z.infer<typeof projectionSchema>;
export type AssetKind = z.infer<typeof assetKindSchema>;
export type TokenFramePreset = z.infer<typeof tokenFramePresetSchema>;
export type MessageVisibility = z.infer<typeof messageVisibilitySchema>;
export type ChatStream = z.infer<typeof chatStreamSchema>;
export type ChatThreadType = z.infer<typeof chatThreadTypeSchema>;
export type StickerPackSubject = z.infer<typeof stickerPackSubjectSchema>;
export type StickerPackAudience = z.infer<typeof stickerPackAudienceSchema>;
export type StickerPackSendPolicy = z.infer<typeof stickerPackSendPolicySchema>;
export type StickerPackLifecycle = z.infer<typeof stickerPackLifecycleSchema>;
export type StoryPostLifecycle = z.infer<typeof storyPostLifecycleSchema>;
export type StoryRightsStatus = z.infer<typeof storyRightsStatusSchema>;
export type StoryEntityLinkKind = z.infer<typeof storyEntityLinkKindSchema>;
export type StoryImportProvider = z.infer<typeof storyImportProviderSchema>;
export type WorldMapLifecycle = z.infer<typeof worldMapLifecycleSchema>;
export type WorldMapVisibility = z.infer<typeof worldMapVisibilitySchema>;
export type WorldMapScope = z.infer<typeof worldMapScopeSchema>;
export type WorldMapLocationKind = z.infer<typeof worldMapLocationKindSchema>;
export type WorldMapLocationVisibility = z.infer<
  typeof worldMapLocationVisibilitySchema
>;

export const playerRequestAudienceSchema = z.enum(["PUBLIC", "GM_ONLY"]);
export const playerRequestHorizonSchema = z.enum([
  "NOW",
  "BEFORE_BREAK",
  "NEXT_SESSION",
]);
export const playerRequestListStateSchema = z.enum(["OPEN", "CLOSED"]);
export const playerRequestStatusSchema = z.enum([
  "SUBMITTED",
  "ACKNOWLEDGED",
  "RESOLVED",
  "DECLINED",
  "CANCELLED",
]);
export const playerRequestTransitionSchema = z.enum([
  "ACKNOWLEDGE",
  "RESOLVE",
  "DECLINE",
  "CANCEL",
]);
export const playerRequestDtoSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  authorMembershipId: z.string().uuid(),
  authorDisplayName: z.string(),
  characterId: z.string().uuid().nullable(),
  characterName: z.string().nullable(),
  audience: playerRequestAudienceSchema,
  horizon: playerRequestHorizonSchema,
  status: playerRequestStatusSchema,
  title: z.string(),
  body: z.string(),
  resolutionNote: z.string().nullable(),
  resolvedByMembershipId: z.string().uuid().nullable(),
  resolvedByDisplayName: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const createPlayerRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    audience: playerRequestAudienceSchema,
    horizon: playerRequestHorizonSchema,
    characterId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();
export const updatePlayerRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();
export const transitionPlayerRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    action: playerRequestTransitionSchema,
    resolutionNote: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.resolutionNote &&
      value.action !== "RESOLVE" &&
      value.action !== "DECLINE"
    )
      context.addIssue({
        code: "custom",
        path: ["resolutionNote"],
        message: "Resolution note is only valid for resolve or decline",
      });
  });
export const listPlayerRequestsSchema = z
  .object({
    status: playerRequestStatusSchema.optional(),
    state: playerRequestListStateSchema.optional(),
    audience: playerRequestAudienceSchema.optional(),
    horizon: playerRequestHorizonSchema.optional(),
    authorMembershipId: z.string().uuid().optional(),
    characterId: z.string().uuid().optional(),
  })
  .strict();
export type PlayerRequestHorizon = z.infer<typeof playerRequestHorizonSchema>;
export type PlayerRequestListState = z.infer<
  typeof playerRequestListStateSchema
>;
export type PlayerRequestAudience = z.infer<typeof playerRequestAudienceSchema>;
export type PlayerRequestStatus = z.infer<typeof playerRequestStatusSchema>;
export type PlayerRequestTransition = z.infer<
  typeof playerRequestTransitionSchema
>;
export type PlayerRequestDto = z.infer<typeof playerRequestDtoSchema>;

export const characterMediaCategorySchema = z.enum([
  "CHARACTER_ART",
  "ARTIFACT",
  "ITEM",
  "DOCUMENT_HANDOUT",
  "MEMORY_SCENE",
  "OTHER",
]);
/**
 * OWNER_GM is the default (owner + GM). PARTY widens to the whole campaign.
 * GM_ONLY is stricter than the default: hidden from the character's own
 * owner too, for GM-authored media/notes (AC8).
 */
export const characterMediaVisibilitySchema = z.enum([
  "OWNER_GM",
  "PARTY",
  "GM_ONLY",
]);
export type CharacterMediaCategory = z.infer<
  typeof characterMediaCategorySchema
>;
export type CharacterMediaVisibility = z.infer<
  typeof characterMediaVisibilitySchema
>;
export const characterMediaDtoSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  characterId: z.string().uuid(),
  assetId: z.string().uuid(),
  category: characterMediaCategorySchema,
  caption: z.string().nullable(),
  ordering: z.number().int().nonnegative(),
  visibility: characterMediaVisibilitySchema,
  relatedEntityId: z.string().uuid().nullable(),
  uploadedByMembershipId: z.string().uuid(),
  detachedAt: z.string().datetime().nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CharacterMediaDto = z.infer<typeof characterMediaDtoSchema>;
/** Attaching an already-uploaded asset to a character's gallery; upload itself is Stage 2. */
export const createCharacterMediaSchema = z
  .object({
    actionId: z.string().uuid(),
    characterId: z.string().uuid(),
    assetId: z.string().uuid(),
    category: characterMediaCategorySchema,
    caption: z.string().trim().min(1).max(500).nullable().optional(),
    visibility: characterMediaVisibilitySchema.default("OWNER_GM").optional(),
  })
  .strict();
export const updateCharacterMediaSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    category: characterMediaCategorySchema.optional(),
    caption: z.string().trim().min(1).max(500).nullable().optional(),
    visibility: characterMediaVisibilitySchema.optional(),
  })
  .strict();
export const reorderCharacterMediaSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    ordering: z.number().int().nonnegative(),
  })
  .strict();
/** Soft-removes from the gallery only; the underlying asset is never deleted by this action. */
export const detachCharacterMediaSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Encounter contract for UIX-311 ("start combat from a map region or a
 * linked tactical scene"). Stage 1: data model + atomic server commands.
 *
 * SCENE_REGION focuses cameras on a rectangle of the already-active source
 * scene as an initial-camera hint only — it is never a server-side movement
 * boundary, so source === target and no token repositioning happens.
 * LINKED_SCENE atomically activates a different, prepared destination scene
 * and auto-transfers each participant token's position, expressed as a
 * relative fraction of the source scene's bounds, onto the same fraction of
 * the destination scene's bounds (see transferRelativePosition on the
 * server).
 */
export const encounterStatusSchema = z.enum(["ACTIVE", "ENDED"]);
export const encounterModeSchema = z.enum(["SCENE_REGION", "LINKED_SCENE"]);
export type EncounterStatus = z.infer<typeof encounterStatusSchema>;
export type EncounterMode = z.infer<typeof encounterModeSchema>;

export const encounterFocusRegionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export type EncounterFocusRegion = z.infer<typeof encounterFocusRegionSchema>;

export const encounterDtoSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  status: encounterStatusSchema,
  mode: encounterModeSchema,
  sourceSceneId: z.string().uuid(),
  targetSceneId: z.string().uuid(),
  /** SCENE_REGION only: camera-focus hint rectangle, scene world coordinates. */
  focusRegion: encounterFocusRegionSchema.nullable(),
  /** LINKED_SCENE only, nullable: set when triggered from a world-map location. */
  locationId: z.string().uuid().nullable(),
  sourceSceneRevision: z.number().int().nonnegative(),
  initiatorMembershipId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  endedByMembershipId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EncounterDto = z.infer<typeof encounterDtoSchema>;

/**
 * Mode-specific required/forbidden fields: SCENE_REGION requires
 * `focusRegion` and forbids `targetSceneId`/`locationId` (source and target
 * are always the same active scene). LINKED_SCENE requires `targetSceneId`
 * and forbids `focusRegion`; `locationId` is optional.
 */
export const startEncounterSchema = z
  .object({
    actionId: z.string().uuid(),
    mode: encounterModeSchema,
    sourceSceneId: z.string().uuid(),
    /** CAS on the source scene's revision at the moment combat starts. */
    sourceSceneRevision: z.number().int().nonnegative(),
    focusRegion: encounterFocusRegionSchema.optional(),
    targetSceneId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "SCENE_REGION") {
      if (!value.focusRegion)
        context.addIssue({
          code: "custom",
          path: ["focusRegion"],
          message: "focusRegion is required for SCENE_REGION",
        });
      if (value.targetSceneId)
        context.addIssue({
          code: "custom",
          path: ["targetSceneId"],
          message: "targetSceneId is not valid for SCENE_REGION",
        });
      if (value.locationId)
        context.addIssue({
          code: "custom",
          path: ["locationId"],
          message: "locationId is not valid for SCENE_REGION",
        });
    } else {
      if (!value.targetSceneId)
        context.addIssue({
          code: "custom",
          path: ["targetSceneId"],
          message: "targetSceneId is required for LINKED_SCENE",
        });
      if (value.focusRegion)
        context.addIssue({
          code: "custom",
          path: ["focusRegion"],
          message: "focusRegion is not valid for LINKED_SCENE",
        });
    }
  });
export type StartEncounterCommand = z.infer<typeof startEncounterSchema>;

export const endEncounterSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type EndEncounterCommand = z.infer<typeof endEncounterSchema>;

/**
 * UIX-311 Stage 3: LINKED_SCENE preflight. Given a candidate destination
 * scene (and optionally the world-map location it was picked through), the
 * GM can check which campaign party members lack a controlled PLAYER-layer
 * token there before committing to start the encounter. LINKED_SCENE token
 * continuity is automatic (transferRelativePosition, Stage 1); this is a
 * warning surface, not a manual-placement flow.
 */
export const encounterPreflightQuerySchema = z
  .object({
    targetSceneId: z.string().uuid(),
    locationId: z.string().uuid().optional(),
  })
  .strict();
export type EncounterPreflightQuery = z.infer<
  typeof encounterPreflightQuerySchema
>;

export const encounterPreflightResponseSchema = z.object({
  targetSceneId: z.string().uuid(),
  /** PLAYER-role membership ids with no controlled PLAYER-layer token on targetSceneId. */
  missingTokenMembershipIds: z.array(z.string().uuid()),
});
export type EncounterPreflightResponse = z.infer<
  typeof encounterPreflightResponseSchema
>;

export const actionIdSchema = z.string().uuid();
export const tokenLayerSchema = z.enum(["MAP", "GM", "PLAYER"]);

/**
 * UIX-471 — состояния фигуры на карте.
 *
 * Набор закрытый. Расширяемый мастером тянет за собой справочник, его редактор
 * и правило «что делать с состоянием, которое уже висит на фигуре, когда его
 * удаляют из справочника», — а это отдельная задача, не эта. Добавить пятое
 * состояние здесь стоит одной миграции; неудачно спроектированный справочник
 * стоит дороже.
 *
 * Хранятся у **размещённой** фигуры, а не у её определения: один персонаж
 * может стоять на двух сценах и быть отравлен только на одной.
 */
export const tokenConditionSchema = z.enum([
  "POISONED",
  "UNCONSCIOUS",
  "RESTRAINED",
  "PRONE",
]);
export type TokenCondition = z.infer<typeof tokenConditionSchema>;

/** Подписи состояний — по ним же строится подсказка при наведении. */
export const TOKEN_CONDITION_LABEL: Readonly<Record<TokenCondition, string>> = {
  POISONED: "Отравлен",
  UNCONSCIOUS: "Без сознания",
  RESTRAINED: "Обездвижен",
  PRONE: "Распластан",
};

/**
 * Набор состояний, а не одно поле: отравлен и обездвижен одновременно — обычное
 * дело, и выбор «одного текущего» заставил бы мастера решать, какое из двух
 * правил сейчас важнее.
 *
 * Порядок при записи не сохраняется — он нормализуется по объявлению выше,
 * иначе две одинаковые по смыслу фигуры отличались бы порядком значков.
 */
export const tokenConditionsSchema = z
  .array(tokenConditionSchema)
  .max(tokenConditionSchema.options.length)
  .transform((values) =>
    tokenConditionSchema.options.filter((condition) =>
      values.includes(condition),
    ),
  );

export const updateTokenConditionsSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  conditions: tokenConditionsSchema,
});
export const STAT_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * UIX-424 — ссылается ли формула на ключ характеристики.
 *
 * Живёт в контракте, потому что спрашивают об этом с обеих сторон: клиент —
 * чтобы предупредить мастера до удаления, сервер — чтобы удаление не принять.
 * Две копии этого правила разошлись бы ровно тогда, когда это дороже всего:
 * клиент показал бы «ссылок нет», а сервер отказал.
 *
 * Совпадение по границе слова, а не по вхождению подстроки: иначе `sila`
 * считалась бы ссылкой в формуле `1d20 + silaVoli`, и мастер не смог бы удалить
 * характеристику из-за связи, которой нет.
 */
export function formulaReferencesStatKey(
  formula: string | undefined,
  key: string,
): boolean {
  if (!key || !formula) return false;
  return new RegExp(`(^|[^a-zA-Z0-9_])${key}([^a-zA-Z0-9_]|$)`).test(formula);
}

export const catalogEntryKindSchema = z.enum(["SKILL", "ABILITY"]);
export const rollActionKindSchema = z.enum(["HIT", "DAMAGE", "CUSTOM"]);
export const modifierSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CHARACTERISTIC"),
    /**
     * UIX-424: раньше здесь были восемь литералов — пятая копия списка
     * характеристик, и именно она делала форму способности неполной: мастер не
     * мог сослаться на реакцию, внимательность и силу магии, хотя система их
     * определяла.
     *
     * Теперь это ключ раскладки. Проверять его существование здесь нечем:
     * раскладка принадлежит кампании, а схема о кампании не знает. Существование
     * проверяет тот, кто применяет модификатор, — и уже проверяет: движок
     * бросков отвечает «стат не найден».
     */
    key: z.string().regex(STAT_KEY_PATTERN).max(40),
  }),
  z.object({
    type: z.literal("ENTRY_VALUE"),
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  }),
  z.object({
    type: z.literal("CONSTANT"),
    value: z.number().int().min(-1000).max(1000),
  }),
  z.object({
    type: z.literal("FORMULA"),
    formula: z
      .string()
      .regex(/^[+-]?\d+(?:[+-]\d+){0,9}$/)
      .max(80),
  }),
]);
/**
 * Стоимость применения в ресурсах персонажа.
 *
 * UIX-424, шаг 9: одна форма на способности каталога и на навыки. Навыкам
 * стоимость добавляется распространением уже работающего механизма, а не
 * вторым списанием рядом, — иначе появились бы два разных правила «хватает ли
 * ресурса», и разошлись бы они в бою.
 *
 * Ресурс один, а не оба сразу: так решено мастером. Форма это и выражает —
 * `type` выбирает один из двух, а не набор.
 */
export const resourceCostSchema = z.object({
  type: z.enum(["physical", "magic"]),
  amount: z.number().int().positive().max(100000),
});

export const rollActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  kind: rollActionKindSchema,
  label: z.string().trim().min(1).max(100),
  dice: z.string().regex(/^\d{0,2}d(?:2|4|6|8|10|12|20|100)(?:kh1)?$/),
  modifiers: z.array(modifierSourceSchema).max(12).default([]),
  order: z.number().int().min(0).max(1000),
  advantage: z.boolean().default(false),
  consumeUse: z.boolean().default(false),
  cost: resourceCostSchema.optional(),
});
export const rechargePeriodSchema = z.enum(["DAY", "BATTLE", "WEEK"]);
export const abilityUsesSchema = z
  .object({
    current: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    recharge: rechargePeriodSchema,
    progressText: z.string().max(200).optional(),
    lastRechargeDay: z.number().int().positive().optional(),
    lastBattleCounter: z.number().int().nonnegative().optional(),
  })
  .refine((uses) => uses.current <= uses.max, {
    message: "current must not exceed max",
    path: ["current"],
  });
export const entryDataSchema = z
  .object({
    rollActions: z.array(rollActionSchema).max(20).optional(),
    values: z.record(z.string(), z.number().finite()).optional(),
    uses: abilityUsesSchema.optional(),
    notes: z.string().max(10000).optional(),
  })
  .catchall(z.unknown())
  .superRefine((data, context) => {
    const ids = new Set<string>();
    for (const [index, action] of (data.rollActions ?? []).entries()) {
      if (ids.has(action.id))
        context.addIssue({
          code: "custom",
          message: "roll action ids must be unique",
          path: ["rollActions", index, "id"],
        });
      ids.add(action.id);
      if (action.consumeUse && !data.uses)
        context.addIssue({
          code: "custom",
          message: "consumeUse requires uses",
          path: ["rollActions", index, "consumeUse"],
        });
    }
  });
/**
 * UIX-424 — значения характеристик персонажа.
 *
 * Раньше здесь стоял объект из одиннадцати полей, и это делало набор
 * характеристик закрытым: добавить строку мастер не мог, потому что патч с
 * незнакомым ключом отвергался контрактом.
 *
 * Теперь набор задаёт раскладка кампании (`statLayoutSchema` ниже), а контракт
 * проверяет только **форму** записи: ключ, пригодный для формулы, и конечное
 * число. Проверить принадлежность ключа раскладке отсюда нечем — раскладка
 * лежит у кампании, а этот патч про персонажа.
 *
 * Запись и так частичная: патч меняет одну характеристику, а сервер сливает его
 * с сохранённым. Поэтому `.partial()` при использовании больше не нужен.
 */
export const characterStatsSchema = z.record(
  z.string().regex(STAT_KEY_PATTERN).max(40),
  z.number().finite(),
);

/**
 * UIX-424 — раскладка характеристик кампании.
 *
 * Значения персонажа лежат плоской записью `ключ → число` в `characters.stats`,
 * и именно её читает движок формул. Раскладка описывает **только то, как эта
 * запись показывается**: какие строки, в каких группах, под какими подписями.
 * Поэтому она общая на кампанию, а не своя у каждого персонажа.
 */

/**
 * Откуда строка берёт значение.
 *
 * `STAT` — обычное число из `characters.stats`.
 *
 * `RESOURCE` — пул из `characters.resources` (выносливость, мана): у него есть
 * текущее и максимум, и правится он иначе. Без этого признака строка «Мана»
 * либо завела бы второе число рядом с настоящим ресурсом, либо ресурс перестал
 * бы редактироваться из карточки.
 */
export const statRowSourceSchema = z.enum(["STAT", "RESOURCE"]);

export const statRowSchema = z.object({
  /**
   * Латиница без пробелов — это требование движка формул, а не стиль: имя
   * характеристики попадает в формулу вида `1d20 + agility`. Ключ неизменяем
   * после создания, иначе формулы, ссылающиеся на него, поедут молча.
   */
  key: z.string().regex(STAT_KEY_PATTERN).max(40),
  label: z.string().trim().min(1).max(60),
  source: statRowSourceSchema.default("STAT"),
});

const STAT_GROUP_USER_ROW_LIMIT = 60;
// Это только резерв ёмкости, а не список обязательных строк: partial-layout
// без регена должна остаться валидной для read-time repair. Тест `60 + 2`
// намеренно связывает эти ключи с RESOURCE_REGEN_STAT и упадёт при их drift.
const reservedCombatStatKeys = new Set(["enduranceRegen", "manaRegen"]);

export const statGroupSchema = z
  .object({
    id: z.enum(["characteristics", "combat", "skills", "talents"]),
    label: z.string().trim().min(1).max(60),
    /**
     * До UIX-516 редактор разрешал до 60 пользовательских строк. Физический
     * предел 62 оставляет место read-time repair, а refinement ниже не даёт
     * использовать системный резерв как две дополнительные custom-строки.
     */
    rows: z.array(statRowSchema).max(62),
  })
  .superRefine((group, context) => {
    const reservedRows =
      group.id === "combat"
        ? new Set(
            group.rows
              .filter(
                (row) =>
                  row.source === "STAT" && reservedCombatStatKeys.has(row.key),
              )
              .map((row) => row.key),
          ).size
        : 0;
    if (group.rows.length <= STAT_GROUP_USER_ROW_LIMIT + reservedRows) return;
    context.addIssue({
      code: "custom",
      path: ["rows"],
      message:
        "Группа допускает не более 60 пользовательских строк; ещё два места зарезервированы системным регеном",
    });
  });

export const statLayoutSchema = z
  .array(statGroupSchema)
  .max(8)
  .superRefine((groups, context) => {
    // Ключи уникальны **через все группы**, а не внутри одной: значения живут в
    // одной плоской записи, и два одинаковых ключа в разных группах — это две
    // строки, редактирующие одно число. Разойдутся они молча.
    const seen = new Set<string>();
    for (const [groupIndex, group] of groups.entries())
      for (const [rowIndex, row] of group.rows.entries()) {
        if (seen.has(row.key))
          context.addIssue({
            code: "custom",
            message: `ключ «${row.key}» встречается больше одного раза`,
            path: [groupIndex, "rows", rowIndex, "key"],
          });
        seen.add(row.key);
      }

    const ids = new Set<string>();
    for (const [index, group] of groups.entries()) {
      if (ids.has(group.id))
        context.addIssue({
          code: "custom",
          message: `группа «${group.id}» объявлена дважды`,
          path: [index, "id"],
        });
      ids.add(group.id);
    }
  });

export type StatRow = z.infer<typeof statRowSchema>;
export type StatGroup = z.infer<typeof statGroupSchema>;
export type StatLayout = z.infer<typeof statLayoutSchema>;

/**
 * UIX-424, шаг 5 — правка раскладки мастером.
 *
 * Передаётся раскладка целиком, а не отдельная операция: она общая на кампанию
 * и меняется под ревизией, значит две одновременные правки должны разойтись
 * конфликтом, а не слиться. Частичные операции пришлось бы сливать вручную и
 * гадать, что имел в виду второй мастер.
 *
 * Что из присланного примут — решает сервер: удаление строки на этом шаге
 * отвергается, потому что проверка ссылок из формул появляется только на шаге 6.
 */
export const updateStatLayoutSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  layout: statLayoutSchema,
});

/**
 * UIX-431 — порядок ходов в бою.
 *
 * Участник — строка ростера, а не токен. Причина в требовании задачи: часть
 * бросков делается физическими кубами за столом, и мастеру нужно вписать в
 * очередь «Волк №3», которого на карте нет вовсе. Привязка к токену поэтому
 * необязательна.
 *
 * Имя устроено как у определения токена (UIX-400): `null` значит «зовусь как
 * мой токен», и переименование доходит до панели само. Строка без токена обязана
 * иметь собственное имя — иначе в очереди появится участник, о котором нечего
 * сказать.
 *
 * Порядок задаётся порядком массива, без поля `order`. Отдельный индекс пришлось
 * бы держать плотным и уникальным при каждой перестановке, и рассинхрон массива с
 * индексом проявился бы как «строка прыгнула сама».
 */
export const initiativeParticipantSchema = z
  .object({
    id: z.string().uuid(),
    tokenId: z.string().uuid().nullable().default(null),
    name: z.string().trim().min(1).max(60).nullable().default(null),
    /**
     * Результат броска — своего или физического, панель их не различает.
     * `null` — «ещё не бросал»: это не то же самое, что ноль, и в сортировке
     * такие строки уходят вниз, а не считаются провалом.
     */
    initiative: z.number().int().min(-99).max(999).nullable().default(null),
    /**
     * UIX-466: строка, поставленную на место руками, держит своё место.
     *
     * Порядок по умолчанию вычисляется из значений, но мастеру нужно уметь
     * сказать «эти двое ходят так, и точка» — например когда ничью решили за
     * столом или когда чей-то бонус в систему не внесён. Закрепление держится
     * за строкой, а не за индексом: иначе оно съезжало бы на соседа при первом
     * же выводе кого-нибудь из боя.
     *
     * `.default(false)` не косметика: очереди, сохранённые до этой правки,
     * лежат в JSONB без поля, и без значения по умолчанию первый же разбор
     * такой очереди упал бы посреди боя.
     */
    pinned: z.boolean().default(false),
  })
  .refine((participant) => participant.name !== null || participant.tokenId, {
    message: "участник без токена обязан иметь имя",
    path: ["name"],
  });

export const initiativeOrderSchema = z
  .array(initiativeParticipantSchema)
  .max(60)
  .superRefine((participants, context) => {
    const seenIds = new Set<string>();
    const seenTokens = new Set<string>();
    for (const [index, participant] of participants.entries()) {
      if (seenIds.has(participant.id))
        context.addIssue({
          code: "custom",
          message: "участник встречается в очереди дважды",
          path: [index, "id"],
        });
      seenIds.add(participant.id);
      // Один токен — одна строка: иначе рамка выделения, применённая дважды,
      // молча удвоила бы половину очереди.
      if (participant.tokenId) {
        if (seenTokens.has(participant.tokenId))
          context.addIssue({
            code: "custom",
            message: "этот токен уже введён в бой",
            path: [index, "tokenId"],
          });
        seenTokens.add(participant.tokenId);
      }
    }
  });

export type InitiativeParticipant = z.infer<typeof initiativeParticipantSchema>;
export type InitiativeOrder = z.infer<typeof initiativeOrderSchema>;

/**
 * Очередь правится целиком и под ревизией кампании — по тем же причинам, что и
 * раскладка характеристик выше: она общая на кампанию, и две одновременные
 * правки обязаны разойтись конфликтом, а не слиться в порядок, которого никто
 * не задумывал.
 */
/**
 * UIX-466 п. 3-4 — зона боя: прямоугольник на сцене, из которого собирается
 * состав очереди.
 *
 * Сцена хранится вместе с координатами намеренно. Зона без неё была бы
 * прямоугольником «где-то», и после смены активной сцены мастер собрал бы в бой
 * тех, кто просто стоит на тех же координатах другой карты.
 *
 * Координаты — мировые, те же, в которых лежат токены; масштаб и положение
 * камеры на состав не влияют.
 */
export const battleZoneSchema = z
  .object({
    sceneId: z.string().uuid(),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export type BattleZone = z.infer<typeof battleZoneSchema>;

/** Зона задаётся целиком или снимается — правки «подвинуть на пиксель» нет. */
export const setBattleZoneSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  zone: battleZoneSchema.nullable(),
});

/**
 * Кто из токенов попадает в зону боя.
 *
 * **Пересечение, а не полное вхождение.** Фигура, задетая краем зоны, в бою
 * участвует: мастер обводит поле боя примерно, и требовать, чтобы гигант влез в
 * рамку целиком, значило бы заставлять обводить карту целиком.
 *
 * Неравенства строгие — ровно как в рамке выделения на канвасе
 * (`Orthographic2DRenderer`). Касание ребром не попадание: иначе зона,
 * приложенная вплотную к строю, втягивала бы соседнюю шеренгу.
 *
 * Токены других сцен отсеиваются здесь, а не у вызывающего: это первое, что
 * забудут сделать, и цена — противники с прошлой карты в очереди.
 */
export function tokensInBattleZone<
  T extends {
    sceneId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  },
>(tokens: readonly T[], zone: BattleZone): T[] {
  return tokens.filter(
    (token) =>
      token.sceneId === zone.sceneId &&
      token.x < zone.x + zone.width &&
      token.x + token.width > zone.x &&
      token.y < zone.y + zone.height &&
      token.y + token.height > zone.y,
  );
}

export const updateInitiativeSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  participants: initiativeOrderSchema,
});

/**
 * UIX-466 — игрок вносит свой бросок.
 *
 * Отдельная операция, а не право игрока на общий `PATCH` выше. Тот принимает
 * очередь целиком, а игрок видит её отфильтрованной: строк противников у него
 * нет, и прислать полный состав он попросту не может — сервер увидел бы
 * «участники исчезли». Разбирать такую правку пришлось бы, угадывая, что игрок
 * не видел, а угадывание в проверке прав — это дыра.
 *
 * Поэтому здесь передаётся ровно намерение: «строке X поставить значение Y».
 * Состав, имена и порядок остаются серверными.
 */
export const setOwnInitiativeSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  participantId: z.string().uuid(),
  initiative: z.number().int().min(-99).max(999).nullable(),
});

/**
 * Порядок по броскам — по убыванию, «ещё не бросал» уходит вниз.
 *
 * Сортировка устойчива: равные броски сохраняют взаимный порядок, поэтому
 * решённая мастером ничья не перетасовывается сама.
 *
 * Отдельной кнопки «пересортировать» больше нет — очередь пересобирается после
 * каждой правки, и делает это сервер (UIX-466). Прямо эту функцию зовут только
 * там, где закреплённых строк заведомо нет; во всех остальных местах —
 * `orderInitiative`, которая её и использует.
 */
export function sortByInitiative<T extends { initiative: number | null }>(
  participants: readonly T[],
): T[] {
  return participants
    .map((participant, index) => ({ participant, index }))
    .sort((left, right) => {
      const a = left.participant.initiative;
      const b = right.participant.initiative;
      if (a === null && b === null) return left.index - right.index;
      if (a === null) return 1;
      if (b === null) return -1;
      if (a !== b) return b - a;
      return left.index - right.index;
    })
    .map(({ participant }) => participant);
}

/**
 * Порядок очереди с учётом строк, поставленных на место руками (UIX-466, п. 9).
 *
 * Правило одно и его видно из подписи: **закреплённая строка остаётся на своём
 * месте, все остальные сортируются по броскам и занимают оставшиеся.** Поэтому
 * перестановка переживает и новый бросок, и ввод чужого значения — иначе она не
 * была бы перестановкой, а была бы миганием.
 *
 * Место закреплённой строки берётся из её позиции во входном массиве. Так и
 * задумано: очередь хранится уже упорядоченной, а клиент, двигая строку, шлёт
 * массив с новым положением — то есть «куда поставили, там и держится», без
 * второго поля с индексом, которое пришлось бы чинить при каждом выводе из боя.
 *
 * Чего функция намеренно НЕ делает: не решает, какие строки закреплять. Обмен
 * местами закрепляет обе участвовавшие строки, и это решение принимает панель —
 * закрепить одну значило бы отпустить вторую в общий пул, откуда её унесло бы
 * сортировкой совсем не туда, где её только что оставили руками.
 */
export function orderInitiative<
  T extends { initiative: number | null; pinned?: boolean },
>(participants: readonly T[]): T[] {
  const held = new Map<number, T>();
  const loose: T[] = [];
  participants.forEach((participant, index) => {
    if (participant.pinned) held.set(index, participant);
    else loose.push(participant);
  });
  if (held.size === 0) return sortByInitiative(participants);
  const sorted = sortByInitiative(loose);
  let next = 0;
  return participants.map((_, index) => held.get(index) ?? sorted[next++]!);
}

export const gmLoginSchema = z.object({ token: z.string().min(32).max(512) });
export const inviteClaimSchema = z.object({
  token: z.string().min(32).max(512),
  displayName: z.string().trim().min(1).max(40).optional(),
});
export const createInviteSchema = z.object({
  actionId: actionIdSchema,
  characterId: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  expiresInHours: z.number().int().min(1).max(720).default(168),
});
export const rotatePlayerAccessSchema = z.object({ actionId: actionIdSchema });
export const rotateGmAccessSchema = z.object({
  actionId: actionIdSchema,
  token: z.string().min(32).max(512),
});
export const renameCampaignSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(120),
});

export interface PlayerAccessDto {
  id: string;
  membershipId: string;
  characterId: string | null;
  label: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerAccessSecretDto {
  grant: PlayerAccessDto;
  created: boolean;
  url: string | null;
}

export const gridSchema = z.object({
  enabled: z.boolean().default(true),
  size: z.number().int().min(16).max(256).default(64),
  offsetX: z.number().finite().default(0),
  offsetY: z.number().finite().default(0),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#c8b78b"),
  opacity: z.number().min(0).max(1).default(0.22),
});

export const createSceneSchema = z
  .object({
    actionId: actionIdSchema,
    name: z.string().trim().min(1).max(100),
    mapAssetId: z.string().uuid().nullable().optional(),
    width: z.number().int().min(320).max(16384).default(1920),
    height: z.number().int().min(320).max(16384).default(1080),
    grid: gridSchema.default({
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#c8b78b",
      opacity: 0.22,
    }),
    backgroundFrame: z
      .object({
        x: z.number().finite().min(-16384).max(16384),
        y: z.number().finite().min(-16384).max(16384),
        width: z.number().finite().min(16).max(16384),
        height: z.number().finite().min(16).max(16384),
      })
      .optional(),
  })
  .strict();

export const updateSceneMetadataSchema = z
  .object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(100).optional(),
    mapAssetId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.mapAssetId !== undefined,
    { message: "At least one scene metadata field is required" },
  );

export const activateSceneSchema = z.object({
  actionId: actionIdSchema,
  sceneId: z.string().uuid(),
});

/**
 * UIX-408: ephemeral GM canvas selection sent over Socket.IO.
 *
 * This is deliberately strict even though the event has no acknowledgement:
 * accepting an object with a misspelled or injected field would turn malformed
 * input into a valid scene request at the privacy boundary. `null` means the
 * GM returned to the campaign's broadcast scene.
 */
export const sceneViewSchema = z
  .object({ sceneId: z.string().uuid().nullable() })
  .strict();

export const createTokenSchema = z.object({
  actionId: actionIdSchema,
  definitionId: z.string().uuid().optional(),
  sceneId: z.string().uuid(),
  characterId: z.string().uuid().nullable().optional(),
  ownerMembershipId: z.string().uuid().nullable().optional(),
  assetId: z.string().uuid().nullable().optional(),
  /**
   * UIX-400: у токена персонажа имени может не быть — он зовётся как
   * персонаж и переименовывается вместе с ним. Без персонажа имя обязательно,
   * это проверяет сервер: наследовать было бы не от кого.
   */
  name: z.string().trim().min(1).max(80).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite().default(0),
  levelId: z.string().uuid().nullable().default(null),
  width: z.number().min(16).max(1024).default(64),
  height: z.number().min(16).max(1024).default(64),
  rotation: z.number().finite().default(0),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  baseColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#b5623e"),
  frameColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  layer: tokenLayerSchema.default("PLAYER"),
  controllerMembershipIds: z.array(z.string().uuid()).max(50).optional(),
});

export const moveTokenSchema = z.object({
  actionId: actionIdSchema,
  tokenId: z.string().uuid(),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite().default(0),
  levelId: z.string().uuid().nullable().default(null),
  revision: z.number().int().nonnegative(),
});
export const deleteTokenSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
});
export const replaceTokenControllersSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  controllerMembershipIds: z.array(z.string().uuid()).max(50),
});
export const replaceCharacterControllersSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  controllerMembershipIds: z.array(z.string().uuid()).max(50),
});
export const placeTokenDefinitionSchema = z.object({
  actionId: actionIdSchema,
  definitionId: z.string().uuid(),
  sceneId: z.string().uuid().optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
});
/**
 * The crop coordinates are the normalized center of a square crop in the
 * auto-oriented source image. The server clamps the square to image bounds.
 */
export const generateTokenAssetSchema = z
  .object({
    cropX: z.number().finite().min(0).max(1),
    cropY: z.number().finite().min(0).max(1),
    zoom: z.number().finite().min(1).max(8),
    frame: tokenFramePresetSchema,
    name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export type GenerateTokenAssetInput = z.infer<typeof generateTokenAssetSchema>;

export const resizeTokenSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  width: z.number().finite().min(16).max(1024),
  height: z.number().finite().min(16).max(1024),
});
export const tokenAppearanceSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  baseColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  frameColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
});
const canvasBulkTargetSchema = z.object({
  targetType: z.enum(["TOKEN", "DRAWING"]),
  targetId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});
export const canvasBulkCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    actionId: actionIdSchema,
    sceneId: z.string().uuid(),
    operation: z.literal("MOVE"),
    deltaX: z.number().finite(),
    deltaY: z.number().finite(),
    targets: z.array(canvasBulkTargetSchema).min(1).max(250),
  }),
  z.object({
    actionId: actionIdSchema,
    sceneId: z.string().uuid(),
    operation: z.literal("DELETE"),
    targets: z.array(canvasBulkTargetSchema).min(1).max(250),
  }),
]);
export const createTokenDefinitionSchema = z.object({
  actionId: actionIdSchema,
  name: z.string().trim().min(1).max(80),
  characterId: z.string().uuid().nullable().default(null),
  defaultAssetId: z.string().uuid().nullable().default(null),
  defaultWidth: z.number().min(16).max(1024).default(64),
  defaultHeight: z.number().min(16).max(1024).default(64),
  controllerMembershipIds: z.array(z.string().uuid()).max(50).default([]),
});
export const tokenDefinitionUpdateSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  /**
   * UIX-400: `null` — «зовусь как мой персонаж». Отличается от отсутствия
   * поля: не передали — имя не трогаем, передали `null` — просим наследовать.
   */
  name: z.string().trim().min(1).max(80).nullable().optional(),
  defaultAssetId: z.string().uuid().nullable().optional(),
  characterId: z.string().uuid().nullable().optional(),
  defaultWidth: z.number().min(16).max(1024).optional(),
  defaultHeight: z.number().min(16).max(1024).optional(),
});
export const revisionCommandSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
});
export const renameCommandSchema = revisionCommandSchema.extend({
  name: z.string().trim().min(1).max(80),
});

export const createFogRevealSchema = z
  .object({
    actionId: actionIdSchema,
    sceneId: z.string().uuid(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().positive().max(16384).optional(),
    height: z.number().positive().max(16384).optional(),
    operation: z.enum(["REVEAL", "COVER"]).default("REVEAL"),
    geometry: fogGeometrySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !value.geometry &&
      [value.x, value.y, value.width, value.height].some((v) => v === undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "legacy RECT requires x, y, width and height",
      });
  });

export const undoFogRevealSchema = z.object({
  actionId: actionIdSchema,
  sceneId: z.string().uuid(),
});

export const historyCommandSchema = z.object({
  actionId: actionIdSchema,
  sceneId: z.string().uuid(),
});
export const changeTokenLayerSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  layer: tokenLayerSchema,
});
export const drawingPointsSchema = z
  .array(z.number().finite().min(-32768).max(32768))
  .min(4)
  .max(4096)
  .refine((points) => points.length % 2 === 0, "points must be x/y pairs");
export const createDrawingSchema = z.object({
  actionId: actionIdSchema,
  sceneId: z.string().uuid(),
  points: drawingPointsSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  strokeWidth: z.number().finite().min(1).max(100).default(3).optional(),
  x: z.number().finite().default(0),
  y: z.number().finite().default(0),
});
export const updateDrawingSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  strokeWidth: z.number().finite().min(1).max(100).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
});
export const drawingCommandSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
});
export const sceneCanvasConfigSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(100).optional(),
  mapAssetId: z.string().uuid().nullable().optional(),
  /** A size change preserves in-scene token cell coordinates and the defaults of referenced definitions. */
  grid: gridSchema.optional(),
  mapScale: z.number().finite().min(0.1).max(10).optional(),
  world: z
    .object({
      width: z.number().int().min(320).max(16384),
      height: z.number().int().min(320).max(16384),
    })
    .optional(),
  backgroundFrame: z
    .object({
      x: z.number().finite().min(-16384).max(16384),
      y: z.number().finite().min(-16384).max(16384),
      width: z.number().finite().min(16).max(16384),
      height: z.number().finite().min(16).max(16384),
    })
    .optional(),
});
/**
 * UIX-392: ephemeral cursor presence. Bounds mirror `backgroundFrame`'s
 * world-coordinate range above — generous enough for legitimate pointer
 * positions (including a little overscroll past the map edge) while still
 * rejecting garbage/NaN/huge values from a misbehaving client. Nothing here
 * is persisted; see `apps/server/src/realtime.ts`'s `cursor:move` handler.
 */
export const cursorMoveSchema = z.object({
  sceneId: z.string().uuid(),
  x: z.number().finite().min(-16384).max(16384),
  y: z.number().finite().min(-16384).max(16384),
  /**
   * UIX-403: only meaningful for a GM, who by default broadcasts to the GM
   * room alone — a GM sees through fog, so their pointer would otherwise
   * disclose what is under it. Setting this asks the server to relay to the
   * whole campaign instead, which is the GM deliberately choosing to point at
   * something in front of the players.
   *
   * Absent means false: an older client, or one that never enabled it, keeps
   * the safe behaviour rather than inheriting the risky one.
   */
  shared: z.boolean().optional(),
});

export const characterUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  portraitAssetId: z.string().uuid().nullable().optional(),
  // Character edits may update one characteristic at a time. The server merges
  // this patch into the stored record instead of replacing it.
  stats: characterStatsSchema.optional(),
  skills: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        rank: z.number(),
        formula: z.string(),
        /**
         * UIX-424, шаг 9. Стоимость хранится у навыка, а не присылается при
         * броске: цену применения назначает мастер, и приняв её от клиента,
         * сервер разрешил бы игроку объявить любой навык бесплатным.
         */
        cost: resourceCostSchema.optional(),
      }),
    )
    .max(100)
    .optional(),
  spells: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        description: z.string().max(4000),
        formula: z.string().optional(),
      }),
    )
    .max(100)
    .optional(),
  notes: z.string().max(20000).optional(),
  backstory: z.string().max(40000).optional(),
  inventory: z.array(z.string().trim().min(1).max(500)).max(500).optional(),
  resources: z
    .record(
      z.string(),
      z.object({
        current: z.number().finite(),
        maximum: z.number().finite().optional(),
      }),
    )
    .optional(),
});

export const catalogEntryInputSchema = z.object({
  kind: catalogEntryKindSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(10000).default(""),
  data: entryDataSchema.default({}),
});
export const catalogEntryCommandSchema = catalogEntryInputSchema.extend({
  actionId: actionIdSchema,
});
export const assignCatalogEntrySchema = z.object({
  actionId: actionIdSchema,
  catalogEntryId: z.string().uuid(),
});
export const characterCatalogEntryCommandSchema = catalogEntryInputSchema
  .partial()
  .extend({ actionId: actionIdSchema });

export const characterCommandSchema = characterUpdateSchema.extend({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative().optional(),
});

/**
 * UIX-393: archive/restore are dedicated lifecycle-transition actions
 * (mirrors `POST /api/world-maps/:id/archive` and
 * `POST /api/world-content/:id/lifecycle`), not a mixed-in field on
 * `characterCommandSchema` — the body carries only the CAS/idempotency
 * envelope shared by both directions of the transition.
 */
export const archiveCharacterSchema = revisionCommandSchema;
export const restoreCharacterSchema = revisionCommandSchema;

/**
 * Structural fields a "create from template" preset carries over from an existing
 * character. Deliberately excludes identity (name, portrait, owner/controllers),
 * narrative text (notes/backstory) and wallet — those stay specific to each character.
 */
export const characterTemplateFieldsSchema = characterUpdateSchema
  .pick({
    stats: true,
    skills: true,
    spells: true,
    inventory: true,
    resources: true,
  })
  .partial();
export const createCharacterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  actionId: actionIdSchema,
  template: characterTemplateFieldsSchema.optional(),
});

/** Entity references are IDs only; labels are resolved server-side and never trusted from a client. */
export const storyEntityLinkSchema = z
  .object({
    kind: storyEntityLinkKindSchema,
    entityId: z.string().uuid(),
  })
  .strict();
export type StoryEntityLink = z.infer<typeof storyEntityLinkSchema>;

export const storyPostMediaInputSchema = z
  .object({
    contentId: z.string().uuid(),
    order: z.number().int().min(0).max(99),
    altText: z.string().trim().min(1).max(240),
    caption: z.string().trim().max(2000).default(""),
  })
  .strict();
export type StoryPostMediaInput = z.infer<typeof storyPostMediaInputSchema>;

const storyPostContentSchema = z
  .object({
    title: z.string().trim().max(160).default(""),
    body: z.string().trim().max(20000).default(""),
    entityLinks: z.array(storyEntityLinkSchema).max(20).default([]),
    media: z.array(storyPostMediaInputSchema).max(10).default([]),
  })
  .strict()
  .superRefine((post, context) => {
    if (!post.body && !post.media.length)
      context.addIssue({
        code: "custom",
        message: "Story post requires body or media",
        path: ["body"],
      });
    const mediaOrder = new Set<number>();
    for (const [index, media] of post.media.entries()) {
      if (mediaOrder.has(media.order))
        context.addIssue({
          code: "custom",
          message: "Story media order must be unique",
          path: ["media", index, "order"],
        });
      mediaOrder.add(media.order);
    }
    const links = new Set<string>();
    for (const [index, link] of post.entityLinks.entries()) {
      const key = `${link.kind}:${link.entityId}`;
      if (links.has(key))
        context.addIssue({
          code: "custom",
          message: "Duplicate story entity link",
          path: ["entityLinks", index],
        });
      links.add(key);
    }
  });

/** GM-only. New posts are drafts; publication is a separate, reviewable transition. */
export const createStoryPostSchema = storyPostContentSchema.extend({
  actionId: actionIdSchema,
  gmNotes: z.string().max(10000).default(""),
});
export type CreateStoryPost = z.infer<typeof createStoryPostSchema>;

/** GM-only CAS patch. Supplying content replaces the current revision as one atomic snapshot. */
export const updateStoryPostSchema = z
  .object({
    actionId: actionIdSchema,
    postId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    title: z.string().trim().max(160).optional(),
    body: z.string().trim().max(20000).optional(),
    entityLinks: z.array(storyEntityLinkSchema).max(20).optional(),
    media: z.array(storyPostMediaInputSchema).max(10).optional(),
    gmNotes: z.string().max(10000).optional(),
  })
  .strict()
  .refine(
    (command) =>
      command.title !== undefined ||
      command.body !== undefined ||
      command.entityLinks !== undefined ||
      command.media !== undefined ||
      command.gmNotes !== undefined,
    "At least one story post field is required",
  );
export type UpdateStoryPost = z.infer<typeof updateStoryPostSchema>;

export const storyPostTransitionSchema = z
  .object({
    actionId: actionIdSchema,
    postId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type StoryPostTransition = z.infer<typeof storyPostTransitionSchema>;

/** A Telegram export is input data, never a URL for the server to fetch or scrape. */
export const telegramStoryImportRecordSchema = z
  .object({
    sourceMessageId: z.string().trim().min(1).max(128),
    sourceAuthor: z.string().trim().min(1).max(200),
    sourceTimestamp: z.string().datetime(),
    sourceUrl: z.string().trim().min(1).max(2048).optional(),
    body: z.string().max(20000).default(""),
    media: z
      .array(
        z
          .object({
            sourceMediaId: z.string().trim().min(1).max(200),
            sourceUrl: z.string().trim().min(1).max(2048).optional(),
            caption: z.string().trim().max(2000).default(""),
            order: z.number().int().min(0).max(99),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict()
  .superRefine((record, context) => {
    if (!record.body.trim() && !record.media.length)
      context.addIssue({
        code: "custom",
        message: "Imported story record requires body or media",
        path: ["body"],
      });
    const mediaOrder = new Set<number>();
    for (const [index, media] of record.media.entries()) {
      if (mediaOrder.has(media.order))
        context.addIssue({
          code: "custom",
          message: "Imported media order must be unique",
          path: ["media", index, "order"],
        });
      mediaOrder.add(media.order);
    }
  });

/** GM-only dry-run; a small user-approved export is required and no network fetch occurs. */
export const dryRunTelegramStoryImportSchema = z
  .object({
    actionId: actionIdSchema,
    records: z.array(telegramStoryImportRecordSchema).min(1).max(25),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = new Set<string>();
    for (const [index, record] of input.records.entries()) {
      if (ids.has(record.sourceMessageId))
        context.addIssue({
          code: "custom",
          message: "Duplicate source message ID in import batch",
          path: ["records", index, "sourceMessageId"],
        });
      ids.add(record.sourceMessageId);
    }
  });
export type DryRunTelegramStoryImport = z.infer<
  typeof dryRunTelegramStoryImportSchema
>;

export const commitTelegramStoryImportSchema = z
  .object({
    actionId: actionIdSchema,
    importBatchId: z.string().uuid(),
    /** Re-submit the reviewed local export; the server never fetches Telegram. */
    records: z.array(telegramStoryImportRecordSchema).min(1).max(25),
    /** Explicit per-source rights decisions. Approval is required before publication, never at import. */
    rights: z
      .array(
        z
          .object({
            sourceMessageId: z.string().trim().min(1).max(128),
            status: storyRightsStatusSchema,
          })
          .strict(),
      )
      .min(1)
      .max(25),
  })
  .strict()
  .superRefine((input, context) => {
    const sourceMessageIds = new Set<string>();
    for (const [index, record] of input.records.entries()) {
      if (sourceMessageIds.has(record.sourceMessageId))
        context.addIssue({
          code: "custom",
          message: "Duplicate source message ID in import batch",
          path: ["records", index, "sourceMessageId"],
        });
      sourceMessageIds.add(record.sourceMessageId);
    }
    const rightsIds = new Set<string>();
    for (const [index, right] of input.rights.entries()) {
      if (rightsIds.has(right.sourceMessageId))
        context.addIssue({
          code: "custom",
          message: "Duplicate source message ID in rights decisions",
          path: ["rights", index, "sourceMessageId"],
        });
      if (!sourceMessageIds.has(right.sourceMessageId))
        context.addIssue({
          code: "custom",
          message: "Rights decision has no matching import record",
          path: ["rights", index, "sourceMessageId"],
        });
      rightsIds.add(right.sourceMessageId);
    }
    for (const [index, record] of input.records.entries()) {
      if (!rightsIds.has(record.sourceMessageId))
        context.addIssue({
          code: "custom",
          message: "Import record requires a rights decision",
          path: ["records", index, "sourceMessageId"],
        });
    }
  });
export type CommitTelegramStoryImport = z.infer<
  typeof commitTelegramStoryImportSchema
>;

export const listStoryPostsSchema = z
  .object({
    /** Opaque {updatedAt,id} cursor, encoded by the server. */
    cursor: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListStoryPosts = z.infer<typeof listStoryPostsSchema>;

export const chatAttachmentContentIdSchema = z.string().uuid();
export const chatAttachmentMetadataSchema = z
  .object({
    contentId: chatAttachmentContentIdSchema,
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(127),
    sizeBytes: z.number().int().positive(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ChatAttachmentMetadata = z.infer<
  typeof chatAttachmentMetadataSchema
>;

export const createOrGetDirectChatThreadSchema = z.object({
  participantMembershipId: z.string().uuid(),
});
export type CreateOrGetDirectChatThread = z.infer<
  typeof createOrGetDirectChatThreadSchema
>;

const createChatMessageCommonSchema = z.object({
  actionId: actionIdSchema,
  body: z.string().trim().min(1).max(4000),
  characterId: z.string().uuid().nullable().optional(),
  attachmentContentIds: z
    .array(chatAttachmentContentIdSchema)
    .max(10)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Duplicate attachment content ID",
    )
    .default([]),
});

export const createDirectChatMessageSchema =
  createChatMessageCommonSchema.extend({
    threadId: z.string().uuid(),
    stream: z.never().optional(),
    visibility: z.never().optional(),
  });
export type CreateDirectChatMessage = z.infer<
  typeof createDirectChatMessageSchema
>;

const createStreamChatMessageBaseSchema = createChatMessageCommonSchema.extend({
  visibility: messageVisibilitySchema.default("PUBLIC"),
});

/**
 * The threadId variant is stream-only. The server must resolve the thread and
 * reject DIRECT threads before creating a message. Participant membership is
 * an authorization boundary and cannot be expressed by this input schema.
 */
export const createStreamChatMessageSchema = z.union([
  createStreamChatMessageBaseSchema.extend({
    threadId: z.string().uuid(),
    stream: z.never().optional(),
  }),
  createStreamChatMessageBaseSchema.extend({
    threadId: z.never().optional(),
    stream: z.enum(["TABLE", "STORY"]).default("TABLE"),
  }),
]);
export type CreateStreamChatMessage = z.infer<
  typeof createStreamChatMessageSchema
>;

/** @deprecated Use createStreamChatMessageSchema; retained for existing routes. */
export const createChatMessageSchema = createStreamChatMessageSchema;

/** Position on an approved world-map background, normalized to its visible bounds. */
export const worldMapCoordinateSchema = z.number().finite().min(0).max(1);

export const createWorldMapSchema = z
  .object({
    actionId: actionIdSchema,
    name: z.string().trim().min(1).max(120),
    scope: worldMapScopeSchema.default("REGION"),
    visibility: worldMapVisibilitySchema.default("CAMPAIGN"),
  })
  .strict();
export type CreateWorldMap = z.infer<typeof createWorldMapSchema>;

export const updateWorldMapSchema = z
  .object({
    actionId: actionIdSchema,
    mapId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(120).optional(),
    scope: worldMapScopeSchema.optional(),
    visibility: worldMapVisibilitySchema.optional(),
  })
  .strict()
  .refine(
    (command) =>
      command.name !== undefined ||
      command.scope !== undefined ||
      command.visibility !== undefined,
    "At least one map field is required",
  );
export type UpdateWorldMap = z.infer<typeof updateWorldMapSchema>;

/** This only changes a draft candidate. Approval and publication are separate GM actions. */
export const setWorldMapDraftBackgroundSchema = z
  .object({
    actionId: actionIdSchema,
    mapId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    backgroundAssetId: z.string().uuid().nullable(),
  })
  .strict();
export type SetWorldMapDraftBackground = z.infer<
  typeof setWorldMapDraftBackgroundSchema
>;

export const approveWorldMapBackgroundSchema = z
  .object({
    actionId: actionIdSchema,
    mapId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type ApproveWorldMapBackground = z.infer<
  typeof approveWorldMapBackgroundSchema
>;

export const publishWorldMapSchema = z
  .object({
    actionId: actionIdSchema,
    mapId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type PublishWorldMap = z.infer<typeof publishWorldMapSchema>;

export const archiveWorldMapSchema = z
  .object({
    actionId: actionIdSchema,
    mapId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type ArchiveWorldMap = z.infer<typeof archiveWorldMapSchema>;

export const createWorldMapLocationSchema = z
  .object({
    actionId: actionIdSchema,
    mapId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    kind: worldMapLocationKindSchema.default("OTHER"),
    /** Player-safe location-card text. */
    summary: z.string().trim().max(2000).default(""),
    /** Server must never project this field to a player snapshot. */
    gmNotes: z.string().max(10000).default(""),
    visibility: worldMapLocationVisibilitySchema.default("GM_ONLY"),
    x: worldMapCoordinateSchema,
    y: worldMapCoordinateSchema,
  })
  .strict();
export type CreateWorldMapLocation = z.infer<
  typeof createWorldMapLocationSchema
>;

export const updateWorldMapLocationSchema = z
  .object({
    actionId: actionIdSchema,
    locationId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(120).optional(),
    kind: worldMapLocationKindSchema.optional(),
    summary: z.string().trim().max(2000).optional(),
    gmNotes: z.string().max(10000).optional(),
    visibility: worldMapLocationVisibilitySchema.optional(),
    x: worldMapCoordinateSchema.optional(),
    y: worldMapCoordinateSchema.optional(),
  })
  .strict()
  .refine(
    (command) =>
      command.name !== undefined ||
      command.kind !== undefined ||
      command.summary !== undefined ||
      command.gmNotes !== undefined ||
      command.visibility !== undefined ||
      command.x !== undefined ||
      command.y !== undefined,
    "At least one location field is required",
  );
export type UpdateWorldMapLocation = z.infer<
  typeof updateWorldMapLocationSchema
>;

export const deleteWorldMapLocationSchema = z
  .object({
    actionId: actionIdSchema,
    locationId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type DeleteWorldMapLocation = z.infer<
  typeof deleteWorldMapLocationSchema
>;

export const linkWorldMapLocationSceneSchema = z
  .object({
    actionId: actionIdSchema,
    locationId: z.string().uuid(),
    sceneId: z.string().uuid(),
  })
  .strict();
export type LinkWorldMapLocationScene = z.infer<
  typeof linkWorldMapLocationSceneSchema
>;

export const unlinkWorldMapLocationSceneSchema =
  linkWorldMapLocationSceneSchema;
export type UnlinkWorldMapLocationScene = z.infer<
  typeof unlinkWorldMapLocationSceneSchema
>;

/** `revision: null` is the explicit create-position case; it is never travel state. */
export const setWorldMapPartyPositionSchema = z
  .object({
    actionId: actionIdSchema,
    mapId: z.string().uuid(),
    locationId: z.string().uuid(),
    revision: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type SetWorldMapPartyPosition = z.infer<
  typeof setWorldMapPartyPositionSchema
>;
/** Sticker sends identify catalog content, never its backing asset. */
const createStickerMessageBaseSchema = z
  .object({
    actionId: actionIdSchema,
    stickerId: z.string().uuid(),
  })
  .strict();
export const createStickerMessageSchema = z.union([
  createStickerMessageBaseSchema
    .extend({ threadId: z.string().uuid() })
    .strict(),
  createStickerMessageBaseSchema
    .extend({ stream: z.enum(["TABLE", "STORY"]) })
    .strict(),
]);
export type CreateStickerMessage = z.infer<typeof createStickerMessageSchema>;

export const stickerPresentationSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    altText: z.string().trim().min(1).max(240),
    assetUrl: z.string().min(1).max(2048),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
  })
  .strict();
export type StickerPresentation = z.infer<typeof stickerPresentationSchema>;

export const markChatThreadReadSchema = z.object({
  threadId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
});
export type MarkChatThreadRead = z.infer<typeof markChatThreadReadSchema>;

export const diceRequestSchema = z.object({
  actionId: actionIdSchema,
  formula: z.string().trim().min(1).max(160),
  /** The server rolls the complete formula once or twice and selects by total. */
  rollMode: z.enum(["NORMAL", "ADVANTAGE", "DISADVANTAGE"]).default("NORMAL"),
  visibility: messageVisibilitySchema.default("PUBLIC"),
  characterId: z.string().uuid().nullable().optional(),
  label: z.string().trim().max(100).optional(),
});

export const audioCommandSchema = z.discriminatedUnion("command", [
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.literal("SELECT"),
    assetId: z.string().uuid().nullable(),
  }),
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.enum(["PLAY", "PAUSE", "END"]),
  }),
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.literal("SEEK"),
    positionSeconds: z.number().min(0).max(86400),
  }),
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.literal("SET_LOOP"),
    loop: z.boolean(),
  }),
]);

/** Transitional input accepted until the music UI emits audioCommandSchema. */
export const legacyAudioStateUpdateSchema = z.object({
  actionId: actionIdSchema,
  assetId: z.string().uuid().nullable(),
  playing: z.boolean(),
  positionSeconds: z.number().min(0).max(86400),
  loop: z.boolean(),
  startedAt: z.string().datetime().nullable(),
});
export const audioStateUpdateSchema = z.union([
  audioCommandSchema,
  legacyAudioStateUpdateSchema,
]);

/**
 * UIX-382: per-track transport/mixer commands. Each active track has its own
 * independent transport (play/pause/seek/loop), so every mutation carries a
 * `trackId` alongside the existing `actionId`+`revision` idempotency/CAS
 * pair. ADD_TRACK is the one exception — it creates the row, so it has no
 * revision to check and no trackId to target.
 *
 * SELECT replaces a track's asset in place (same row, same trackId) rather
 * than requiring REMOVE_TRACK+ADD_TRACK — this preserves the track's
 * slotOrder/mixVolume/id across an asset swap, matching the legacy singular
 * SELECT behavior and keeping the mixer UI's per-track identity stable.
 */
export const audioTrackCommandSchema = z.discriminatedUnion("command", [
  z.object({
    actionId: actionIdSchema,
    command: z.literal("ADD_TRACK"),
    assetId: z.string().uuid().nullable(),
  }),
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.literal("REMOVE_TRACK"),
    trackId: z.string().uuid(),
  }),
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.literal("SELECT"),
    trackId: z.string().uuid(),
    assetId: z.string().uuid().nullable(),
  }),
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.enum(["PLAY", "PAUSE", "END"]),
    trackId: z.string().uuid(),
  }),
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.literal("SEEK"),
    trackId: z.string().uuid(),
    positionSeconds: z.number().min(0).max(86400),
  }),
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.literal("SET_LOOP"),
    trackId: z.string().uuid(),
    loop: z.boolean(),
  }),
  z.object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    command: z.literal("SET_MIX_VOLUME"),
    trackId: z.string().uuid(),
    mixVolume: z.number().min(0).max(1),
  }),
]);
export type AudioTrackCommand = z.infer<typeof audioTrackCommandSchema>;

const entryCardRequestBaseSchema = z.object({
  actionId: actionIdSchema,
  entryRevision: z.number().int().nonnegative().optional(),
  visibility: messageVisibilitySchema.default("PUBLIC"),
  /** Executes the complete formula twice and keeps one pool by total. */
  rollMode: z.enum(["NORMAL", "ADVANTAGE", "DISADVANTAGE"]).optional(),
});
export const entryCardExecuteRequestSchema = entryCardRequestBaseSchema.extend({
  mode: z.literal("EXECUTE").optional(),
  rollActionId: z.string().min(1).max(40),
});
export const entryCardShareRequestSchema = entryCardRequestBaseSchema.extend({
  mode: z.literal("SHARE"),
  rollActionId: z.never().optional(),
});
export const entryRollRequestSchema = z.union([
  entryCardExecuteRequestSchema,
  entryCardShareRequestSchema,
]);
export type EntryCardRequest = z.infer<typeof entryRollRequestSchema>;
export const campaignClockCommandSchema = z.object({
  actionId: actionIdSchema,
  command: z.enum([
    "ADVANCE_DAY",
    "LONG_REST",
    "START_BATTLE",
    "END_BATTLE",
    "RESET_CLOCK",
  ]),
  revision: z.number().int().nonnegative(),
});
export const walletSchema = z.object({
  gold: z.number().int().nonnegative(),
  silver: z.number().int().nonnegative(),
  copper: z.number().int().nonnegative(),
  sp: z.number().int().nonnegative(),
});
export const characterCountersCommandSchema = z
  .object({
    actionId: actionIdSchema,
    revision: z.number().int().nonnegative(),
    wallet: walletSchema.optional(),
    resources: z
      .record(
        z.string(),
        z.object({
          current: z.number().finite().nonnegative(),
          maximum: z.number().finite().nonnegative().optional(),
          description: z.string().max(2000).optional(),
          imageAssetId: z.string().uuid().nullable().optional(),
          recoverable: z.boolean().optional(),
        }),
      )
      .optional(),
    /**
     * UIX-425: «перевести дух» убрано — это был тот же короткий отдых, только
     * применённый к одной выносливости. Два названия для одного правила
     * заставляли мастера выбирать там, где выбора нет.
     */
    rest: z.enum(["SHORT", "LONG"]).optional(),
  })
  .refine((value) => Boolean(value.wallet || value.resources || value.rest), {
    message: "At least one counter mutation is required",
  });
export const rechargeEntryCommandSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
});

export interface AssetDto {
  id: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  url: string;
  createdAt: string;
}

export interface MembershipDto {
  id: string;
  role: Role;
  displayName: string;
  characterId: string | null;
  revision?: number;
}

export interface TokenDefinitionDto {
  id: string;
  characterId: string | null;
  defaultAssetId: string | null;
  /**
   * Имя, которое видит человек: собственное, либо унаследованное от персонажа.
   * Всегда непустое — разрешением занимается сервер.
   */
  name: string;
  /**
   * UIX-400: собственное имя определения, `null` — «зовусь как мой персонаж».
   *
   * Нужно редактору: по одному лишь `name` он не отличит намеренное имя,
   * совпавшее с персонажем, от следования за ним, и «сохранить» превратило бы
   * второе в первое.
   */
  ownName: string | null;
  defaultWidth: number;
  defaultHeight: number;
  controllerMembershipIds: string[];
  revision: number;
}

export interface CharacterDto {
  id: string;
  name: string;
  ownerMembershipId: string | null;
  controllerMembershipIds: string[];
  portraitAssetId: string | null;
  stats: Record<string, number>;
  skills: Array<{ key: string; name: string; rank: number; formula: string }>;
  spells: Array<{
    key: string;
    name: string;
    description: string;
    formula?: string;
  }>;
  notes: string;
  backstory: string;
  inventory: string[];
  resources: Record<
    string,
    {
      current: number;
      maximum?: number;
      description?: string;
      imageAssetId?: string | null;
      recoverable?: boolean;
    }
  >;
  wallet: z.infer<typeof walletSchema>;
  entries: CharacterCatalogEntryDto[];
  revision: number;
  /** UIX-393: ACTIVE unless the GM has archived the character. */
  lifecycle: "ACTIVE" | "ARCHIVED";
  archivedAt: string | null;
  archivedByMembershipId: string | null;
}
export interface CatalogEntryDto {
  id: string;
  kind: "SKILL" | "ABILITY";
  name: string;
  description: string;
  data: z.infer<typeof entryDataSchema>;
  revision: number;
}
export interface CharacterCatalogEntryDto extends CatalogEntryDto {
  sourceCatalogEntryId: string | null;
}

export interface SceneDto {
  id: string;
  name: string;
  projection: Projection;
  mapAssetId: string | null;
  width: number;
  height: number;
  backgroundFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  grid: z.infer<typeof gridSchema>;
  mapScale?: number;
  revision?: number;
  active: boolean;
}

export interface TokenDto {
  id: string;
  definitionId: string;
  definitionRevision: number;
  controllerMembershipIds: string[];
  sceneId: string;
  characterId: string | null;
  ownerMembershipId: string | null;
  assetId: string | null;
  name: string;
  x: number;
  y: number;
  z: number;
  levelId: string | null;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
  baseColor: string;
  frameColor: string | null;
  layer: z.infer<typeof tokenLayerSchema>;
  /** UIX-471: состояния этой фигуры на этой сцене. */
  conditions: TokenCondition[];
  revision: number;
}

export interface FogRevealDto {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  operation?: "REVEAL" | "COVER";
  sequence?: number;
  revision?: number;
  geometry?: import("./fog-geometry.js").FogGeometry;
  bbox?: import("./fog-geometry.js").FogBounds;
}

export interface DrawingDto {
  id: string;
  sceneId: string;
  authorMembershipId: string;
  points: number[];
  color: string;
  strokeWidth?: number;
  x: number;
  y: number;
  revision: number;
}

/** Map rows are returned only after server-side lifecycle and visibility filtering. */
export interface WorldMapDto {
  id: string;
  name: string;
  scope: WorldMapScope;
  visibility: WorldMapVisibility;
  lifecycle: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  /** Never an Eagle URL; this is a campaign asset approved by the GM. */
  backgroundAssetId: string | null;
  revision: number;
}

/** Location cards contain no inferred routes, distances, or travel state. */
export interface WorldMapLocationDto {
  id: string;
  mapId: string;
  name: string;
  kind: WorldMapLocationKind;
  /** Player-safe card text. */
  summary: string;
  visibility: WorldMapLocationVisibility;
  x: number;
  y: number;
  revision: number;
  /** Server filters inaccessible tactical-scene links before projection. */
  sceneIds: string[];
}

/** GM-only extension: never place `gmNotes` in a player projection. */
export interface WorldMapGmLocationDto extends WorldMapLocationDto {
  gmNotes: string;
}

export interface WorldMapPartyPositionDto {
  mapId: string;
  locationId: string;
  revision: number;
  updatedAt: string;
}

export interface WorldMapsSnapshotDto {
  maps: WorldMapDto[];
  locations: WorldMapLocationDto[];
  /** Present only in GM projections; player snapshots never receive notes. */
  gmLocations?: WorldMapGmLocationDto[];
  partyPosition: WorldMapPartyPositionDto | null;
}
/** Safe catalog shape returned only after pack authorization. */
export interface StickerDto {
  id: string;
  packId: string;
  name: string;
  altText: string;
  url: string;
  width: number;
  height: number;
  attribution: { authorCredit: string | null; licenseNote: string | null };
}

/** Entitlement and consent rows are intentionally not exposed. */
export interface StickerPackDto {
  id: string;
  name: string;
  subject: StickerPackSubject;
  subjectCharacterId: string | null;
  subjectMembershipId: string | null;
  subjectLabel: string | null;
  lifecycle: "ACTIVE" | "DEPRECATED";
  canSend: boolean;
  stickers: StickerDto[];
}

/** Player-safe current projection. It deliberately omits gmNotes and import provenance. */
export interface StoryPostDto {
  id: string;
  threadId: string;
  authorMembershipId: string;
  title: string;
  body: string;
  lifecycle: Exclude<StoryPostLifecycle, "DRAFT" | "ARCHIVED">;
  revision: number;
  entityLinks: StoryEntityLink[];
  media: Array<
    StoryPostMediaInput & {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      width: number | null;
      height: number | null;
      createdAt: string;
    }
  >;
  publishedAt: string;
  correctedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GM-only editing projection. Do not reuse it in player snapshots or realtime events. */
export interface StoryPostAdminDto extends Omit<
  StoryPostDto,
  "lifecycle" | "publishedAt"
> {
  lifecycle: StoryPostLifecycle;
  publishedAt: string | null;
  archivedAt: string | null;
  gmNotes: string;
  importProvenance?: {
    provider: StoryImportProvider;
    sourceMessageId: string;
    sourceAuthor: string;
    sourceTimestamp: string;
    sourceUrl: string | null;
    rightsStatus: StoryRightsStatus;
  } | null;
}

export interface StoryImportDryRunItemDto {
  sourceMessageId: string;
  action: "CREATE_DRAFT" | "ALREADY_IMPORTED";
  existingPostId: string | null;
  rightsStatus: StoryRightsStatus | null;
}

export interface StoryImportDryRunDto {
  importBatchId: string;
  provider: StoryImportProvider;
  items: StoryImportDryRunItemDto[];
}

export interface ChatMessageDto {
  id: string;
  sequence: number;
  membershipId: string;
  displayName: string;
  characterId: string | null;
  body: string;
  /** Reference only. Resolve current data from GameSnapshot.playerRequests. */
  playerRequestId?: string | null;
  visibility: MessageVisibility;
  kind: "TEXT" | "DICE" | "SYSTEM";
  threadId: string;
  stream: ChatStream | null;
  dice: DiceResult | null;
  /** Immutable v1 skill/ability card stored with the message, when present. */
  skillCard?: SkillCardSnapshot | null;
  stickerId?: string | null;
  stickerPresentation?: StickerPresentation | null;
  attachments?: ChatAttachmentMetadata[];
  createdAt: string;
}

export interface ChatThreadParticipantDto {
  membershipId: string;
  displayName: string;
}

/** Minimal campaign peer projection used only to start direct chats. */
export interface DirectChatContactDto {
  membershipId: string;
  displayName: string;
}

export interface StreamChatThreadDto {
  id: string;
  campaignId: string;
  type: "STREAM";
  stream: ChatStream;
  createdAt: string;
  updatedAt: string;
}

/** Returned only from participant-authorized direct-thread endpoints. */
export interface DirectChatThreadDto {
  id: string;
  campaignId: string;
  type: "DIRECT";
  stream: null;
  participants: [ChatThreadParticipantDto, ChatThreadParticipantDto];
  createdAt: string;
  updatedAt: string;
}

export type ChatThreadDto = StreamChatThreadDto | DirectChatThreadDto;

export interface ChatReadCursorDto {
  campaignId: string;
  threadId: string;
  lastReadSequence: number;
  updatedAt: string;
}

export interface ChatThreadStateDto {
  threadId: string;
  stream: ChatStream | null;
  lastReadSequence: number;
  latestSequence: number;
  unreadCount: number;
}

export interface DiceTerm {
  notation: string;
  rolls: number[];
  subtotal: number;
}

export type DiceSemanticOutcome = {
  kind: "NORMAL" | "CRITICAL_FAILURE" | "CRITICAL_SUCCESS";
  keptNaturalD20: number | null;
};

/** Stable curated reference. URLs are resolved from an approved bundled manifest. */
export type DiceFrameReference = {
  setKey: "ARKEN_CRITICAL_V1";
  frameKey: "critical-failure" | "critical-success";
};

/**
 * UIX-457 — откуда бросок берёт рамку.
 *
 * Источников четыре, и они не равны: рамка скилла говорит про конкретное
 * заклинание, рамка школы — про всю ветку, выбор игрока — про него самого.
 * Порядок задан явно и в одном месте, потому что «какая рамка выиграла»
 * иначе выясняется только глазами на боевой игре.
 *
 * Критическая рамка (`ARKEN_CRITICAL_V1`) в этой цепочке не участвует: она не
 * оформление, а сообщение о результате броска, и живёт своим полем `frame` в
 * `DiceResult`. Смешать их значило бы, что выбранная игроком картинка
 * перекрывает признак крита — то есть перекрывает смысл.
 */
export const DICE_FRAME_SOURCES = ["SKILL", "SCHOOL", "PLAYER"] as const;
export type DiceFrameSource = (typeof DICE_FRAME_SOURCES)[number];

export interface DiceFrameChoice {
  assetId: string;
  source: DiceFrameSource;
}

/**
 * Первый непустой источник по порядку. `null` — рамки нет вовсе, и это
 * нормальное состояние: до UIX-457 её не было ни у кого.
 */
export function resolveDiceFrame(candidates: {
  skill?: string | null;
  school?: string | null;
  player?: string | null;
}): DiceFrameChoice | null {
  if (candidates.skill) return { assetId: candidates.skill, source: "SKILL" };
  if (candidates.school)
    return { assetId: candidates.school, source: "SCHOOL" };
  if (candidates.player)
    return { assetId: candidates.player, source: "PLAYER" };
  return null;
}

export interface DiceResult {
  formula: string;
  resolvedFormula: string;
  terms: DiceTerm[];
  modifiers: Array<{ source: string; value: number }>;
  total: number;
  label?: string;
  /** Whole-pool selection metadata; absent on legacy stored results. */
  rollMode?: "NORMAL" | "ADVANTAGE" | "DISADVANTAGE";
  poolTotals?: [number, number];
  selectedPool?: 0 | 1;
  /** Authoritative server outcome; absent only on legacy history rows. */
  semanticOutcome?: DiceSemanticOutcome;
  /** Immutable curated frame reference stored with chat history. */
  frame?: DiceFrameReference | null;
}

export interface SkillCardEntrySnapshot {
  id: string;
  revision: number;
  sourceCatalogEntryId: string | null;
  kind: "SKILL" | "ABILITY";
  name: string;
  description: string;
  notes: string | null;
}
export interface SkillCardActionSnapshot {
  id: string;
  kind: "HIT" | "DAMAGE" | "CUSTOM";
  label: string;
  dice: string;
  advantage: boolean;
  consumeUse: boolean;
}
/** Stored with the message; never rebuilt from mutable catalog rows. */
export interface SkillCardSnapshot {
  version: 1;
  execution: "EXECUTED" | "SHARED";
  entry: SkillCardEntrySnapshot;
  actor: {
    membershipId: string;
    displayName: string;
    characterId: string;
    characterName: string;
  };
  action: SkillCardActionSnapshot | null;
  formula: string | null;
  result: DiceResult | null;
  uses: {
    before: number;
    after: number;
    max: number;
    recharge: "DAY" | "BATTLE" | "WEEK";
  } | null;
  visibility: MessageVisibility;
}

export interface AudioStateDto {
  assetId: string | null;
  playing: boolean;
  positionSeconds: number;
  loop: boolean;
  startedAt: string | null;
  revision: number;
  updatedAt: string;
}

/** UIX-382: per-track audio state (multi-track mixer, independent transport). */
export interface AudioTrackDto {
  id: string;
  assetId: string | null;
  mixVolume: number;
  playing: boolean;
  positionSeconds: number;
  loop: boolean;
  startedAt: string | null;
  slotOrder: number;
  revision: number;
  updatedAt: string;
}

/**
 * UIX-431: строка очереди в том виде, в каком её показывают.
 *
 * `name` уже разрешено — от токена или собственное, как у определений токенов в
 * UIX-400. `ownName` отдаётся рядом по той же причине, что и там: редактор
 * обязан отличать «зовусь как токен» от намеренной копии, иначе первое же
 * сохранение молча превратит одно в другое.
 */
export interface InitiativeParticipantDto {
  id: string;
  tokenId: string | null;
  name: string;
  ownName: string | null;
  initiative: number | null;
  /**
   * UIX-466: бонус к инициативе персонажа. Мастеру он нужен, чтобы понимать, к
   * чему прибавлять результат физического куба, брошенного за столом. `null` —
   * у строки нет персонажа (участник вне карты) либо характеристики у него нет.
   */
  initiativeBonus: number | null;
  /**
   * UIX-466: может ли **этот** человек править значение строки. Мастер правит
   * все, игрок — только свою.
   *
   * Право приходит с сервера, а не выводится на клиенте: тому пришлось бы
   * заново решать, чей это персонаж, по данным, которых у него про чужих нет.
   * Проверку на маршруте это не заменяет — поле только про то, рисовать ли поле
   * ввода.
   */
  canEdit: boolean;
  /**
   * UIX-466: строка стоит на месте, назначенном мастером, и сортировка её не
   * трогает. Игроку поле приезжает тоже — оно объясняет, почему чей-то ход не
   * поднялся после большого броска, а без объяснения это выглядит как ошибка.
   */
  pinned: boolean;
}

/**
 * UIX-454 — минимальная публичная личность персонажа: кто бросил кубик.
 *
 * Отдельно от `CharacterDto` намеренно. Тот приходит только владельцу и
 * мастеру и несёт характеристики, ресурсы, заметки; здесь — имя и портрет тех,
 * кто и так сидит за столом, и ничего сверх. Одно поле «а покажем ещё и...»
 * превратило бы сводку в утечку карточки.
 */
export interface PublicCharacterIdentityDto {
  id: string;
  name: string;
  portraitAssetId: string | null;
  /**
   * UIX-454: миниатюра токена персонажа. Мастер выбрал её как аватар в ленте
   * бросков: на карте игрока узнают именно по токену, и в ленте он читается
   * быстрее портрета — портрет там размером с ноготь.
   *
   * Портрет остаётся запасным: у персонажа может не быть ни одного токена с
   * картинкой.
   */
  tokenAssetId: string | null;
}

export interface GameSnapshot {
  campaign: {
    id: string;
    name: string;
    day: number;
    battleActive: boolean;
    battleCounter: number;
    /** UIX-424: раскладка характеристик кампании (см. `statLayoutSchema`). */
    statLayout: StatLayout;
    /**
     * UIX-431: очередь ходов в порядке ходов.
     *
     * Игроку приходят только строки, чей токен он и так видит: строка со
     * скрытым токеном не отправляется вовсе, без заглушки «???». Заглушка
     * выдала бы численность засады — ровно та утечка, которую закрыл UIX-449.
     * Плата за это — у игрока список короче, чем у мастера, и номера ходов не
     * совпадают; очередь ведёт мастер, панель информационная.
     */
    initiative: InitiativeParticipantDto[];
    /**
     * UIX-466: зона боя. Только у мастера — игроку она выдала бы, где мастер
     * собирается драться, ещё до начала боя.
     */
    battleZone: BattleZone | null;
    revision: number;
  };
  me: MembershipDto;
  members: MembershipDto[];
  /** Safe peers available to the current member for a direct chat. */
  directChatContacts?: DirectChatContactDto[];
  characters: CharacterDto[];
  /**
   * UIX-454: имя и портрет персонажей с владельцем или управляющим — чтобы
   * лента бросков показывала, кто бросает, а не слово «Персонаж».
   */
  characterIdentities: PublicCharacterIdentityDto[];
  catalogEntries: CatalogEntryDto[];
  scenes: SceneDto[];
  tokens: TokenDto[];
  tokenDefinitions?: TokenDefinitionDto[];
  fogReveals: FogRevealDto[];
  drawings?: DrawingDto[];
  /** Durable request projection, independently loaded from the chat window. */
  playerRequests?: PlayerRequestDto[];
  /** UIX-311 encounter lifecycle; absent until the feature is loaded. */
  encounters?: EncounterDto[];
  /** Filtered world/region map projection; absent until the feature is loaded. */
  worldMaps?: WorldMapsSnapshotDto;
  messages: ChatMessageDto[];
  chatThreads: ChatThreadDto[];
  chatThreadStates: ChatThreadStateDto[];
  assets: AssetDto[];
  /**
   * UIX-382 compat: mirrors the "slot 0" track (the legacy singular audio
   * slot) so the not-yet-updated MusicBar client keeps working unmodified.
   * New clients should read `audioTracks` instead.
   */
  audio: AudioStateDto;
  /** UIX-382: full multi-track mixer state, ordered by slotOrder. */
  audioTracks: AudioTrackDto[];
  snapshotVersion: number;
  schemaVersion: number;
  buildVersion: string;
  buildRevision: string;
  serverTime: string;
}

export interface EventEnvelope<T> {
  sequence: number;
  actionId: string;
  emittedAt: string;
  data: T;
}

export interface CommandAck<T = unknown> {
  ok: boolean;
  status: "ACCEPTED" | "DUPLICATE" | "CONFLICT" | "FORBIDDEN" | "INVALID";
  sequence?: number;
  data?: T;
  reason?: string;
}

export interface MapPing {
  sceneId: string;
  membershipId: string;
  displayName: string;
  x: number;
  y: number;
  createdAt: string;
}

export interface StoryChangedEvent {
  campaignId: string;
  postId: string | null;
}

export interface ServerToClientEvents {
  "game:snapshot": (snapshot: GameSnapshot) => void;
  "presence:updated": (
    members: Array<{ membershipId: string; online: boolean }>,
  ) => void;
  "scene:activated": (event: EventEnvelope<string>) => void;
  "token:moving": (movement: z.infer<typeof moveTokenSchema>) => void;
  "token:moved": (event: EventEnvelope<TokenDto>) => void;
  "fog:created": (event: EventEnvelope<FogRevealDto>) => void;
  "fog:removed": (
    event: EventEnvelope<{ fogRevealId: string; sceneId: string }>,
  ) => void;
  "chat:created": (event: EventEnvelope<ChatMessageDto>) => void;
  "story:changed": (event: StoryChangedEvent) => void;
  "player-request:changed": (request: PlayerRequestDto) => void;
  "chat:thread_created": (event: {
    thread: DirectChatThreadDto;
    state: ChatThreadStateDto;
  }) => void;
  "character:updated": (event: EventEnvelope<CharacterDto>) => void;
  "audio:state": (event: EventEnvelope<AudioStateDto>) => void;
  /** UIX-382: broadcast when a track is added, mutated, or its asset is swapped. */
  "audio:track:state": (event: EventEnvelope<AudioTrackDto>) => void;
  /** UIX-382: broadcast when a track is removed from the mixer. */
  "audio:track:removed": (event: EventEnvelope<{ trackId: string }>) => void;
  "map:ping": (ping: MapPing) => void;
  "ruler:updated": (
    ruler: z.infer<typeof rulerUpdateSchema> & {
      membershipId: string;
      displayName: string;
      distance: number;
    },
  ) => void;
  "ruler:cleared": (ruler: { sceneId: string; membershipId: string }) => void;
  /**
   * UIX-392/UIX-403: ephemeral cursor presence. Player cursors go to the full
   * campaign room; a GM cursor goes to the GM room unless that GM has chosen
   * to share it (`shared` on `cursor:move`). Not persisted — see
   * `cursorMoveSchema` above.
   */
  "cursor:moved": (cursor: {
    membershipId: string;
    displayName: string;
    role: Role;
    sceneId: string;
    x: number;
    y: number;
  }) => void;
  "cursor:gone": (event: { membershipId: string }) => void;
  "server:error": (error: { code: string; message: string }) => void;
}

export interface ClientToServerEvents {
  "token:moving": (movement: z.infer<typeof moveTokenSchema>) => void;
  "token:moved": (
    movement: z.infer<typeof moveTokenSchema>,
    ack?: (result: CommandAck<TokenDto>) => void,
  ) => void;
  "audio:set": (
    state: z.infer<typeof audioStateUpdateSchema>,
    ack?: (result: CommandAck<AudioStateDto>) => void,
  ) => void;
  /** UIX-382: per-track mixer commands (independent transport per track). */
  "audio:track:set": (
    command: z.infer<typeof audioTrackCommandSchema>,
    ack?: (result: CommandAck<AudioTrackDto>) => void,
  ) => void;
  "map:ping": (
    ping: { sceneId: string; x: number; y: number },
    ack?: (result: { ok: boolean; reason?: string }) => void,
  ) => void;
  "ruler:update": (ruler: z.infer<typeof rulerUpdateSchema>) => void;
  "ruler:clear": (ruler: { sceneId: string }) => void;
  /** UIX-392: rAF-batched pointer position; ignored if it fails validation or arrives faster than the server-side rate floor. */
  "cursor:move": (cursor: z.infer<typeof cursorMoveSchema>) => void;
  /** UIX-392: explicit "no longer pointing at anything" signal (scene switch, blur, inactivity). */
  "cursor:gone": () => void;
  /**
   * UIX-408 — какую сцену мастер сейчас рассматривает.
   *
   * Мастер может открыть сцену, не переключая на неё игроков: `viewedSceneId`
   * живёт локальным состоянием клиента, и сервер о нём не знает ничего. Чтобы
   * сузить выборку тумана и рисунков до нужных сцен, а не тянуть все шесть,
   * это знание надо сообщить.
   *
   * `null` — вернулся к транслируемой сцене. Событие игроку бессмысленно: у
   * него видима ровно активная сцена, и сервер его от игрока не принимает.
   */
  "scene:view": (view: z.infer<typeof sceneViewSchema>) => void;
  "game:resync": (knownSequence?: number) => void;
}

/**
 * World Content (UIX-245 Stage 1): canonical, campaign-independent
 * encyclopedia entities. See `packages/db/src/schema.ts`'s `worldContent`
 * doc comment for why these are not campaign-scoped.
 *
 * Two DTOs exist deliberately: `WorldContentDto` (GM) carries `gmOnlyText`
 * and provenance; `WorldContentPlayerDto` (non-GM) has no such field at
 * all — the ACL helper in `apps/server/src/world-content.ts` must build the
 * latter from a query that never selects `gm_only_text`, not merely omit it
 * client-side (AC4).
 */
export const worldContentTypeSchema = z.enum([
  "LOCATION",
  "PERSON",
  "MONSTER",
  "DEITY",
  "FACTION",
  "ITEM",
  "ARTICLE",
]);
export const worldContentLifecycleSchema = z.enum([
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
]);
export const worldContentReviewStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);
export type WorldContentType = z.infer<typeof worldContentTypeSchema>;
export type WorldContentLifecycle = z.infer<typeof worldContentLifecycleSchema>;
export type WorldContentReviewStatus = z.infer<
  typeof worldContentReviewStatusSchema
>;

const worldContentAliasesSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(50);
const worldContentTagsSchema = z
  .array(z.string().trim().min(1).max(60))
  .max(50);
const worldContentSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be kebab-case lowercase");

/** Provenance is fully optional/nullable: GM-authored-from-scratch entities have none. */
export const worldContentProvenanceSchema = z
  .object({
    sourceUrl: z.string().url().nullable(),
    sourceExternalId: z.string().trim().min(1).max(200).nullable(),
    retrievedAt: z.string().datetime().nullable(),
    rawContentHash: z.string().trim().min(1).max(200).nullable(),
    attribution: z.string().trim().min(1).max(500).nullable(),
    rightsReviewStatus: worldContentReviewStatusSchema.nullable(),
    editorialApprovalStatus: worldContentReviewStatusSchema.nullable(),
  })
  .strict();
export type WorldContentProvenance = z.infer<
  typeof worldContentProvenanceSchema
>;

/** GM-facing DTO: includes `gmOnlyText` and full provenance. Never send this to a non-GM caller. */
export const worldContentDtoSchema = z.object({
  id: z.string().uuid(),
  slug: worldContentSlugSchema,
  type: worldContentTypeSchema,
  subtype: z.string().nullable(),
  name: z.string(),
  aliases: worldContentAliasesSchema,
  summary: z.string(),
  publicText: z.string(),
  gmOnlyText: z.string(),
  tags: worldContentTagsSchema,
  lifecycle: worldContentLifecycleSchema,
  coverAssetId: z.string().uuid().nullable(),
  provenance: worldContentProvenanceSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorldContentDto = z.infer<typeof worldContentDtoSchema>;

/**
 * Non-GM (player) projection: PUBLISHED entities only, no `gmOnlyText`, no
 * provenance (internal editorial metadata). See the module doc comment.
 */
export const worldContentPlayerDtoSchema = z.object({
  id: z.string().uuid(),
  slug: worldContentSlugSchema,
  type: worldContentTypeSchema,
  subtype: z.string().nullable(),
  name: z.string(),
  aliases: worldContentAliasesSchema,
  summary: z.string(),
  publicText: z.string(),
  tags: worldContentTagsSchema,
  coverAssetId: z.string().uuid().nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type WorldContentPlayerDto = z.infer<typeof worldContentPlayerDtoSchema>;

export const createWorldContentSchema = z
  .object({
    actionId: z.string().uuid(),
    slug: worldContentSlugSchema,
    type: worldContentTypeSchema,
    subtype: z.string().trim().min(1).max(120).nullable().optional(),
    name: z.string().trim().min(1).max(200),
    aliases: worldContentAliasesSchema.optional(),
    summary: z.string().trim().max(2000).optional(),
    publicText: z.string().max(50000).optional(),
    gmOnlyText: z.string().max(50000).optional(),
    tags: worldContentTagsSchema.optional(),
    coverAssetId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CreateWorldContent = z.infer<typeof createWorldContentSchema>;

export const updateWorldContentSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    subtype: z.string().trim().min(1).max(120).nullable().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    aliases: worldContentAliasesSchema.optional(),
    summary: z.string().trim().max(2000).optional(),
    publicText: z.string().max(50000).optional(),
    gmOnlyText: z.string().max(50000).optional(),
    tags: worldContentTagsSchema.optional(),
    coverAssetId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type UpdateWorldContent = z.infer<typeof updateWorldContentSchema>;

/** DRAFT -> PUBLISHED -> ARCHIVED (or DRAFT -> ARCHIVED); the server enforces legal transitions. */
export const transitionWorldContentLifecycleSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    lifecycle: worldContentLifecycleSchema,
  })
  .strict();
export type TransitionWorldContentLifecycle = z.infer<
  typeof transitionWorldContentLifecycleSchema
>;

export const worldContentMediaDtoSchema = z.object({
  id: z.string().uuid(),
  worldContentId: z.string().uuid(),
  assetId: z.string().uuid(),
  caption: z.string().nullable(),
  ordering: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type WorldContentMediaDto = z.infer<typeof worldContentMediaDtoSchema>;

export const addWorldContentMediaSchema = z
  .object({
    actionId: z.string().uuid(),
    assetId: z.string().uuid(),
    caption: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();
export type AddWorldContentMedia = z.infer<typeof addWorldContentMediaSchema>;

/**
 * A relation between two canonical entities (e.g. a PERSON related to a
 * FACTION). `relationType` is intentionally free-form text, not an enum —
 * see `worldContentRelations` in `packages/db/src/schema.ts`.
 */
export const worldContentRelationDtoSchema = z.object({
  id: z.string().uuid(),
  fromWorldContentId: z.string().uuid(),
  toWorldContentId: z.string().uuid(),
  relationType: z.string(),
  note: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorldContentRelationDto = z.infer<
  typeof worldContentRelationDtoSchema
>;

export const createWorldContentRelationSchema = z
  .object({
    actionId: z.string().uuid(),
    toWorldContentId: z.string().uuid(),
    relationType: z.string().trim().min(1).max(60),
    note: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();
export type CreateWorldContentRelation = z.infer<
  typeof createWorldContentRelationSchema
>;

/** Relation deletion carries no CAS revision — deleting an edge is not a partial-field update. */
export const deleteWorldContentRelationSchema = z
  .object({
    actionId: z.string().uuid(),
  })
  .strict();
export type DeleteWorldContentRelation = z.infer<
  typeof deleteWorldContentRelationSchema
>;

/** Recaption/reorder for an already-attached gallery entry. `world_content_media` carries no `revision` column, so there is no CAS check here — mirrors the table shape, not an oversight. */
export const updateWorldContentMediaSchema = z
  .object({
    actionId: z.string().uuid(),
    caption: z.string().trim().min(1).max(500).nullable().optional(),
    ordering: z.number().int().nonnegative().optional(),
  })
  .strict();
export type UpdateWorldContentMedia = z.infer<
  typeof updateWorldContentMediaSchema
>;

export const removeWorldContentMediaSchema = z
  .object({
    actionId: z.string().uuid(),
  })
  .strict();
export type RemoveWorldContentMedia = z.infer<
  typeof removeWorldContentMediaSchema
>;

/**
 * `GET /api/world-content/:id/relations` response entry (UIX-245 Stage 4).
 * `entity` is the *other* side of the edge, projected down to the minimal
 * player-safe shape (id/slug/type/name) — enough to render a link, never the
 * full DTO. `direction` tells the caller whether `entity` is the target
 * (`OUTGOING`: this entity -> entity) or the source (`INCOMING`: entity ->
 * this entity); the edge is symmetric for display purposes either way.
 */
export const worldContentRelationEdgeDtoSchema = z.object({
  id: z.string().uuid(),
  relationType: z.string(),
  note: z.string().nullable(),
  direction: z.enum(["OUTGOING", "INCOMING"]),
  entity: z.object({
    id: z.string().uuid(),
    slug: worldContentSlugSchema,
    type: worldContentTypeSchema,
    name: z.string(),
  }),
});
export type WorldContentRelationEdgeDto = z.infer<
  typeof worldContentRelationEdgeDtoSchema
>;

/** GM-only soft-delete: transitions lifecycle to ARCHIVED under the same CAS discipline as `updateWorldContentSchema`. */
export const deleteWorldContentSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type DeleteWorldContent = z.infer<typeof deleteWorldContentSchema>;

/**
 * Campaign-scoped instance of a canonical `worldContent` entity (UIX-264,
 * child of UIX-245). See `world_content_instances` in
 * `packages/db/src/schema.ts` for the full architectural rationale
 * (campaign-cascade, no-FK-cascade to canon, composite location FK, etc).
 *
 * GM-only, entirely: unlike `worldContentDtoSchema`/`worldContentPlayerDtoSchema`,
 * there is deliberately no player-facing projection here yet. UIX-264's AC
 * ("player APIs never expose... GM fields") implies instances will
 * eventually feed a player-visible campaign state (e.g. "this NPC is now
 * visibly wounded"), but that projection is a future integration point, not
 * built speculatively in this pass — every route that reads or writes an
 * instance requires the GM role.
 */
export const worldContentInstanceDtoSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  worldContentId: z.string().uuid(),
  displayNameOverride: z.string().nullable(),
  currentState: z.string().nullable(),
  gmNotes: z.string().nullable(),
  portraitAssetId: z.string().uuid().nullable(),
  ownerMembershipId: z.string().uuid().nullable(),
  currentLocationId: z.string().uuid().nullable(),
  quantity: z.number().int().nonnegative().nullable(),
  condition: z.string().nullable(),
  discovered: z.boolean(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorldContentInstanceDto = z.infer<
  typeof worldContentInstanceDtoSchema
>;

export const createWorldContentInstanceSchema = z
  .object({
    actionId: z.string().uuid(),
    worldContentId: z.string().uuid(),
    displayNameOverride: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .nullable()
      .optional(),
    currentState: z.string().trim().max(4000).nullable().optional(),
    gmNotes: z.string().trim().max(20000).nullable().optional(),
    portraitAssetId: z.string().uuid().nullable().optional(),
    ownerMembershipId: z.string().uuid().nullable().optional(),
    currentLocationId: z.string().uuid().nullable().optional(),
    quantity: z.number().int().nonnegative().nullable().optional(),
    condition: z.string().trim().min(1).max(200).nullable().optional(),
    discovered: z.boolean().optional(),
  })
  .strict();
export type CreateWorldContentInstance = z.infer<
  typeof createWorldContentInstanceSchema
>;

export const updateWorldContentInstanceSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    displayNameOverride: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .nullable()
      .optional(),
    currentState: z.string().trim().max(4000).nullable().optional(),
    gmNotes: z.string().trim().max(20000).nullable().optional(),
    portraitAssetId: z.string().uuid().nullable().optional(),
    ownerMembershipId: z.string().uuid().nullable().optional(),
    currentLocationId: z.string().uuid().nullable().optional(),
    quantity: z.number().int().nonnegative().nullable().optional(),
    condition: z.string().trim().min(1).max(200).nullable().optional(),
    discovered: z.boolean().optional(),
  })
  .strict();
export type UpdateWorldContentInstance = z.infer<
  typeof updateWorldContentInstanceSchema
>;

/**
 * Hard delete, CAS-protected: unlike `deleteWorldContentSchema` (which
 * transitions canon to ARCHIVED), instances are mutable campaign state, not
 * durable canon — see the route handler's doc comment in
 * `apps/server/src/world-content-instances.ts` for the full reasoning.
 */
export const deleteWorldContentInstanceSchema = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type DeleteWorldContentInstance = z.infer<
  typeof deleteWorldContentInstanceSchema
>;
