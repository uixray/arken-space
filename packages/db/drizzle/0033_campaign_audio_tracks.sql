CREATE TABLE "campaign_audio_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"asset_id" uuid,
	"mix_volume" double precision DEFAULT 1 NOT NULL,
	"playing" boolean DEFAULT false NOT NULL,
	"position_seconds" double precision DEFAULT 0 NOT NULL,
	"loop" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"slot_order" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_audio_tracks_mix_volume_check" CHECK ("campaign_audio_tracks"."mix_volume" >= 0 AND "campaign_audio_tracks"."mix_volume" <= 1)
);
--> statement-breakpoint
ALTER TABLE "campaign_audio_tracks" ADD CONSTRAINT "campaign_audio_tracks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audio_tracks" ADD CONSTRAINT "campaign_audio_tracks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_audio_tracks_campaign_id_idx" ON "campaign_audio_tracks" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_audio_tracks_campaign_slot_idx" ON "campaign_audio_tracks" USING btree ("campaign_id","slot_order");--> statement-breakpoint
INSERT INTO "campaign_audio_tracks" ("campaign_id", "asset_id", "mix_volume", "playing", "position_seconds", "loop", "started_at", "slot_order", "revision")
SELECT "campaign_id", "asset_id", 1, "playing", "position_seconds", "loop", "started_at", 0, "revision" FROM "audio_states";