CREATE TABLE "world_content_instance_actions" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"entity_revision" integer,
	"actor_membership_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_content_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"world_content_id" uuid NOT NULL,
	"display_name_override" text,
	"current_state" text,
	"gm_notes" text,
	"portrait_asset_id" uuid,
	"owner_membership_id" uuid,
	"current_location_id" uuid,
	"quantity" integer,
	"condition" text,
	"discovered" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_content_instances_shape_check" CHECK (("world_content_instances"."display_name_override" IS NULL OR length(trim("world_content_instances"."display_name_override")) BETWEEN 1 AND 200) AND ("world_content_instances"."current_state" IS NULL OR length("world_content_instances"."current_state") <= 4000) AND ("world_content_instances"."gm_notes" IS NULL OR length("world_content_instances"."gm_notes") <= 20000) AND ("world_content_instances"."condition" IS NULL OR length(trim("world_content_instances"."condition")) BETWEEN 1 AND 200) AND ("world_content_instances"."quantity" IS NULL OR "world_content_instances"."quantity" >= 0) AND "world_content_instances"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "world_content_instance_actions" ADD CONSTRAINT "world_content_instance_actions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_content_instances" ADD CONSTRAINT "world_content_instances_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_content_instances" ADD CONSTRAINT "world_content_instances_world_content_id_world_content_id_fk" FOREIGN KEY ("world_content_id") REFERENCES "public"."world_content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_content_instances" ADD CONSTRAINT "world_content_instances_owner_membership_id_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_content_instances" ADD CONSTRAINT "world_content_instances_campaign_location_fk" FOREIGN KEY ("campaign_id","current_location_id") REFERENCES "public"."world_map_locations"("campaign_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "world_content_instance_actions_campaign_action_idx" ON "world_content_instance_actions" USING btree ("campaign_id","action_id");--> statement-breakpoint
CREATE INDEX "world_content_instance_actions_entity_idx" ON "world_content_instance_actions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "world_content_instances_campaign_idx" ON "world_content_instances" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "world_content_instances_world_content_idx" ON "world_content_instances" USING btree ("world_content_id");--> statement-breakpoint
CREATE INDEX "world_content_instances_campaign_world_content_idx" ON "world_content_instances" USING btree ("campaign_id","world_content_id");
