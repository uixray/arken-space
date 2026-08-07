CREATE TYPE "public"."encounter_status" AS ENUM('ACTIVE', 'ENDED');
--> statement-breakpoint
CREATE TYPE "public"."encounter_mode" AS ENUM('SCENE_REGION', 'LINKED_SCENE');
--> statement-breakpoint
CREATE TABLE "encounters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "sequence" bigserial NOT NULL,
  "status" "encounter_status" DEFAULT 'ACTIVE' NOT NULL,
  "mode" "encounter_mode" NOT NULL,
  "source_scene_id" uuid NOT NULL,
  "target_scene_id" uuid NOT NULL,
  "focus_region" jsonb,
  "location_id" uuid,
  "source_scene_revision" integer NOT NULL,
  "initiator_membership_id" uuid NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "ended_by_membership_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "encounters_revision_check" CHECK ("revision" >= 0 AND "source_scene_revision" >= 0),
  CONSTRAINT "encounters_mode_shape_check" CHECK (("mode" = 'SCENE_REGION' AND "target_scene_id" = "source_scene_id" AND "focus_region" IS NOT NULL AND "location_id" IS NULL) OR ("mode" = 'LINKED_SCENE' AND "focus_region" IS NULL)),
  CONSTRAINT "encounters_status_shape_check" CHECK (("status" = 'ACTIVE' AND "ended_at" IS NULL AND "ended_by_membership_id" IS NULL) OR ("status" = 'ENDED' AND "ended_at" IS NOT NULL AND "ended_by_membership_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_campaign_source_scene_fk" FOREIGN KEY ("campaign_id","source_scene_id") REFERENCES "public"."scenes"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_campaign_target_scene_fk" FOREIGN KEY ("campaign_id","target_scene_id") REFERENCES "public"."scenes"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_campaign_location_fk" FOREIGN KEY ("campaign_id","location_id") REFERENCES "public"."world_map_locations"("campaign_id","id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_campaign_initiator_fk" FOREIGN KEY ("campaign_id","initiator_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_campaign_ended_by_fk" FOREIGN KEY ("campaign_id","ended_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "encounters_campaign_idx" ON "encounters" USING btree ("campaign_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_campaign_id_id_idx" ON "encounters" USING btree ("campaign_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_campaign_active_idx" ON "encounters" USING btree ("campaign_id") WHERE "status" = 'ACTIVE';
