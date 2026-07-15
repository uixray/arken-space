ALTER TYPE "public"."token_layer" RENAME VALUE 'PLAYERS' TO 'PLAYER';--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "layer" SET DEFAULT 'PLAYER';--> statement-breakpoint
CREATE TYPE "public"."fog_operation" AS ENUM('REVEAL', 'COVER');--> statement-breakpoint
CREATE TYPE "public"."journal_status" AS ENUM('APPLIED', 'UNDONE', 'INVALIDATED');--> statement-breakpoint
CREATE TABLE "action_journal" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"scene_id" uuid,
	"actor_membership_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"scope" text DEFAULT 'PUBLIC' NOT NULL,
	"type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"before_revision" integer,
	"after_revision" integer,
	"current_revision" integer,
	"status" "journal_status" DEFAULT 'APPLIED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drawings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"author_membership_id" uuid NOT NULL,
	"points" jsonb NOT NULL,
	"color" text DEFAULT '#ffffff' NOT NULL,
	"x" double precision DEFAULT 0 NOT NULL,
	"y" double precision DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fog_reveals" ADD COLUMN "operation" "fog_operation" DEFAULT 'REVEAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "fog_reveals" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "fog_reveals" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "map_scale" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "action_journal" ADD CONSTRAINT "action_journal_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_journal" ADD CONSTRAINT "action_journal_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_journal" ADD CONSTRAINT "action_journal_actor_membership_id_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_author_membership_id_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_journal_campaign_action_idx" ON "action_journal" USING btree ("campaign_id","action_id");--> statement-breakpoint
CREATE INDEX "action_journal_campaign_sequence_idx" ON "action_journal" USING btree ("campaign_id","sequence");--> statement-breakpoint
CREATE INDEX "drawings_scene_idx" ON "drawings" USING btree ("scene_id");
