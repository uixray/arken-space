CREATE TABLE "audio_clip_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_membership_id" uuid NOT NULL,
	"source_asset_id" uuid,
	"action_id" uuid NOT NULL,
	"save_action_id" uuid,
	"save_intent_hash" text,
	"intent_hash" text NOT NULL,
	"source_version" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"status" text DEFAULT 'PROCESSING' NOT NULL,
	"reserved_bytes" integer DEFAULT 0 NOT NULL,
	"storage_key" text,
	"size_bytes" integer,
	"sample_rate" integer,
	"channels" integer,
	"frames" integer,
	"actual_start_frame" integer,
	"actual_end_frame" integer,
	"actual_start_ms" double precision,
	"actual_end_ms" double precision,
	"saved_asset_id" uuid,
	"saved_sound_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_clip_candidates_status_check" CHECK ("status" IN ('PROCESSING','READY','EXPIRED','CANCELLED','SAVED','FAILED')),
	CONSTRAINT "audio_clip_candidates_range_check" CHECK ("start_ms" >= 0 AND "end_ms" > "start_ms" AND "end_ms" - "start_ms" <= 10000),
	CONSTRAINT "audio_clip_candidates_reservation_check" CHECK ("reserved_bytes" >= 0 AND ("size_bytes" IS NULL OR "size_bytes" >= 0))
);
--> statement-breakpoint
ALTER TABLE "audio_clip_candidates" ADD CONSTRAINT "audio_clip_candidates_storage_key_unique" UNIQUE ("storage_key");
--> statement-breakpoint
CREATE TABLE "audio_clip_provenance" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"source_asset_id" uuid,
	"source_version" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"actual_start_frame" integer NOT NULL,
	"actual_end_frame" integer NOT NULL,
	"sample_rate" integer NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_clip_provenance_range_check" CHECK ("start_ms" >= 0 AND "end_ms" > "start_ms" AND "end_ms" - "start_ms" <= 10000 AND "actual_start_frame" >= 0 AND "actual_end_frame" > "actual_start_frame" AND "sample_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "campaign_media_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"reserved_bytes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_media_reservations_bytes_check" CHECK ("reserved_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "audio_clip_candidates" ADD CONSTRAINT "audio_clip_candidates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "audio_clip_candidates" ADD CONSTRAINT "audio_clip_candidates_creator_membership_id_memberships_id_fk" FOREIGN KEY ("creator_membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "audio_clip_candidates" ADD CONSTRAINT "audio_clip_candidates_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "audio_clip_candidates" ADD CONSTRAINT "audio_clip_candidates_saved_asset_id_assets_id_fk" FOREIGN KEY ("saved_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "audio_clip_provenance" ADD CONSTRAINT "audio_clip_provenance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "audio_clip_provenance" ADD CONSTRAINT "audio_clip_provenance_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "audio_clip_provenance" ADD CONSTRAINT "audio_clip_provenance_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "audio_clip_provenance" ADD CONSTRAINT "audio_clip_provenance_created_by_membership_id_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id");
--> statement-breakpoint
ALTER TABLE "campaign_media_reservations" ADD CONSTRAINT "campaign_media_reservations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "audio_clip_candidates_campaign_action_idx" ON "audio_clip_candidates" USING btree ("campaign_id","action_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "audio_clip_candidates_campaign_save_action_idx" ON "audio_clip_candidates" USING btree ("campaign_id","save_action_id");
--> statement-breakpoint
CREATE INDEX "audio_clip_candidates_expiry_idx" ON "audio_clip_candidates" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE INDEX "audio_clip_candidates_source_idx" ON "audio_clip_candidates" USING btree ("source_asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "audio_clip_provenance_asset_campaign_idx" ON "audio_clip_provenance" USING btree ("asset_id","campaign_id");
--> statement-breakpoint
CREATE INDEX "audio_clip_provenance_source_idx" ON "audio_clip_provenance" USING btree ("source_asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_media_reservations_campaign_request_idx" ON "campaign_media_reservations" USING btree ("campaign_id","request_key");
--> statement-breakpoint
CREATE INDEX "campaign_media_reservations_expiry_idx" ON "campaign_media_reservations" USING btree ("expires_at");
