CREATE TABLE "campaign_sound_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"audience" text DEFAULT 'ALL_MEMBERS' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_sound_packs_audience_check" CHECK ("campaign_sound_packs"."audience" IN ('ALL_MEMBERS','GM_ONLY')),
	CONSTRAINT "campaign_sound_packs_name_check" CHECK (length(trim("campaign_sound_packs"."name")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "campaign_soundpad_settings" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"player_playback_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_sounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"label" text NOT NULL,
	"icon" text DEFAULT '🔊' NOT NULL,
	"category" text DEFAULT 'Другое' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"default_gain" double precision DEFAULT 0.5 NOT NULL,
	"audience" text DEFAULT 'ALL_MEMBERS' NOT NULL,
	"source_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_sounds_audience_check" CHECK ("campaign_sounds"."audience" IN ('ALL_MEMBERS','GM_ONLY')),
	CONSTRAINT "campaign_sounds_gain_check" CHECK ("campaign_sounds"."default_gain" >= 0 AND "campaign_sounds"."default_gain" <= 1),
	CONSTRAINT "campaign_sounds_label_check" CHECK (length(trim("campaign_sounds"."label")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sound_packs_campaign_id_id_idx" ON "campaign_sound_packs" USING btree ("campaign_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sounds_campaign_id_id_idx" ON "campaign_sounds" USING btree ("campaign_id","id");--> statement-breakpoint
ALTER TABLE "campaign_sound_packs" ADD CONSTRAINT "campaign_sound_packs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_soundpad_settings" ADD CONSTRAINT "campaign_soundpad_settings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sounds" ADD CONSTRAINT "campaign_sounds_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sounds" ADD CONSTRAINT "campaign_sounds_campaign_pack_fk" FOREIGN KEY ("campaign_id","pack_id") REFERENCES "public"."campaign_sound_packs"("campaign_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sounds" ADD CONSTRAINT "campaign_sounds_campaign_asset_fk" FOREIGN KEY ("campaign_id","asset_id") REFERENCES "public"."assets"("campaign_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sound_packs_campaign_name_idx" ON "campaign_sound_packs" USING btree ("campaign_id","name");--> statement-breakpoint
CREATE INDEX "campaign_sound_packs_campaign_idx" ON "campaign_sound_packs" USING btree ("campaign_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sounds_pack_asset_idx" ON "campaign_sounds" USING btree ("pack_id","asset_id");--> statement-breakpoint
CREATE INDEX "campaign_sounds_pack_order_idx" ON "campaign_sounds" USING btree ("pack_id","sort_order");
