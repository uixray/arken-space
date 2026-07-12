import { z } from "zod";

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

export type Role = z.infer<typeof roleSchema>;
export type Projection = z.infer<typeof projectionSchema>;
export type AssetKind = z.infer<typeof assetKindSchema>;
export type MessageVisibility = z.infer<typeof messageVisibilitySchema>;

export const actionIdSchema = z.string().uuid();

export const gmLoginSchema = z.object({ token: z.string().min(32).max(512) });
export const inviteClaimSchema = z.object({
  token: z.string().min(32).max(512),
  displayName: z.string().trim().min(1).max(40),
});
export const createInviteSchema = z.object({
  actionId: actionIdSchema,
  characterId: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  expiresInHours: z.number().int().min(1).max(720).default(168),
});

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

export const createSceneSchema = z.object({
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
});

export const activateSceneSchema = z.object({
  actionId: actionIdSchema,
  sceneId: z.string().uuid(),
});

export const createTokenSchema = z.object({
  actionId: actionIdSchema,
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

export const createFogRevealSchema = z.object({
  actionId: actionIdSchema,
  sceneId: z.string().uuid(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(16384),
  height: z.number().positive().max(16384),
});

export const undoFogRevealSchema = z.object({
  actionId: actionIdSchema,
  sceneId: z.string().uuid(),
});

export const characterUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  portraitAssetId: z.string().uuid().nullable().optional(),
  stats: z.record(z.string(), z.number().finite()).optional(),
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
});

export const characterCommandSchema = characterUpdateSchema.extend({
  actionId: actionIdSchema,
});

export const createChatMessageSchema = z.object({
  actionId: actionIdSchema,
  body: z.string().trim().min(1).max(4000),
  visibility: messageVisibilitySchema.default("PUBLIC"),
  characterId: z.string().uuid().nullable().optional(),
});

export const diceRequestSchema = z.object({
  actionId: actionIdSchema,
  formula: z.string().trim().min(1).max(160),
  visibility: messageVisibilitySchema.default("PUBLIC"),
  characterId: z.string().uuid().nullable().optional(),
  label: z.string().trim().max(100).optional(),
});

export const audioStateUpdateSchema = z.object({
  actionId: actionIdSchema,
  assetId: z.string().uuid().nullable(),
  playing: z.boolean(),
  positionSeconds: z.number().min(0).max(86400),
  loop: z.boolean(),
  startedAt: z.string().datetime().nullable(),
});

export interface AssetDto {
  id: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string;
  createdAt: string;
}

export interface MembershipDto {
  id: string;
  role: Role;
  displayName: string;
  characterId: string | null;
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
  revision: number;
}

export interface SceneDto {
  id: string;
  name: string;
  projection: Projection;
  mapAssetId: string | null;
  width: number;
  height: number;
  grid: z.infer<typeof gridSchema>;
  active: boolean;
}

export interface TokenDto {
  id: string;
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
  revision: number;
}

export interface FogRevealDto {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChatMessageDto {
  id: string;
  membershipId: string;
  displayName: string;
  characterId: string | null;
  body: string;
  visibility: MessageVisibility;
  kind: "TEXT" | "DICE" | "SYSTEM";
  dice: DiceResult | null;
  createdAt: string;
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
  updatedAt: string;
}

export interface GameSnapshot {
  campaign: { id: string; name: string };
  me: MembershipDto;
  members: MembershipDto[];
  characters: CharacterDto[];
  scenes: SceneDto[];
  tokens: TokenDto[];
  fogReveals: FogRevealDto[];
  messages: ChatMessageDto[];
  assets: AssetDto[];
  audio: AudioStateDto;
  snapshotVersion: number;
  schemaVersion: number;
  buildVersion: string;
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
  "character:updated": (event: EventEnvelope<CharacterDto>) => void;
  "audio:state": (event: EventEnvelope<AudioStateDto>) => void;
  "map:ping": (ping: MapPing) => void;
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
  "map:ping": (ping: { sceneId: string; x: number; y: number }) => void;
  "game:resync": (knownSequence?: number) => void;
}
