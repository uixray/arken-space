CREATE TYPE "public"."world_content_type" AS ENUM('LOCATION', 'PERSON', 'MONSTER', 'DEITY', 'FACTION', 'ITEM', 'ARTICLE');--> statement-breakpoint
CREATE TYPE "public"."world_content_lifecycle" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."world_content_review_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "world_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"type" "world_content_type" NOT NULL,
	"subtype" text,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"public_text" text DEFAULT '' NOT NULL,
	"gm_only_text" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lifecycle" "world_content_lifecycle" DEFAULT 'DRAFT' NOT NULL,
	"cover_asset_id" uuid,
	"source_url" text,
	"source_external_id" text,
	"retrieved_at" timestamp with time zone,
	"raw_content_hash" text,
	"attribution" text,
	"rights_review_status" "world_content_review_status",
	"editorial_approval_status" "world_content_review_status",
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_content_slug_format_check" CHECK ("world_content"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("world_content"."slug") BETWEEN 1 AND 160),
	CONSTRAINT "world_content_shape_check" CHECK (length(trim("world_content"."name")) BETWEEN 1 AND 200 AND length("world_content"."summary") <= 2000 AND length("world_content"."public_text") <= 50000 AND length("world_content"."gm_only_text") <= 50000 AND "world_content"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "world_content_actions" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
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
CREATE TABLE "world_content_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_content_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"caption" text,
	"ordering" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_content_media_shape_check" CHECK ("world_content_media"."ordering" >= 0 AND ("world_content_media"."caption" IS NULL OR length(trim("world_content_media"."caption")) BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE TABLE "world_content_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_world_content_id" uuid NOT NULL,
	"to_world_content_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"note" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_content_relations_shape_check" CHECK ("world_content_relations"."from_world_content_id" <> "world_content_relations"."to_world_content_id" AND length(trim("world_content_relations"."relation_type")) BETWEEN 1 AND 60 AND "world_content_relations"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "world_content_media" ADD CONSTRAINT "world_content_media_world_content_id_world_content_id_fk" FOREIGN KEY ("world_content_id") REFERENCES "public"."world_content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_content_relations" ADD CONSTRAINT "world_content_relations_from_world_content_id_world_content_id_fk" FOREIGN KEY ("from_world_content_id") REFERENCES "public"."world_content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_content_relations" ADD CONSTRAINT "world_content_relations_to_world_content_id_world_content_id_fk" FOREIGN KEY ("to_world_content_id") REFERENCES "public"."world_content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "world_content_slug_idx" ON "world_content" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "world_content_type_lifecycle_idx" ON "world_content" USING btree ("type","lifecycle");--> statement-breakpoint
CREATE INDEX "world_content_lifecycle_updated_idx" ON "world_content" USING btree ("lifecycle","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "world_content_actions_action_idx" ON "world_content_actions" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "world_content_actions_entity_idx" ON "world_content_actions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "world_content_media_entity_ordering_idx" ON "world_content_media" USING btree ("world_content_id","ordering");--> statement-breakpoint
CREATE UNIQUE INDEX "world_content_media_entity_asset_idx" ON "world_content_media" USING btree ("world_content_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "world_content_relations_edge_idx" ON "world_content_relations" USING btree ("from_world_content_id","to_world_content_id","relation_type");--> statement-breakpoint
CREATE INDEX "world_content_relations_reverse_idx" ON "world_content_relations" USING btree ("to_world_content_id");
