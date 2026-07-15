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
export const tokenLayerEnum = pgEnum("token_layer", ["MAP", "GM", "PLAYER"]);
export const catalogEntryKindEnum = pgEnum("catalog_entry_kind", [
  "SKILL",
  "ABILITY",
]);
export const fogOperationEnum = pgEnum("fog_operation", ["REVEAL", "COVER"]);
export const journalStatusEnum = pgEnum("journal_status", [
  "APPLIED",
  "UNDONE",
  "INVALIDATED",
]);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  systemId: text("system_id").notNull().default("arken-core"),
  systemVersion: integer("system_version").notNull().default(1),
  activeSceneId: uuid("active_scene_id"),
  day: integer("day").notNull().default(1),
  battleActive: boolean("battle_active").notNull().default(false),
  battleCounter: integer("battle_counter").notNull().default(0),
  revision: integer("revision").notNull().default(0),
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
    revision: integer("revision").notNull().default(0),
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
    backstory: text("backstory").notNull().default(""),
    inventory: jsonb("inventory").$type<string[]>().notNull().default([]),
    resources: jsonb("resources")
      .$type<Record<string, { current: number; maximum?: number }>>()
      .notNull()
      .default({}),
    wallet: jsonb("wallet")
      .$type<{ gold: number; silver: number; copper: number; sp: number }>()
      .notNull()
      .default({ gold: 0, silver: 0, copper: 0, sp: 0 }),
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

export const catalogEntries = pgTable(
  "catalog_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    kind: catalogEntryKindEnum("kind").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("catalog_entries_campaign_idx").on(table.campaignId)],
);

export const characterCatalogEntries = pgTable(
  "character_catalog_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    sourceCatalogEntryId: uuid("source_catalog_entry_id").references(
      () => catalogEntries.id,
      { onDelete: "set null" },
    ),
    kind: catalogEntryKindEnum("kind").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("character_catalog_character_idx").on(table.characterId)],
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
    mapScale: doublePrecision("map_scale").notNull().default(1),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("scenes_campaign_idx").on(table.campaignId)],
);

export const tokenDefinitions = pgTable(
  "token_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "set null",
    }),
    defaultAssetId: uuid("default_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    defaultWidth: doublePrecision("default_width").notNull().default(64),
    defaultHeight: doublePrecision("default_height").notNull().default(64),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("token_definitions_campaign_idx").on(table.campaignId)],
);

export const tokenControllers = pgTable(
  "token_controllers",
  {
    tokenDefinitionId: uuid("token_definition_id")
      .notNull()
      .references(() => tokenDefinitions.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("token_controllers_definition_member_idx").on(
      table.tokenDefinitionId,
      table.membershipId,
    ),
  ],
);

export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => tokenDefinitions.id, { onDelete: "cascade" }),
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
    layer: tokenLayerEnum("layer").notNull().default("PLAYER"),
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
    operation: fogOperationEnum("operation").notNull().default("REVEAL"),
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("fog_scene_idx").on(table.sceneId)],
);

export const drawings = pgTable(
  "drawings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    authorMembershipId: uuid("author_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    points: jsonb("points").$type<number[]>().notNull(),
    color: text("color").notNull().default("#ffffff"),
    x: doublePrecision("x").notNull().default(0),
    y: doublePrecision("y").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("drawings_scene_idx").on(table.sceneId)],
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

export const playerAccessGrants = pgTable(
  "player_access_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("player_access_grants_token_hash_idx").on(table.tokenHash),
    uniqueIndex("player_access_grants_membership_idx").on(table.membershipId),
    index("player_access_grants_campaign_idx").on(table.campaignId),
  ],
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

export const actionJournal = pgTable(
  "action_journal",
  {
    sequence: bigserial("sequence", { mode: "number" }).primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id").references(() => scenes.id, {
      onDelete: "cascade",
    }),
    actorMembershipId: uuid("actor_membership_id")
      .notNull()
      .references(() => memberships.id),
    actionId: uuid("action_id").notNull(),
    scope: text("scope").notNull().default("PUBLIC"),
    type: text("type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    beforeRevision: integer("before_revision"),
    afterRevision: integer("after_revision"),
    currentRevision: integer("current_revision"),
    transitionSequence: bigserial("transition_sequence", {
      mode: "number",
    }).notNull(),
    status: journalStatusEnum("status").notNull().default("APPLIED"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("action_journal_campaign_action_idx").on(
      table.campaignId,
      table.actionId,
    ),
    index("action_journal_campaign_sequence_idx").on(
      table.campaignId,
      table.sequence,
    ),
  ],
);
