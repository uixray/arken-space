CREATE UNIQUE INDEX "token_definitions_campaign_id_unique" ON "token_definitions" ("campaign_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "world_instances_campaign_id_unique" ON "world_content_instances" ("campaign_id", "id");
--> statement-breakpoint
CREATE TABLE "world_instance_bindings" (
  "instance_id" uuid PRIMARY KEY NOT NULL,
  "campaign_id" uuid NOT NULL,
  "token_definition_id" uuid,
  "container_instance_id" uuid,
  "revision" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "world_instance_bindings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE,
  CONSTRAINT "binding_campaign_instance_fk" FOREIGN KEY ("campaign_id","instance_id") REFERENCES "world_content_instances" ("campaign_id","id") ON DELETE CASCADE,
  CONSTRAINT "binding_campaign_token_fk" FOREIGN KEY ("campaign_id","token_definition_id") REFERENCES "token_definitions" ("campaign_id","id") ON DELETE NO ACTION,
  CONSTRAINT "binding_campaign_container_fk" FOREIGN KEY ("campaign_id","container_instance_id") REFERENCES "world_content_instances" ("campaign_id","id") ON DELETE NO ACTION,
  CONSTRAINT "instance_binding_no_self" CHECK ("world_instance_bindings"."container_instance_id" IS NULL OR "world_instance_bindings"."container_instance_id" <> "world_instance_bindings"."instance_id")
);
--> statement-breakpoint
CREATE TABLE "achievement_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "color" text NOT NULL,
  "icon_asset_id" uuid,
  "provenance" text DEFAULT '' NOT NULL,
  "archived" boolean DEFAULT false NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "achievement_definitions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE,
  CONSTRAINT "achievement_campaign_icon_fk" FOREIGN KEY ("campaign_id","icon_asset_id") REFERENCES "assets" ("campaign_id","id") ON DELETE NO ACTION
);
--> statement-breakpoint
CREATE UNIQUE INDEX "achievement_campaign_id_unique" ON "achievement_definitions" ("campaign_id", "id");
--> statement-breakpoint
CREATE TABLE "achievement_awards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "achievement_id" uuid NOT NULL,
  "membership_id" uuid NOT NULL,
  "public" boolean DEFAULT false NOT NULL,
  "revoked" boolean DEFAULT false NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "achievement_awards_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE,
  CONSTRAINT "award_campaign_definition_fk" FOREIGN KEY ("campaign_id","achievement_id") REFERENCES "achievement_definitions" ("campaign_id","id") ON DELETE CASCADE,
  CONSTRAINT "award_campaign_member_fk" FOREIGN KEY ("campaign_id","membership_id") REFERENCES "memberships" ("campaign_id","id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "achievement_award_member_unique" ON "achievement_awards" ("achievement_id", "membership_id");
--> statement-breakpoint
CREATE TABLE "achievement_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "operation" text NOT NULL,
  "reason" text NOT NULL,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "achievement_history_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE,
  CONSTRAINT "achievement_history_actor_membership_id_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "memberships" ("id") ON DELETE NO ACTION
);
