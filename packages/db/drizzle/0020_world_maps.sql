CREATE TYPE "public"."world_map_lifecycle" AS ENUM('DRAFT','PUBLISHED','ARCHIVED');
--> statement-breakpoint
CREATE TYPE "public"."world_map_visibility" AS ENUM('CAMPAIGN','GM_ONLY');
--> statement-breakpoint
CREATE TYPE "public"."world_map_scope" AS ENUM('WORLD','REGION');
--> statement-breakpoint
CREATE TYPE "public"."world_map_location_kind" AS ENUM('SETTLEMENT','LANDMARK','REGION','OTHER');
--> statement-breakpoint
CREATE TYPE "public"."world_map_location_visibility" AS ENUM('PUBLIC','DISCOVERED','GM_ONLY');
--> statement-breakpoint
CREATE UNIQUE INDEX "assets_campaign_id_id_idx" ON "assets" ("campaign_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "scenes_campaign_id_id_idx" ON "scenes" ("campaign_id","id");
--> statement-breakpoint
CREATE TABLE "world_maps" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "campaign_id" uuid NOT NULL,
 "name" text NOT NULL,
 "scope" "world_map_scope" DEFAULT 'REGION' NOT NULL,
 "visibility" "world_map_visibility" DEFAULT 'CAMPAIGN' NOT NULL,
 "lifecycle" "world_map_lifecycle" DEFAULT 'DRAFT' NOT NULL,
 "background_asset_id" uuid,
 "background_asset_approved_by_membership_id" uuid,
 "background_asset_approved_at" timestamptz,
 "revision" integer DEFAULT 0 NOT NULL,
 "published_at" timestamptz,
 "archived_at" timestamptz,
 "created_at" timestamptz DEFAULT now() NOT NULL,
 "updated_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "world_maps_name_revision_check" CHECK (length(trim(name)) BETWEEN 1 AND 120 AND revision >= 0),
 CONSTRAINT "world_maps_background_approval_shape_check" CHECK ((background_asset_approved_by_membership_id IS NULL AND background_asset_approved_at IS NULL) OR (background_asset_id IS NOT NULL AND background_asset_approved_by_membership_id IS NOT NULL AND background_asset_approved_at IS NOT NULL)),
 CONSTRAINT "world_maps_lifecycle_shape_check" CHECK ((lifecycle='DRAFT' AND published_at IS NULL AND archived_at IS NULL) OR (lifecycle='PUBLISHED' AND background_asset_id IS NOT NULL AND background_asset_approved_by_membership_id IS NOT NULL AND background_asset_approved_at IS NOT NULL AND published_at IS NOT NULL AND archived_at IS NULL) OR (lifecycle='ARCHIVED' AND archived_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "world_maps_campaign_id_id_idx" ON "world_maps" ("campaign_id","id");
--> statement-breakpoint
CREATE INDEX "world_maps_campaign_lifecycle_idx" ON "world_maps" ("campaign_id","lifecycle");
--> statement-breakpoint
ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_campaign_background_asset_fk" FOREIGN KEY ("campaign_id","background_asset_id") REFERENCES "assets"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "world_maps" ADD CONSTRAINT "world_maps_campaign_background_approver_fk" FOREIGN KEY ("campaign_id","background_asset_approved_by_membership_id") REFERENCES "memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "world_map_locations" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "campaign_id" uuid NOT NULL,
 "map_id" uuid NOT NULL,
 "name" text NOT NULL,
 "kind" "world_map_location_kind" DEFAULT 'OTHER' NOT NULL,
 "summary" text DEFAULT '' NOT NULL,
 "gm_notes" text DEFAULT '' NOT NULL,
 "visibility" "world_map_location_visibility" DEFAULT 'GM_ONLY' NOT NULL,
 "x" double precision NOT NULL,
 "y" double precision NOT NULL,
 "revision" integer DEFAULT 0 NOT NULL,
 "created_at" timestamptz DEFAULT now() NOT NULL,
 "updated_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "world_map_locations_shape_check" CHECK (length(trim(name)) BETWEEN 1 AND 120 AND length(summary) <= 2000 AND length(gm_notes) <= 10000 AND x >= 0 AND x <= 1 AND y >= 0 AND y <= 1 AND revision >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "world_map_locations_campaign_id_id_idx" ON "world_map_locations" ("campaign_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "world_map_locations_campaign_map_id_id_idx" ON "world_map_locations" ("campaign_id","map_id","id");
--> statement-breakpoint
CREATE INDEX "world_map_locations_map_visibility_idx" ON "world_map_locations" ("map_id","visibility");
--> statement-breakpoint
ALTER TABLE "world_map_locations" ADD CONSTRAINT "world_map_locations_campaign_map_fk" FOREIGN KEY ("campaign_id","map_id") REFERENCES "world_maps"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE "world_map_location_scenes" (
 "campaign_id" uuid NOT NULL,
 "location_id" uuid NOT NULL,
 "scene_id" uuid NOT NULL,
 "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "world_map_location_scenes_unique_idx" ON "world_map_location_scenes" ("location_id","scene_id");
--> statement-breakpoint
CREATE INDEX "world_map_location_scenes_scene_idx" ON "world_map_location_scenes" ("scene_id");
--> statement-breakpoint
ALTER TABLE "world_map_location_scenes" ADD CONSTRAINT "world_map_location_scenes_campaign_location_fk" FOREIGN KEY ("campaign_id","location_id") REFERENCES "world_map_locations"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "world_map_location_scenes" ADD CONSTRAINT "world_map_location_scenes_campaign_scene_fk" FOREIGN KEY ("campaign_id","scene_id") REFERENCES "scenes"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE "world_map_party_position" (
 "campaign_id" uuid PRIMARY KEY NOT NULL,
 "map_id" uuid NOT NULL,
 "location_id" uuid NOT NULL,
 "updated_by_membership_id" uuid NOT NULL,
 "revision" integer DEFAULT 0 NOT NULL,
 "updated_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "world_map_party_position_revision_check" CHECK (revision >= 0)
);
--> statement-breakpoint
ALTER TABLE "world_map_party_position" ADD CONSTRAINT "world_map_party_position_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "world_map_party_position" ADD CONSTRAINT "world_map_party_position_campaign_map_fk" FOREIGN KEY ("campaign_id","map_id") REFERENCES "world_maps"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "world_map_party_position" ADD CONSTRAINT "world_map_party_position_campaign_map_location_fk" FOREIGN KEY ("campaign_id","map_id","location_id") REFERENCES "world_map_locations"("campaign_id","map_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "world_map_party_position" ADD CONSTRAINT "world_map_party_position_campaign_updater_fk" FOREIGN KEY ("campaign_id","updated_by_membership_id") REFERENCES "memberships"("campaign_id","id") ON DELETE restrict;