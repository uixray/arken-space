CREATE TABLE "game_events" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"entity_revision" integer,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_events_campaign_action_idx" ON "game_events" USING btree ("campaign_id","action_id");--> statement-breakpoint
CREATE INDEX "game_events_campaign_sequence_idx" ON "game_events" USING btree ("campaign_id","sequence");