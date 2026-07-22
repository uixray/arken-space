import { z } from "zod";
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
export const messageVisibilitySchema = z.enum(["PUBLIC", "GM_ONLY"]);
export const chatStreamSchema = z.enum(["ROLLS", "STORY", "TABLE"]);
export const chatThreadTypeSchema = z.enum(["STREAM", "DIRECT"]);

export type Role = z.infer<typeof roleSchema>;
export type Projection = z.infer<typeof projectionSchema>;
export type AssetKind = z.infer<typeof assetKindSchema>;
export type MessageVisibility = z.infer<typeof messageVisibilitySchema>;
export type ChatStream = z.infer<typeof chatStreamSchema>;
export type ChatThreadType = z.infer<typeof chatThreadTypeSchema>;

export const actionIdSchema = z.string().uuid();
export const tokenLayerSchema = z.enum(["MAP", "GM", "PLAYER"]);
export const catalogEntryKindSchema = z.enum(["SKILL", "ABILITY"]);
export const rollActionKindSchema = z.enum(["HIT", "DAMAGE", "CUSTOM"]);
export const modifierSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CHARACTERISTIC"),
    key: z.enum([
      "strength",
      "agility",
      "endurance",
      "vitality",
      "knowledge",
      "intelligence",
      "willpower",
      "charisma",
    ]),
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
export const rollActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  kind: rollActionKindSchema,
  label: z.string().trim().min(1).max(100),
  dice: z.string().regex(/^\d{0,2}d(?:2|4|6|8|10|12|20|100)(?:kh1)?$/),
  modifiers: z.array(modifierSourceSchema).max(12).default([]),
  order: z.number().int().min(0).max(1000),
  advantage: z.boolean().default(false),
  consumeUse: z.boolean().default(false),
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
export const fixedCharacteristicsSchema = z.object({
  strength: z.number().finite(),
  agility: z.number().finite(),
  endurance: z.number().finite(),
  vitality: z.number().finite(),
  knowledge: z.number().finite(),
  intelligence: z.number().finite(),
  willpower: z.number().finite(),
  charisma: z.number().finite(),
});

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

export const createTokenSchema = z.object({
  actionId: actionIdSchema,
  definitionId: z.string().uuid().optional(),
  sceneId: z.string().uuid(),
  characterId: z.string().uuid().nullable().optional(),
  ownerMembershipId: z.string().uuid().nullable().optional(),
  assetId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(80),
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
export const placeTokenDefinitionSchema = z.object({
  actionId: actionIdSchema,
  definitionId: z.string().uuid(),
  sceneId: z.string().uuid().optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
});
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
  name: z.string().trim().min(1).max(80).optional(),
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

export const createFogRevealSchema = z.object({
  actionId: actionIdSchema,
  sceneId: z.string().uuid(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(16384),
  height: z.number().positive().max(16384),
  operation: z.enum(["REVEAL", "COVER"]).default("REVEAL"),
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
export const rulerUpdateSchema = z.object({
  sceneId: z.string().uuid(),
  startX: z.number().finite(),
  startY: z.number().finite(),
  endX: z.number().finite(),
  endY: z.number().finite(),
});

export const characterUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  portraitAssetId: z.string().uuid().nullable().optional(),
  // Character edits may update one characteristic at a time. The server merges
  // this patch into the canonical fixed set instead of replacing the object.
  stats: fixedCharacteristicsSchema.partial().optional(),
  skills: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        rank: z.number(),
        formula: z.string(),
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
    stream: chatStreamSchema.default("TABLE"),
  }),
]);
export type CreateStreamChatMessage = z.infer<
  typeof createStreamChatMessageSchema
>;

/** @deprecated Use createStreamChatMessageSchema; retained for existing routes. */
export const createChatMessageSchema = createStreamChatMessageSchema;

export const markChatThreadReadSchema = z.object({
  threadId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
});
export type MarkChatThreadRead = z.infer<typeof markChatThreadReadSchema>;

export const diceRequestSchema = z.object({
  actionId: actionIdSchema,
  formula: z.string().trim().min(1).max(160),
  /** The server expands one d20 into a kept pair; the client never rolls it. */
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
export const entryRollRequestSchema = z.object({
  actionId: actionIdSchema,
  rollActionId: z.string(),
  visibility: messageVisibilitySchema.default("PUBLIC"),
});
export const campaignClockCommandSchema = z.object({
  actionId: actionIdSchema,
  command: z.enum(["ADVANCE_DAY", "START_BATTLE", "END_BATTLE"]),
  revision: z.number().int().nonnegative(),
});
export const walletSchema = z.object({
  gold: z.number().int().nonnegative(),
  silver: z.number().int().nonnegative(),
  copper: z.number().int().nonnegative(),
  sp: z.number().int().nonnegative(),
});
export const characterCountersCommandSchema = z.object({
  actionId: actionIdSchema,
  revision: z.number().int().nonnegative(),
  wallet: walletSchema.optional(),
  resources: z
    .record(
      z.string(),
      z.object({
        current: z.number().finite().nonnegative(),
        maximum: z.number().finite().nonnegative().optional(),
      }),
    )
    .optional(),
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
  name: string;
  defaultWidth: number;
  defaultHeight: number;
  controllerMembershipIds: string[];
  revision: number;
}

export interface CharacterDto {
  id: string;
  name: string;
  ownerMembershipId: string | null;
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
  resources: Record<string, { current: number; maximum?: number }>;
  wallet: z.infer<typeof walletSchema>;
  entries: CharacterCatalogEntryDto[];
  revision: number;
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
}

export interface DrawingDto {
  id: string;
  sceneId: string;
  authorMembershipId: string;
  points: number[];
  color: string;
  x: number;
  y: number;
  revision: number;
}

export interface ChatMessageDto {
  id: string;
  sequence: number;
  membershipId: string;
  displayName: string;
  characterId: string | null;
  body: string;
  visibility: MessageVisibility;
  kind: "TEXT" | "DICE" | "SYSTEM";
  threadId: string;
  stream: ChatStream | null;
  dice: DiceResult | null;
  attachments?: ChatAttachmentMetadata[];
  createdAt: string;
}

export interface ChatThreadParticipantDto {
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

export interface DiceResult {
  formula: string;
  resolvedFormula: string;
  terms: DiceTerm[];
  modifiers: Array<{ source: string; value: number }>;
  total: number;
  label?: string;
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

export interface GameSnapshot {
  campaign: {
    id: string;
    name: string;
    day: number;
    battleActive: boolean;
    battleCounter: number;
    revision: number;
  };
  me: MembershipDto;
  members: MembershipDto[];
  characters: CharacterDto[];
  catalogEntries: CatalogEntryDto[];
  scenes: SceneDto[];
  tokens: TokenDto[];
  tokenDefinitions?: TokenDefinitionDto[];
  fogReveals: FogRevealDto[];
  drawings?: DrawingDto[];
  messages: ChatMessageDto[];
  chatThreads: ChatThreadDto[];
  chatThreadStates: ChatThreadStateDto[];
  assets: AssetDto[];
  audio: AudioStateDto;
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
  "chat:thread_created": (event: {
    thread: DirectChatThreadDto;
    state: ChatThreadStateDto;
  }) => void;
  "character:updated": (event: EventEnvelope<CharacterDto>) => void;
  "audio:state": (event: EventEnvelope<AudioStateDto>) => void;
  "map:ping": (ping: MapPing) => void;
  "ruler:updated": (
    ruler: z.infer<typeof rulerUpdateSchema> & {
      membershipId: string;
      displayName: string;
      distance: number;
    },
  ) => void;
  "ruler:cleared": (ruler: { sceneId: string; membershipId: string }) => void;
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
  "map:ping": (
    ping: { sceneId: string; x: number; y: number },
    ack?: (result: { ok: boolean; reason?: string }) => void,
  ) => void;
  "ruler:update": (ruler: z.infer<typeof rulerUpdateSchema>) => void;
  "ruler:clear": (ruler: { sceneId: string }) => void;
  "game:resync": (knownSequence?: number) => void;
}
