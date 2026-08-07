import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  foreignKey,
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
import { sql } from "drizzle-orm";

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
export const playerRequestAudienceEnum = pgEnum("player_request_audience", [
  "PUBLIC",
  "GM_ONLY",
]);
export const playerRequestHorizonEnum = pgEnum("player_request_horizon", [
  "NOW",
  "BEFORE_BREAK",
  "NEXT_SESSION",
]);
export const playerRequestStatusEnum = pgEnum("player_request_status", [
  "SUBMITTED",
  "ACKNOWLEDGED",
  "RESOLVED",
  "DECLINED",
  "CANCELLED",
]);
export const stickerPackSubjectEnum = pgEnum("sticker_pack_subject", [
  "CHARACTER",
  "PLAYER",
  "NPC",
  "CREATURE",
]);
export const stickerPackAudienceEnum = pgEnum("sticker_pack_audience", [
  "CAMPAIGN",
  "ENTITLED",
  "GM_ONLY",
]);
export const stickerPackSendPolicyEnum = pgEnum("sticker_pack_send_policy", [
  "ALL_MEMBERS",
  "ENTITLED_ONLY",
  "GM_ONLY",
]);
export const stickerPackLifecycleEnum = pgEnum("sticker_pack_lifecycle", [
  "DRAFT",
  "ACTIVE",
  "DEPRECATED",
  "ARCHIVED",
]);
export const likenessConsentStatusEnum = pgEnum("likeness_consent_status", [
  "GRANTED",
  "REVOKED",
]);
export const stickerProvenanceTypeEnum = pgEnum("sticker_provenance_type", [
  "ORIGINAL",
  "COMMISSIONED",
  "IMPORTED",
]);
/** World/region aggregate lifecycle. A published map has an explicitly approved background. */
export const worldMapLifecycleEnum = pgEnum("world_map_lifecycle", [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
]);
/** Visibility is evaluated by the server before projecting a map or marker. */
export const worldMapVisibilityEnum = pgEnum("world_map_visibility", [
  "CAMPAIGN",
  "GM_ONLY",
]);
/** Deliberately not a parent relation: hierarchy editing is outside the MVP. */
export const worldMapScopeEnum = pgEnum("world_map_scope", ["WORLD", "REGION"]);
export const worldMapLocationKindEnum = pgEnum("world_map_location_kind", [
  "SETTLEMENT",
  "LANDMARK",
  "REGION",
  "OTHER",
]);
/** Distinct from map visibility: DISCOVERED is campaign-wide in the MVP. */
export const worldMapLocationVisibilityEnum = pgEnum(
  "world_map_location_visibility",
  ["PUBLIC", "DISCOVERED", "GM_ONLY"],
);
export const chatThreadTypeEnum = pgEnum("chat_thread_type", [
  "STREAM",
  "DIRECT",
]);
export const chatStreamEnum = pgEnum("chat_stream", [
  "ROLLS",
  "STORY",
  "TABLE",
]);
export const chatAttachmentUploadStatusEnum = pgEnum(
  "chat_attachment_upload_status",
  ["STAGED", "CLAIMED", "EXPIRED"],
);
export const storyPostLifecycleEnum = pgEnum("story_post_lifecycle", [
  "DRAFT",
  "PUBLISHED",
  "CORRECTED",
  "ARCHIVED",
]);
export const storyRightsStatusEnum = pgEnum("story_rights_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);
export const storyImportProviderEnum = pgEnum("story_import_provider", [
  "TELEGRAM",
]);
export const tokenLayerEnum = pgEnum("token_layer", ["MAP", "GM", "PLAYER"]);
export const catalogEntryKindEnum = pgEnum("catalog_entry_kind", [
  "SKILL",
  "ABILITY",
]);
export const fogOperationEnum = pgEnum("fog_operation", ["REVEAL", "COVER"]);
export const fogShapeEnum = pgEnum("fog_shape", [
  "RECT",
  "CIRCLE",
  "POLYGON",
  "BRUSH",
]);
export const journalStatusEnum = pgEnum("journal_status", [
  "APPLIED",
  "UNDONE",
  "INVALIDATED",
]);
export const characterMediaCategoryEnum = pgEnum("character_media_category", [
  "CHARACTER_ART",
  "ARTIFACT",
  "ITEM",
  "DOCUMENT_HANDOUT",
  "MEMORY_SCENE",
  "OTHER",
]);
/**
 * OWNER_GM is the default (owner + GM). PARTY widens to the whole campaign.
 * GM_ONLY is a stricter tier than the default: hidden from the character's
 * own owner too, for GM-authored notes/media (AC8).
 */
export const characterMediaVisibilityEnum = pgEnum("character_media_visibility", [
  "OWNER_GM",
  "PARTY",
  "GM_ONLY",
]);
export const encounterStatusEnum = pgEnum("encounter_status", [
  "ACTIVE",
  "ENDED",
]);
/**
 * SCENE_REGION focuses cameras on a rectangle of the already-active scene
 * (source === target); LINKED_SCENE atomically activates a different,
 * prepared tactical scene as the target (UIX-311).
 */
export const encounterModeEnum = pgEnum("encounter_mode", [
  "SCENE_REGION",
  "LINKED_SCENE",
]);
export const feedbackKindEnum = pgEnum("feedback_kind", [
  "SUGGESTION",
  "BUG",
  "IDEA",
]);
export const feedbackAttachmentKindEnum = pgEnum("feedback_attachment_kind", [
  "SCREENSHOT",
  "USER_IMAGE",
]);
export const feedbackStatusEnum = pgEnum("feedback_status", [
  "NEW",
  "ACKNOWLEDGED",
  "LINKED",
  "RESOLVED",
  "DISMISSED",
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
  (table) => [
    index("memberships_campaign_idx").on(table.campaignId),
    uniqueIndex("memberships_campaign_id_id_idx").on(
      table.campaignId,
      table.id,
    ),
  ],
);

export const gmAccessCredentials = pgTable("gm_access_credentials", {
  campaignId: uuid("campaign_id")
    .primaryKey()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const feedbackReports = pgTable(
  "feedback_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: feedbackKindEnum("kind").notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    actorMembershipId: uuid("actor_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull().default(""),
    description: text("description").notNull(),
    contact: text("contact"),
    buildVersion: text("build_version").notNull(),
    buildRevision: text("build_revision").notNull(),
    requestId: text("request_id").notNull(),
    diagnostics: jsonb("diagnostics")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: feedbackStatusEnum("status").notNull().default("NEW"),
    linearKey: text("linear_key"),
    linearUrl: text("linear_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("feedback_reports_created_idx").on(table.createdAt),
    index("feedback_reports_campaign_idx").on(table.campaignId),
  ],
);

export const feedbackOperatorAudits = pgTable(
  "feedback_operator_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => feedbackReports.id, { onDelete: "cascade" }),
    operatorMembershipId: uuid("operator_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("feedback_operator_audits_report_idx").on(table.reportId)],
);

export const feedbackAttachments = pgTable(
  "feedback_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => feedbackReports.id, { onDelete: "cascade" }),
    kind: feedbackAttachmentKindEnum("kind").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("feedback_attachments_report_idx").on(table.reportId)],
);

export const assets = pgTable(
  "assets",
  {
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
    durationSeconds: doublePrecision("duration_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("assets_campaign_id_id_idx").on(table.campaignId, table.id),
  ],
);

export const worldMaps = pgTable(
  "world_maps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scope: worldMapScopeEnum("scope").notNull().default("REGION"),
    visibility: worldMapVisibilityEnum("visibility")
      .notNull()
      .default("CAMPAIGN"),
    lifecycle: worldMapLifecycleEnum("lifecycle").notNull().default("DRAFT"),
    /** A staged MAP asset; publication requires its explicit approval. */
    backgroundAssetId: uuid("background_asset_id"),
    backgroundAssetApprovedByMembershipId: uuid(
      "background_asset_approved_by_membership_id",
    ),
    backgroundAssetApprovedAt: timestamp("background_asset_approved_at", {
      withTimezone: true,
    }),
    revision: integer("revision").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("world_maps_campaign_id_id_idx").on(table.campaignId, table.id),
    index("world_maps_campaign_lifecycle_idx").on(
      table.campaignId,
      table.lifecycle,
    ),
    foreignKey({
      name: "world_maps_campaign_background_asset_fk",
      columns: [table.campaignId, table.backgroundAssetId],
      foreignColumns: [assets.campaignId, assets.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "world_maps_campaign_background_approver_fk",
      columns: [table.campaignId, table.backgroundAssetApprovedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    check(
      "world_maps_name_revision_check",
      sql`length(trim(${table.name})) BETWEEN 1 AND 120 AND ${table.revision} >= 0`,
    ),
    check(
      "world_maps_background_approval_shape_check",
      sql`(${table.backgroundAssetApprovedByMembershipId} IS NULL AND ${table.backgroundAssetApprovedAt} IS NULL) OR (${table.backgroundAssetId} IS NOT NULL AND ${table.backgroundAssetApprovedByMembershipId} IS NOT NULL AND ${table.backgroundAssetApprovedAt} IS NOT NULL)`,
    ),
    check(
      "world_maps_lifecycle_shape_check",
      sql`(${table.lifecycle} = 'DRAFT' AND ${table.publishedAt} IS NULL AND ${table.archivedAt} IS NULL) OR (${table.lifecycle} = 'PUBLISHED' AND ${table.backgroundAssetId} IS NOT NULL AND ${table.backgroundAssetApprovedByMembershipId} IS NOT NULL AND ${table.backgroundAssetApprovedAt} IS NOT NULL AND ${table.publishedAt} IS NOT NULL AND ${table.archivedAt} IS NULL) OR (${table.lifecycle} = 'ARCHIVED' AND ${table.archivedAt} IS NOT NULL)`,
    ),
  ],
);
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
  (table) => [
    index("characters_campaign_idx").on(table.campaignId),
    uniqueIndex("characters_campaign_id_id_idx").on(table.campaignId, table.id),
  ],
);

/** Character-sheet access, independent from token control and login grants. */
export const characterControllers = pgTable(
  "character_controllers",
  {
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("character_controllers_character_member_idx").on(
      table.characterId,
      table.membershipId,
    ),
    index("character_controllers_membership_idx").on(table.membershipId),
  ],
);

/**
 * A character's media gallery (art, artifacts, handouts, scene memories),
 * additive to and independent from `characters.portraitAssetId`.
 *
 * Deletion is deliberately two-tiered: `detachedAt` soft-removes an entry
 * from the gallery (available to players per AC-detach semantics) while the
 * underlying `assets` row is untouched; physically deleting the asset stays
 * a separate GM-only flow (see the asset-lifecycle work in UIX-293) and is
 * out of scope here.
 */
export const characterMedia = pgTable(
  "character_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    category: characterMediaCategoryEnum("category").notNull(),
    caption: text("caption"),
    ordering: integer("ordering").notNull().default(0),
    visibility: characterMediaVisibilityEnum("visibility")
      .notNull()
      .default("OWNER_GM"),
    /** Nullable placeholder for Stage 5 item/world-entity linking (UIX-264/UIX-244); unpopulated and unvalidated for now. */
    relatedEntityId: uuid("related_entity_id"),
    uploadedByMembershipId: uuid("uploaded_by_membership_id").notNull(),
    detachedAt: timestamp("detached_at", { withTimezone: true }),
    detachedByMembershipId: uuid("detached_by_membership_id"),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("character_media_campaign_id_id_idx").on(
      table.campaignId,
      table.id,
    ),
    index("character_media_character_ordering_idx").on(
      table.characterId,
      table.ordering,
    ),
    index("character_media_character_detached_idx").on(
      table.characterId,
      table.detachedAt,
    ),
    foreignKey({
      name: "character_media_campaign_character_fk",
      columns: [table.campaignId, table.characterId],
      foreignColumns: [characters.campaignId, characters.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "character_media_campaign_asset_fk",
      columns: [table.campaignId, table.assetId],
      foreignColumns: [assets.campaignId, assets.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "character_media_campaign_uploader_fk",
      columns: [table.campaignId, table.uploadedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "character_media_campaign_detacher_fk",
      columns: [table.campaignId, table.detachedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    check(
      "character_media_caption_check",
      sql`${table.caption} IS NULL OR length(trim(${table.caption})) BETWEEN 1 AND 500`,
    ),
    check(
      "character_media_ordering_revision_check",
      sql`${table.ordering} >= 0 AND ${table.revision} >= 0`,
    ),
    check(
      "character_media_detach_shape_check",
      sql`(${table.detachedAt} IS NULL AND ${table.detachedByMembershipId} IS NULL) OR (${table.detachedAt} IS NOT NULL AND ${table.detachedByMembershipId} IS NOT NULL)`,
    ),
  ],
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
  (table) => [
    index("character_catalog_character_idx").on(table.characterId),
    uniqueIndex("character_catalog_source_unique").on(
      table.characterId,
      table.sourceCatalogEntryId,
    ),
  ],
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
    backgroundX: doublePrecision("background_x").notNull().default(0),
    backgroundY: doublePrecision("background_y").notNull().default(0),
    backgroundWidth: doublePrecision("background_width")
      .notNull()
      .default(1920),
    backgroundHeight: doublePrecision("background_height")
      .notNull()
      .default(1080),
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
  (table) => [
    index("scenes_campaign_idx").on(table.campaignId),
    uniqueIndex("scenes_campaign_id_id_idx").on(table.campaignId, table.id),
  ],
);

export const worldMapLocations = pgTable(
  "world_map_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull(),
    mapId: uuid("map_id").notNull(),
    name: text("name").notNull(),
    kind: worldMapLocationKindEnum("kind").notNull().default("OTHER"),
    /** Player-safe short card text. */
    summary: text("summary").notNull().default(""),
    /** Never project this field to players. */
    gmNotes: text("gm_notes").notNull().default(""),
    visibility: worldMapLocationVisibilityEnum("visibility")
      .notNull()
      .default("GM_ONLY"),
    /** Coordinates are normalized to the approved background: 0 <= x,y <= 1. */
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("world_map_locations_campaign_id_id_idx").on(
      table.campaignId,
      table.id,
    ),
    uniqueIndex("world_map_locations_campaign_map_id_id_idx").on(
      table.campaignId,
      table.mapId,
      table.id,
    ),
    index("world_map_locations_map_visibility_idx").on(
      table.mapId,
      table.visibility,
    ),
    foreignKey({
      name: "world_map_locations_campaign_map_fk",
      columns: [table.campaignId, table.mapId],
      foreignColumns: [worldMaps.campaignId, worldMaps.id],
    }).onDelete("cascade"),
    check(
      "world_map_locations_shape_check",
      sql`length(trim(${table.name})) BETWEEN 1 AND 120 AND length(${table.summary}) <= 2000 AND length(${table.gmNotes}) <= 10000 AND ${table.x} >= 0 AND ${table.x} <= 1 AND ${table.y} >= 0 AND ${table.y} <= 1 AND ${table.revision} >= 0`,
    ),
  ],
);

/** Explicit tactical-scene links; there are no routes or travel semantics in this table. */
export const worldMapLocationScenes = pgTable(
  "world_map_location_scenes",
  {
    campaignId: uuid("campaign_id").notNull(),
    locationId: uuid("location_id").notNull(),
    sceneId: uuid("scene_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("world_map_location_scenes_unique_idx").on(
      table.locationId,
      table.sceneId,
    ),
    index("world_map_location_scenes_scene_idx").on(table.sceneId),
    foreignKey({
      name: "world_map_location_scenes_campaign_location_fk",
      columns: [table.campaignId, table.locationId],
      foreignColumns: [worldMapLocations.campaignId, worldMapLocations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "world_map_location_scenes_campaign_scene_fk",
      columns: [table.campaignId, table.sceneId],
      foreignColumns: [scenes.campaignId, scenes.id],
    }).onDelete("cascade"),
  ],
);

/** Exactly one current, location-only party position per campaign. */
export const worldMapPartyPosition = pgTable(
  "world_map_party_position",
  {
    campaignId: uuid("campaign_id")
      .primaryKey()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    mapId: uuid("map_id").notNull(),
    locationId: uuid("location_id").notNull(),
    updatedByMembershipId: uuid("updated_by_membership_id").notNull(),
    revision: integer("revision").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "world_map_party_position_campaign_map_fk",
      columns: [table.campaignId, table.mapId],
      foreignColumns: [worldMaps.campaignId, worldMaps.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "world_map_party_position_campaign_map_location_fk",
      columns: [table.campaignId, table.mapId, table.locationId],
      foreignColumns: [
        worldMapLocations.campaignId,
        worldMapLocations.mapId,
        worldMapLocations.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "world_map_party_position_campaign_updater_fk",
      columns: [table.campaignId, table.updatedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    check(
      "world_map_party_position_revision_check",
      sql`${table.revision} >= 0`,
    ),
  ],
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
    baseColor: text("base_color").notNull().default("#b5623e"),
    frameColor: text("frame_color"),
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
    shape: fogShapeEnum("shape").notNull().default("RECT"),
    geometry: jsonb("geometry")
      .$type<
        | { type: "RECT"; x: number; y: number; width: number; height: number }
        | { type: "CIRCLE"; center: { x: number; y: number }; radius: number }
        | { type: "POLYGON"; points: { x: number; y: number }[] }
        | { type: "BRUSH"; points: { x: number; y: number }[]; radius: number }
      >()
      .notNull(),
    bbox: jsonb("bbox")
      .$type<{ x: number; y: number; width: number; height: number }>()
      .notNull(),
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
    strokeWidth: doublePrecision("stroke_width").notNull().default(3),
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

export const stickerPacks = pgTable(
  "sticker_packs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subject: stickerPackSubjectEnum("subject").notNull(),
    subjectCharacterId: uuid("subject_character_id"),
    subjectMembershipId: uuid("subject_membership_id"),
    subjectLabel: text("subject_label"),
    audience: stickerPackAudienceEnum("audience").notNull().default("CAMPAIGN"),
    sendPolicy: stickerPackSendPolicyEnum("send_policy")
      .notNull()
      .default("ALL_MEMBERS"),
    lifecycle: stickerPackLifecycleEnum("lifecycle").notNull().default("DRAFT"),
    revision: integer("revision").notNull().default(0),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sticker_packs_campaign_id_id_idx").on(
      table.campaignId,
      table.id,
    ),
    uniqueIndex("sticker_packs_campaign_player_subject_idx").on(
      table.campaignId,
      table.id,
      table.subjectMembershipId,
    ),
    index("sticker_packs_campaign_lifecycle_idx").on(
      table.campaignId,
      table.lifecycle,
    ),
    foreignKey({
      name: "sticker_packs_campaign_membership_fk",
      columns: [table.campaignId, table.subjectMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "sticker_packs_campaign_character_fk",
      columns: [table.campaignId, table.subjectCharacterId],
      foreignColumns: [characters.campaignId, characters.id],
    }).onDelete("restrict"),
    check(
      "sticker_packs_name_revision_check",
      sql`length(trim(${table.name})) BETWEEN 1 AND 120 AND ${table.revision} >= 0`,
    ),
    check(
      "sticker_packs_subject_shape_check",
      sql`(${table.subject} = 'CHARACTER' AND ${table.subjectCharacterId} IS NOT NULL AND ${table.subjectMembershipId} IS NULL AND ${table.subjectLabel} IS NULL) OR (${table.subject} = 'PLAYER' AND ${table.subjectCharacterId} IS NULL AND ${table.subjectMembershipId} IS NOT NULL AND ${table.subjectLabel} IS NULL) OR (${table.subject} IN ('NPC','CREATURE') AND ${table.subjectCharacterId} IS NULL AND ${table.subjectMembershipId} IS NULL AND ${table.subjectLabel} IS NOT NULL AND length(trim(${table.subjectLabel})) BETWEEN 1 AND 80)`,
    ),
    check(
      "sticker_packs_deprecation_check",
      sql`${table.lifecycle} IS NOT NULL AND ((${table.lifecycle} = 'DEPRECATED' AND ${table.deprecatedAt} IS NOT NULL) OR (${table.lifecycle} <> 'DEPRECATED' AND ${table.deprecatedAt} IS NULL))`,
    ),
  ],
);

export const stickerPackEntitlements = pgTable(
  "sticker_pack_entitlements",
  {
    campaignId: uuid("campaign_id").notNull(),
    packId: uuid("pack_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sticker_pack_entitlements_unique_idx").on(
      table.packId,
      table.membershipId,
    ),
    foreignKey({
      name: "sticker_pack_entitlements_campaign_pack_fk",
      columns: [table.campaignId, table.packId],
      foreignColumns: [stickerPacks.campaignId, stickerPacks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sticker_pack_entitlements_campaign_member_fk",
      columns: [table.campaignId, table.membershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("cascade"),
  ],
);

export const playerLikenessConsents = pgTable(
  "player_likeness_consents",
  {
    campaignId: uuid("campaign_id").notNull(),
    packId: uuid("pack_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    status: likenessConsentStatusEnum("status").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("player_likeness_consents_unique_idx").on(
      table.packId,
      table.membershipId,
    ),
    foreignKey({
      name: "player_likeness_consents_campaign_pack_fk",
      columns: [table.campaignId, table.packId, table.membershipId],
      foreignColumns: [
        stickerPacks.campaignId,
        stickerPacks.id,
        stickerPacks.subjectMembershipId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "player_likeness_consents_campaign_member_fk",
      columns: [table.campaignId, table.membershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("cascade"),
    check(
      "player_likeness_consents_status_check",
      sql`${table.status} IS NOT NULL AND ((${table.status} = 'GRANTED' AND ${table.grantedAt} IS NOT NULL AND ${table.revokedAt} IS NULL) OR (${table.status} = 'REVOKED' AND ${table.grantedAt} IS NOT NULL AND ${table.revokedAt} IS NOT NULL AND ${table.revokedAt} >= ${table.grantedAt}))`,
    ),
  ],
);

export const stickerMedia = pgTable(
  "sticker_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull(),
    uploadedByMembershipId: uuid("uploaded_by_membership_id").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sticker_media_campaign_id_id_idx").on(
      table.campaignId,
      table.id,
    ),
    uniqueIndex("sticker_media_storage_key_idx").on(table.storageKey),
    uniqueIndex("sticker_media_campaign_hash_idx").on(
      table.campaignId,
      table.sha256,
    ),
    foreignKey({
      name: "sticker_media_campaign_uploader_fk",
      columns: [table.campaignId, table.uploadedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    check(
      "sticker_media_shape_check",
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 5242880 AND ${table.width} BETWEEN 1 AND 4096 AND ${table.height} BETWEEN 1 AND 4096 AND ${table.mimeType} IN ('image/png','image/webp') AND ${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const stickers = pgTable(
  "stickers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull(),
    packId: uuid("pack_id").notNull(),
    mediaId: uuid("media_id").notNull(),
    name: text("name").notNull(),
    altText: text("alt_text").notNull(),
    provenanceType: stickerProvenanceTypeEnum("provenance_type").notNull(),
    sourceReference: text("source_reference"),
    authorCredit: text("author_credit"),
    licenseNote: text("license_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("stickers_campaign_id_id_idx").on(table.campaignId, table.id),
    uniqueIndex("stickers_pack_media_idx").on(table.packId, table.mediaId),
    foreignKey({
      name: "stickers_campaign_pack_fk",
      columns: [table.campaignId, table.packId],
      foreignColumns: [stickerPacks.campaignId, stickerPacks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stickers_campaign_media_fk",
      columns: [table.campaignId, table.mediaId],
      foreignColumns: [stickerMedia.campaignId, stickerMedia.id],
    }).onDelete("restrict"),
    check(
      "stickers_name_check",
      sql`length(trim(${table.name})) BETWEEN 1 AND 80`,
    ),
    check(
      "stickers_alt_text_check",
      sql`length(trim(${table.altText})) BETWEEN 1 AND 240`,
    ),
    check(
      "stickers_provenance_check",
      sql`${table.provenanceType} IS NOT NULL AND length(coalesce(${table.sourceReference}, '')) <= 1000 AND length(coalesce(${table.authorCredit}, '')) <= 200 AND length(coalesce(${table.licenseNote}, '')) <= 1000 AND (${table.provenanceType} <> 'IMPORTED' OR (${table.sourceReference} IS NOT NULL AND length(trim(${table.sourceReference})) > 0 AND ${table.authorCredit} IS NOT NULL AND length(trim(${table.authorCredit})) > 0 AND ${table.licenseNote} IS NOT NULL AND length(trim(${table.licenseNote})) > 0))`,
    ),
  ],
);

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    type: chatThreadTypeEnum("type").notNull().default("STREAM"),
    stream: chatStreamEnum("stream"),
    participantAMembershipId: uuid("participant_a_membership_id"),
    participantBMembershipId: uuid("participant_b_membership_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("chat_threads_campaign_stream_idx").on(
      table.campaignId,
      table.stream,
    ),
    uniqueIndex("chat_threads_campaign_direct_pair_idx")
      .on(
        table.campaignId,
        table.participantAMembershipId,
        table.participantBMembershipId,
      )
      .where(sql`${table.stream} IS NULL`),
    uniqueIndex("chat_threads_campaign_id_id_idx").on(
      table.campaignId,
      table.id,
    ),
    foreignKey({
      name: "chat_threads_campaign_participant_a_fk",
      columns: [table.campaignId, table.participantAMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chat_threads_campaign_participant_b_fk",
      columns: [table.campaignId, table.participantBMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("cascade"),
    check(
      "chat_threads_shape_check",
      sql`(${table.type}::text = 'STREAM' AND ${table.stream} IS NOT NULL AND ${table.participantAMembershipId} IS NULL AND ${table.participantBMembershipId} IS NULL) OR (${table.type}::text = 'DIRECT' AND ${table.stream} IS NULL AND ${table.participantAMembershipId} IS NOT NULL AND ${table.participantBMembershipId} IS NOT NULL AND ${table.participantAMembershipId} < ${table.participantBMembershipId})`,
    ),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
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
    threadId: uuid("thread_id").notNull(),
    visibility: messageVisibilityEnum("visibility").notNull().default("PUBLIC"),
    body: text("body").notNull(),
    /** Reference-only projection; canonical request content stays in player_requests. */
    playerRequestId: uuid("player_request_id"),
    dice: jsonb("dice").$type<unknown>(),
    systemData: jsonb("system_data").$type<{
      type: "WALLET_AUDIT";
      before: { gold: number; silver: number; copper: number; sp: number };
      after: { gold: number; silver: number; copper: number; sp: number };
      lastAt: string;
      operationCount: number;
    }>(),
    stickerId: uuid("sticker_id"),
    stickerPresentation: jsonb("sticker_presentation").$type<{
      name: string;
      altText: string;
      assetUrl: string;
      width: number;
      height: number;
    }>(),
    stickerViewerMembershipIds: jsonb("sticker_viewer_membership_ids").$type<
      string[]
    >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("chat_sequence_idx").on(table.sequence),
    uniqueIndex("chat_messages_player_request_idx").on(table.playerRequestId),
    index("chat_campaign_sequence_idx").on(table.campaignId, table.sequence),
    index("chat_messages_thread_sequence_idx").on(
      table.threadId,
      table.sequence,
    ),
    foreignKey({
      name: "chat_messages_campaign_sticker_fk",
      columns: [table.campaignId, table.stickerId],
      foreignColumns: [stickers.campaignId, stickers.id],
    }).onDelete("restrict"),
    check(
      "chat_messages_sticker_shape_check",
      sql`(${table.stickerId} IS NULL AND ${table.stickerPresentation} IS NULL) OR (${table.stickerId} IS NOT NULL AND ${table.stickerPresentation} IS NOT NULL AND ${table.kind} = 'TEXT' AND ${table.dice} IS NULL)`,
    ),
    check(
      "chat_messages_player_request_shape_check",
      sql`${table.playerRequestId} IS NULL OR (${table.kind} = 'SYSTEM' AND ${table.body} = '' AND ${table.dice} IS NULL AND ${table.systemData} IS NULL AND ${table.stickerId} IS NULL AND ${table.stickerPresentation} IS NULL)`,
    ),
    check(
      "chat_messages_sticker_presentation_check",
      sql`CASE WHEN ${table.stickerPresentation} IS NULL THEN true WHEN jsonb_typeof(${table.stickerPresentation}) <> 'object' THEN false ELSE coalesce(${table.stickerPresentation} - 'name' - 'altText' - 'assetUrl' - 'width' - 'height' = '{}'::jsonb AND jsonb_typeof(${table.stickerPresentation}->'name') = 'string' AND length(trim(${table.stickerPresentation}->>'name')) BETWEEN 1 AND 80 AND jsonb_typeof(${table.stickerPresentation}->'altText') = 'string' AND length(trim(${table.stickerPresentation}->>'altText')) BETWEEN 1 AND 240 AND jsonb_typeof(${table.stickerPresentation}->'assetUrl') = 'string' AND length(${table.stickerPresentation}->>'assetUrl') BETWEEN 1 AND 2048 AND jsonb_typeof(${table.stickerPresentation}->'width') = 'number' AND (${table.stickerPresentation}->>'width')::numeric BETWEEN 1 AND 4096 AND jsonb_typeof(${table.stickerPresentation}->'height') = 'number' AND (${table.stickerPresentation}->>'height')::numeric BETWEEN 1 AND 4096, false) END`,
    ),
    uniqueIndex("chat_messages_campaign_thread_id_idx").on(
      table.campaignId,
      table.threadId,
      table.id,
    ),
  ],
);

export const chatAttachmentUploads = pgTable(
  "chat_attachment_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentId: uuid("content_id").defaultRandom().notNull(),
    campaignId: uuid("campaign_id").notNull(),
    uploadedByMembershipId: uuid("uploaded_by_membership_id").notNull(),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    status: chatAttachmentUploadStatusEnum("status")
      .notNull()
      .default("STAGED"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("chat_attachment_uploads_content_id_idx").on(table.contentId),
    uniqueIndex("chat_attachment_uploads_campaign_content_idx").on(
      table.campaignId,
      table.contentId,
    ),
    uniqueIndex("chat_attachment_uploads_storage_key_idx").on(table.storageKey),
    index("chat_attachment_uploads_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
    foreignKey({
      name: "chat_attachment_uploads_campaign_uploader_fk",
      columns: [table.campaignId, table.uploadedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("cascade"),
    check("chat_attachment_uploads_size_check", sql`${table.sizeBytes} > 0`),
    check(
      "chat_attachment_uploads_dimensions_check",
      sql`(${table.width} IS NULL OR ${table.width} > 0) AND (${table.height} IS NULL OR ${table.height} > 0)`,
    ),
  ],
);

export const chatAttachments = pgTable(
  "chat_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentId: uuid("content_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    threadId: uuid("thread_id").notNull(),
    messageId: uuid("message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("chat_attachments_content_id_idx").on(table.contentId),
    index("chat_attachments_message_idx").on(table.messageId),
    foreignKey({
      name: "chat_attachments_campaign_upload_fk",
      columns: [table.campaignId, table.contentId],
      foreignColumns: [
        chatAttachmentUploads.campaignId,
        chatAttachmentUploads.contentId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "chat_attachments_campaign_thread_fk",
      columns: [table.campaignId, table.threadId],
      foreignColumns: [chatThreads.campaignId, chatThreads.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chat_attachments_campaign_thread_message_fk",
      columns: [table.campaignId, table.threadId, table.messageId],
      foreignColumns: [
        chatMessages.campaignId,
        chatMessages.threadId,
        chatMessages.id,
      ],
    }).onDelete("cascade"),
  ],
);

/**
 * Canonical STORY content. It is deliberately independent of generic chat
 * messages so draft/edit/archive lifecycle and player-safe projection do not
 * widen the chat authorization boundary.
 */
export const storyPosts = pgTable(
  "story_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    authorMembershipId: uuid("author_membership_id").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    /** GM-only editorial context; never project this to a player. */
    gmNotes: text("gm_notes").notNull().default(""),
    entityLinks: jsonb("entity_links").$type<unknown>().notNull().default([]),
    lifecycle: storyPostLifecycleEnum("lifecycle").notNull().default("DRAFT"),
    /** Drafts/archives are GM-only; published/corrected posts are PUBLIC. */
    visibility: messageVisibilityEnum("visibility")
      .notNull()
      .default("GM_ONLY"),
    revision: integer("revision").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("story_posts_campaign_id_id_idx").on(
      table.campaignId,
      table.id,
    ),
    index("story_posts_campaign_visibility_updated_idx").on(
      table.campaignId,
      table.visibility,
      table.updatedAt,
      table.id,
    ),
    foreignKey({
      name: "story_posts_campaign_thread_fk",
      columns: [table.campaignId, table.threadId],
      foreignColumns: [chatThreads.campaignId, chatThreads.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "story_posts_campaign_author_fk",
      columns: [table.campaignId, table.authorMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    check(
      "story_posts_shape_check",
      sql`length(trim(${table.title})) <= 160 AND length(${table.body}) <= 20000 AND length(${table.gmNotes}) <= 10000 AND ${table.revision} >= 0 AND ((${table.lifecycle}::text = 'DRAFT' AND ${table.visibility}::text = 'GM_ONLY' AND ${table.publishedAt} IS NULL AND ${table.archivedAt} IS NULL) OR (${table.lifecycle}::text IN ('PUBLISHED','CORRECTED') AND ${table.visibility}::text = 'PUBLIC' AND ${table.publishedAt} IS NOT NULL AND ${table.archivedAt} IS NULL) OR (${table.lifecycle}::text = 'ARCHIVED' AND ${table.visibility}::text = 'GM_ONLY' AND ${table.archivedAt} IS NOT NULL)))`,
    ),
  ],
);

/** Immutable snapshots make corrections auditable and preserve prior media references. */
export const storyPostRevisions = pgTable(
  "story_post_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull(),
    postId: uuid("post_id").notNull(),
    revision: integer("revision").notNull(),
    lifecycle: storyPostLifecycleEnum("lifecycle").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    gmNotes: text("gm_notes").notNull(),
    entityLinks: jsonb("entity_links").$type<unknown>().notNull().default([]),
    changedByMembershipId: uuid("changed_by_membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("story_post_revisions_campaign_post_revision_idx").on(
      table.campaignId,
      table.postId,
      table.revision,
    ),
    foreignKey({
      name: "story_post_revisions_campaign_post_fk",
      columns: [table.campaignId, table.postId],
      foreignColumns: [storyPosts.campaignId, storyPosts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "story_post_revisions_campaign_changer_fk",
      columns: [table.campaignId, table.changedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    check(
      "story_post_revisions_shape_check",
      sql`${table.revision} >= 0 AND length(trim(${table.title})) <= 160 AND length(${table.body}) <= 20000 AND length(${table.gmNotes}) <= 10000`,
    ),
  ],
);

/** Media rows are revision-scoped: a correction may add/remove media without mutating earlier snapshots. */
export const storyPostMedia = pgTable(
  "story_post_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull(),
    postId: uuid("post_id").notNull(),
    revision: integer("revision").notNull(),
    contentId: uuid("content_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    altText: text("alt_text").notNull(),
    caption: text("caption").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("story_post_media_post_revision_order_idx").on(
      table.postId,
      table.revision,
      table.sortOrder,
    ),
    uniqueIndex("story_post_media_post_revision_content_idx").on(
      table.postId,
      table.revision,
      table.contentId,
    ),
    index("story_post_media_campaign_content_idx").on(
      table.campaignId,
      table.contentId,
    ),
    foreignKey({
      name: "story_post_media_campaign_revision_fk",
      columns: [table.campaignId, table.postId, table.revision],
      foreignColumns: [
        storyPostRevisions.campaignId,
        storyPostRevisions.postId,
        storyPostRevisions.revision,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "story_post_media_campaign_upload_fk",
      columns: [table.campaignId, table.contentId],
      foreignColumns: [
        chatAttachmentUploads.campaignId,
        chatAttachmentUploads.contentId,
      ],
    }).onDelete("restrict"),
    check(
      "story_post_media_shape_check",
      sql`${table.sortOrder} BETWEEN 0 AND 99 AND length(trim(${table.altText})) BETWEEN 1 AND 240 AND length(${table.caption}) <= 2000`,
    ),
  ],
);

/** A short-lived, GM-owned dry-run that binds a reviewed local export to commit. */
export const storyImportBatches = pgTable(
  "story_import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull(),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    recordFingerprint: text("record_fingerprint").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("story_import_batches_campaign_id_idx").on(
      table.campaignId,
      table.id,
    ),
    index("story_import_batches_expiry_idx").on(
      table.campaignId,
      table.expiresAt,
    ),
    foreignKey({
      name: "story_import_batches_campaign_creator_fk",
      columns: [table.campaignId, table.createdByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    check(
      "story_import_batches_fingerprint_check",
      sql`length(${table.recordFingerprint}) = 64`,
    ),
  ],
);
/** GM-only provenance and review state for idempotent, export-driven imports. */
export const storyImportSources = pgTable(
  "story_import_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull(),
    postId: uuid("post_id").notNull(),
    provider: storyImportProviderEnum("provider").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    sourceAuthor: text("source_author").notNull(),
    sourceTimestamp: timestamp("source_timestamp", {
      withTimezone: true,
    }).notNull(),
    sourceUrl: text("source_url"),
    /** Original import payload, including source media ordering; never player-projected. */
    sourcePayload: jsonb("source_payload")
      .$type<unknown>()
      .notNull()
      .default({}),
    rightsStatus: storyRightsStatusEnum("rights_status")
      .notNull()
      .default("PENDING"),
    importBatchId: uuid("import_batch_id").notNull(),
    importedByMembershipId: uuid("imported_by_membership_id").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("story_import_sources_campaign_provider_message_idx").on(
      table.campaignId,
      table.provider,
      table.sourceMessageId,
    ),
    index("story_import_sources_campaign_batch_idx").on(
      table.campaignId,
      table.importBatchId,
    ),
    foreignKey({
      name: "story_import_sources_campaign_post_fk",
      columns: [table.campaignId, table.postId],
      foreignColumns: [storyPosts.campaignId, storyPosts.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "story_import_sources_campaign_importer_fk",
      columns: [table.campaignId, table.importedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "story_import_sources_campaign_batch_fk",
      columns: [table.campaignId, table.importBatchId],
      foreignColumns: [storyImportBatches.campaignId, storyImportBatches.id],
    }).onDelete("restrict"),
    check(
      "story_import_sources_shape_check",
      sql`length(trim(${table.sourceMessageId})) BETWEEN 1 AND 128 AND length(trim(${table.sourceAuthor})) BETWEEN 1 AND 200 AND length(coalesce(${table.sourceUrl}, '')) <= 2048`,
    ),
  ],
);

export const chatReadCursors = pgTable(
  "chat_read_cursors",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    threadId: uuid("thread_id").notNull(),
    lastReadSequence: bigint("last_read_sequence", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("chat_read_cursors_membership_thread_idx").on(
      table.membershipId,
      table.threadId,
    ),
    foreignKey({
      name: "chat_read_cursors_campaign_membership_fk",
      columns: [table.campaignId, table.membershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chat_read_cursors_campaign_thread_fk",
      columns: [table.campaignId, table.threadId],
      foreignColumns: [chatThreads.campaignId, chatThreads.id],
    }).onDelete("cascade"),
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
  revision: integer("revision").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Durable player-to-GM requests. Visibility is always filtered server-side. */
export const playerRequests = pgTable(
  "player_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    authorMembershipId: uuid("author_membership_id").notNull(),
    characterId: uuid("character_id"),
    audience: playerRequestAudienceEnum("audience").notNull(),
    horizon: playerRequestHorizonEnum("horizon").notNull(),
    status: playerRequestStatusEnum("status").notNull().default("SUBMITTED"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    resolutionNote: text("resolution_note"),
    resolvedByMembershipId: uuid("resolved_by_membership_id"),
    revision: integer("revision").notNull().default(0),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("player_requests_campaign_id_idx").on(
      table.campaignId,
      table.id,
    ),
    index("player_requests_campaign_created_idx").on(
      table.campaignId,
      table.createdAt,
    ),
    index("player_requests_campaign_author_idx").on(
      table.campaignId,
      table.authorMembershipId,
    ),
    index("player_requests_campaign_status_idx").on(
      table.campaignId,
      table.status,
    ),
    index("player_requests_campaign_horizon_status_idx").on(
      table.campaignId,
      table.horizon,
      table.status,
    ),
    foreignKey({
      name: "player_requests_campaign_author_fk",
      columns: [table.campaignId, table.authorMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "player_requests_campaign_character_fk",
      columns: [table.campaignId, table.characterId],
      foreignColumns: [characters.campaignId, characters.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "player_requests_campaign_resolver_fk",
      columns: [table.campaignId, table.resolvedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    check(
      "player_requests_content_revision_check",
      sql`length(trim(${table.title})) BETWEEN 1 AND 120 AND length(trim(${table.body})) BETWEEN 1 AND 4000 AND ${table.revision} >= 0`,
    ),
    check(
      "player_requests_resolution_shape_check",
      sql`((${table.status} IN ('RESOLVED', 'DECLINED')) AND ${table.resolvedByMembershipId} IS NOT NULL) OR ((${table.status} NOT IN ('RESOLVED', 'DECLINED')) AND ${table.resolvedByMembershipId} IS NULL AND ${table.resolutionNote} IS NULL)`,
    ),
    check(
      "player_requests_resolution_note_length_check",
      sql`${table.resolutionNote} IS NULL OR length(trim(${table.resolutionNote})) BETWEEN 1 AND 2000`,
    ),
    check(
      "player_requests_cancellation_shape_check",
      sql`(${table.status} = 'CANCELLED' AND ${table.cancelledAt} IS NOT NULL) OR (${table.status} <> 'CANCELLED' AND ${table.cancelledAt} IS NULL)`,
    ),
  ],
);

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

/**
 * Encounter lifecycle for UIX-311 ("start combat from a map region or a
 * linked tactical scene"). Stage 1: data model + atomic server commands only,
 * no client UI.
 *
 * `sourceSceneId` is the tactical scene the GM was on when combat started.
 * `targetSceneId` is the scene that becomes/stays the campaign's active
 * scene for the encounter: for SCENE_REGION it always equals sourceSceneId
 * (camera-focus hint only, never a movement boundary); for LINKED_SCENE it
 * is the prepared destination scene, activated atomically with the encounter.
 * `focusRegion` and `locationId` are mutually exclusive per mode (see the
 * shape check below). `sourceSceneRevision` pins the source scene's revision
 * at start time for optimistic-concurrency validation of the atomic
 * transaction; it is not re-checked on end.
 */
export const encounters = pgTable(
  "encounters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    /** Campaign-scoped ordering counter, mirrors fog_reveals.sequence. */
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    status: encounterStatusEnum("status").notNull().default("ACTIVE"),
    mode: encounterModeEnum("mode").notNull(),
    sourceSceneId: uuid("source_scene_id").notNull(),
    targetSceneId: uuid("target_scene_id").notNull(),
    /** SCENE_REGION only: camera-focus hint rectangle, scene world coordinates. */
    focusRegion: jsonb("focus_region").$type<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>(),
    /** LINKED_SCENE only, nullable: set when triggered from a world-map location. */
    locationId: uuid("location_id"),
    sourceSceneRevision: integer("source_scene_revision").notNull(),
    initiatorMembershipId: uuid("initiator_membership_id").notNull(),
    revision: integer("revision").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedByMembershipId: uuid("ended_by_membership_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("encounters_campaign_idx").on(table.campaignId),
    uniqueIndex("encounters_campaign_id_id_idx").on(
      table.campaignId,
      table.id,
    ),
    /** At most one ACTIVE encounter per campaign. */
    uniqueIndex("encounters_campaign_active_idx")
      .on(table.campaignId)
      .where(sql`${table.status} = 'ACTIVE'`),
    foreignKey({
      name: "encounters_campaign_source_scene_fk",
      columns: [table.campaignId, table.sourceSceneId],
      foreignColumns: [scenes.campaignId, scenes.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "encounters_campaign_target_scene_fk",
      columns: [table.campaignId, table.targetSceneId],
      foreignColumns: [scenes.campaignId, scenes.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "encounters_campaign_location_fk",
      columns: [table.campaignId, table.locationId],
      foreignColumns: [worldMapLocations.campaignId, worldMapLocations.id],
    }).onDelete("set null"),
    foreignKey({
      name: "encounters_campaign_initiator_fk",
      columns: [table.campaignId, table.initiatorMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "encounters_campaign_ended_by_fk",
      columns: [table.campaignId, table.endedByMembershipId],
      foreignColumns: [memberships.campaignId, memberships.id],
    }).onDelete("restrict"),
    check(
      "encounters_revision_check",
      sql`${table.revision} >= 0 AND ${table.sourceSceneRevision} >= 0`,
    ),
    check(
      "encounters_mode_shape_check",
      sql`(${table.mode} = 'SCENE_REGION' AND ${table.targetSceneId} = ${table.sourceSceneId} AND ${table.focusRegion} IS NOT NULL AND ${table.locationId} IS NULL) OR (${table.mode} = 'LINKED_SCENE' AND ${table.focusRegion} IS NULL)`,
    ),
    check(
      "encounters_status_shape_check",
      sql`(${table.status} = 'ACTIVE' AND ${table.endedAt} IS NULL AND ${table.endedByMembershipId} IS NULL) OR (${table.status} = 'ENDED' AND ${table.endedAt} IS NOT NULL AND ${table.endedByMembershipId} IS NOT NULL)`,
    ),
  ],
);
