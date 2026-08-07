CREATE TYPE "public"."character_media_category" AS ENUM('CHARACTER_ART', 'ARTIFACT', 'ITEM', 'DOCUMENT_HANDOUT', 'MEMORY_SCENE', 'OTHER');
--> statement-breakpoint
CREATE TYPE "public"."character_media_visibility" AS ENUM('OWNER_GM', 'PARTY', 'GM_ONLY');
--> statement-breakpoint
CREATE TABLE "character_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "character_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "category" "character_media_category" NOT NULL,
  "caption" text,
  "ordering" integer DEFAULT 0 NOT NULL,
  "visibility" "character_media_visibility" DEFAULT 'OWNER_GM' NOT NULL,
  "related_entity_id" uuid,
  "uploaded_by_membership_id" uuid NOT NULL,
  "detached_at" timestamp with time zone,
  "detached_by_membership_id" uuid,
  "revision" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "character_media_caption_check" CHECK ("caption" IS NULL OR length(trim("caption")) BETWEEN 1 AND 500),
  CONSTRAINT "character_media_ordering_revision_check" CHECK ("ordering" >= 0 AND "revision" >= 0),
  CONSTRAINT "character_media_detach_shape_check" CHECK (("detached_at" IS NULL AND "detached_by_membership_id" IS NULL) OR ("detached_at" IS NOT NULL AND "detached_by_membership_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "character_media" ADD CONSTRAINT "character_media_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "character_media" ADD CONSTRAINT "character_media_campaign_character_fk" FOREIGN KEY ("campaign_id","character_id") REFERENCES "public"."characters"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "character_media" ADD CONSTRAINT "character_media_campaign_asset_fk" FOREIGN KEY ("campaign_id","asset_id") REFERENCES "public"."assets"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "character_media" ADD CONSTRAINT "character_media_campaign_uploader_fk" FOREIGN KEY ("campaign_id","uploaded_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "character_media" ADD CONSTRAINT "character_media_campaign_detacher_fk" FOREIGN KEY ("campaign_id","detached_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "character_media_campaign_id_id_idx" ON "character_media" USING btree ("campaign_id","id");
--> statement-breakpoint
CREATE INDEX "character_media_character_ordering_idx" ON "character_media" USING btree ("character_id","ordering");
--> statement-breakpoint
CREATE INDEX "character_media_character_detached_idx" ON "character_media" USING btree ("character_id","detached_at");
