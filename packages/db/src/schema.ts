import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["GM", "PLAYER"]);
export const projectionEnum = pgEnum("projection", [
  "ORTHOGRAPHIC_2D",
  "ISOMETRIC",
  "THREE_D",
]);
export const assetKindEnum = pgEnum("asset_kind", [
  "MAP",
  "TOKEN",
  "PORTRAIT",
  "IMAGE",
  "AUDIO",
]);
export const messageVisibilityEnum = pgEnum("message_visibility", [
  "PUBLIC",
  "GM_ONLY",
]);
export const messageKindEnum = pgEnum("message_kind", [
  "TEXT",
  "DICE",
  "SYSTEM",
]);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  systemId: text("system_id").notNull().default("arken-core"),
  systemVersion: integer("system_version").notNull().default(1),
  activeSceneId: uuid("active_scene_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("memberships_campaign_idx").on(table.campaignId)],
);

export const assets = pgTable("assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  uploadedByMembershipId: uuid("uploaded_by_membership_id")
    .notNull()
    .references(() => memberships.id),
  kind: assetKindEnum("kind").notNull(),
  name: text("name").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    ownerMembershipId: uuid("owner_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    portraitAssetId: uuid("portrait_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    skills: jsonb("skills")
      .$type<
        Array<{ key: string; name: string; rank: number; formula: string }>
      >()
      .notNull()
      .default([]),
    spells: jsonb("spells")
      .$type<
        Array<{
          key: string;
          name: string;
          description: string;
          formula?: string;
        }>
      >()
      .notNull()
      .default([]),
    notes: text("notes").notNull().default(""),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("characters_campaign_idx").on(table.campaignId)],
);

export const scenes = pgTable(
  "scenes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    projection: projectionEnum("projection")
      .notNull()
      .default("ORTHOGRAPHIC_2D"),
    mapAssetId: uuid("map_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    width: integer("width").notNull().default(1920),
    height: integer("height").notNull().default(1080),
    grid: jsonb("grid")
      .$type<{
        enabled: boolean;
        size: number;
        offsetX: number;
        offsetY: number;
        color: string;
        opacity: number;
      }>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("scenes_campaign_idx").on(table.campaignId)],
);

export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "set null",
    }),
    ownerMembershipId: uuid("owner_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    levelId: uuid("level_id"),
    name: text("name").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    z: doublePrecision("z").notNull().default(0),
    width: doublePrecision("width").notNull().default(64),
    height: doublePrecision("height").notNull().default(64),
    rotation: doublePrecision("rotation").notNull().default(0),
    visible: boolean("visible").notNull().default(true),
    locked: boolean("locked").notNull().default(false),
    revision: integer("revision").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("tokens_scene_idx").on(table.sceneId)],
);

export const fogReveals = pgTable(
  "fog_reveals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    width: doublePrecision("width").notNull(),
    height: doublePrecision("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("fog_scene_idx").on(table.sceneId)],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    claimedByMembershipId: uuid("claimed_by_membership_id").references(
      () => memberships.id,
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("invites_token_hash_idx").on(table.tokenHash)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_idx").on(table.tokenHash)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "set null",
    }),
    kind: messageKindEnum("kind").notNull().default("TEXT"),
    visibility: messageVisibilityEnum("visibility").notNull().default("PUBLIC"),
    body: text("body").notNull(),
    dice: jsonb("dice").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("chat_campaign_created_idx").on(table.campaignId, table.createdAt),
  ],
);

export const audioStates = pgTable("audio_states", {
  campaignId: uuid("campaign_id")
    .primaryKey()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => assets.id, {
    onDelete: "set null",
  }),
  playing: boolean("playing").notNull().default(false),
  positionSeconds: doublePrecision("position_seconds").notNull().default(0),
  loop: boolean("loop").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const gameEvents = pgTable(
  "game_events",
  {
    sequence: bigserial("sequence", { mode: "number" }).primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    actionId: uuid("action_id").notNull(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    entityRevision: integer("entity_revision"),
    payload: jsonb("payload").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("game_events_campaign_action_idx").on(
      table.campaignId,
      table.actionId,
    ),
    index("game_events_campaign_sequence_idx").on(
      table.campaignId,
      table.sequence,
    ),
  ],
);
