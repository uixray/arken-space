CREATE TYPE "public"."story_post_lifecycle" AS ENUM('DRAFT','PUBLISHED','CORRECTED','ARCHIVED');
--> statement-breakpoint
CREATE TYPE "public"."story_rights_status" AS ENUM('PENDING','APPROVED','REJECTED');
--> statement-breakpoint
CREATE TYPE "public"."story_import_provider" AS ENUM('TELEGRAM');
--> statement-breakpoint
CREATE TABLE "story_posts" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "campaign_id" uuid NOT NULL,
 "thread_id" uuid NOT NULL,
 "author_membership_id" uuid NOT NULL,
 "title" text DEFAULT '' NOT NULL,
 "body" text DEFAULT '' NOT NULL,
 "gm_notes" text DEFAULT '' NOT NULL,
 "entity_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
 "lifecycle" "story_post_lifecycle" DEFAULT 'DRAFT' NOT NULL,
 "visibility" "message_visibility" DEFAULT 'GM_ONLY' NOT NULL,
 "revision" integer DEFAULT 0 NOT NULL,
 "published_at" timestamptz,
 "corrected_at" timestamptz,
 "archived_at" timestamptz,
 "created_at" timestamptz DEFAULT now() NOT NULL,
 "updated_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "story_posts_shape_check" CHECK (length(trim("title")) <= 160 AND length("body") <= 20000 AND length("gm_notes") <= 10000 AND "revision" >= 0 AND (("lifecycle"::text = 'DRAFT' AND "visibility"::text = 'GM_ONLY' AND "published_at" IS NULL AND "archived_at" IS NULL) OR ("lifecycle"::text IN ('PUBLISHED','CORRECTED') AND "visibility"::text = 'PUBLIC' AND "published_at" IS NOT NULL AND "archived_at" IS NULL) OR ("lifecycle"::text = 'ARCHIVED' AND "visibility"::text = 'GM_ONLY' AND "archived_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "story_posts_campaign_id_id_idx" ON "story_posts" USING btree ("campaign_id","id");
--> statement-breakpoint
CREATE INDEX "story_posts_campaign_visibility_updated_idx" ON "story_posts" USING btree ("campaign_id","visibility","updated_at","id");
--> statement-breakpoint
ALTER TABLE "story_posts" ADD CONSTRAINT "story_posts_campaign_thread_fk" FOREIGN KEY ("campaign_id","thread_id") REFERENCES "public"."chat_threads"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "story_posts" ADD CONSTRAINT "story_posts_campaign_author_fk" FOREIGN KEY ("campaign_id","author_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "story_post_revisions" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "campaign_id" uuid NOT NULL,
 "post_id" uuid NOT NULL,
 "revision" integer NOT NULL,
 "lifecycle" "story_post_lifecycle" NOT NULL,
 "title" text NOT NULL,
 "body" text NOT NULL,
 "gm_notes" text NOT NULL,
 "entity_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
 "changed_by_membership_id" uuid NOT NULL,
 "created_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "story_post_revisions_shape_check" CHECK ("revision" >= 0 AND length(trim("title")) <= 160 AND length("body") <= 20000 AND length("gm_notes") <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "story_post_revisions_campaign_post_revision_idx" ON "story_post_revisions" USING btree ("campaign_id","post_id","revision");
--> statement-breakpoint
ALTER TABLE "story_post_revisions" ADD CONSTRAINT "story_post_revisions_campaign_post_fk" FOREIGN KEY ("campaign_id","post_id") REFERENCES "public"."story_posts"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "story_post_revisions" ADD CONSTRAINT "story_post_revisions_campaign_changer_fk" FOREIGN KEY ("campaign_id","changed_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "story_post_media" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "campaign_id" uuid NOT NULL,
 "post_id" uuid NOT NULL,
 "revision" integer NOT NULL,
 "content_id" uuid NOT NULL,
 "sort_order" integer NOT NULL,
 "alt_text" text NOT NULL,
 "caption" text DEFAULT '' NOT NULL,
 "created_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "story_post_media_shape_check" CHECK ("sort_order" BETWEEN 0 AND 99 AND length(trim("alt_text")) BETWEEN 1 AND 240 AND length("caption") <= 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "story_post_media_post_revision_order_idx" ON "story_post_media" USING btree ("post_id","revision","sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "story_post_media_post_revision_content_idx" ON "story_post_media" USING btree ("post_id","revision","content_id");
--> statement-breakpoint
CREATE INDEX "story_post_media_campaign_content_idx" ON "story_post_media" USING btree ("campaign_id","content_id");
--> statement-breakpoint
ALTER TABLE "story_post_media" ADD CONSTRAINT "story_post_media_campaign_revision_fk" FOREIGN KEY ("campaign_id","post_id","revision") REFERENCES "public"."story_post_revisions"("campaign_id","post_id","revision") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "story_post_media" ADD CONSTRAINT "story_post_media_campaign_upload_fk" FOREIGN KEY ("campaign_id","content_id") REFERENCES "public"."chat_attachment_uploads"("campaign_id","content_id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "story_import_batches" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "campaign_id" uuid NOT NULL,
 "created_by_membership_id" uuid NOT NULL,
 "record_fingerprint" text NOT NULL,
 "expires_at" timestamptz NOT NULL,
 "consumed_at" timestamptz,
 "created_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "story_import_batches_fingerprint_check" CHECK (length("record_fingerprint") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "story_import_batches_campaign_id_idx" ON "story_import_batches" USING btree ("campaign_id","id");
--> statement-breakpoint
CREATE INDEX "story_import_batches_expiry_idx" ON "story_import_batches" USING btree ("campaign_id","expires_at");
--> statement-breakpoint
ALTER TABLE "story_import_batches" ADD CONSTRAINT "story_import_batches_campaign_creator_fk" FOREIGN KEY ("campaign_id","created_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "story_import_sources" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "campaign_id" uuid NOT NULL,
 "post_id" uuid NOT NULL,
 "provider" "story_import_provider" NOT NULL,
 "source_message_id" text NOT NULL,
 "source_author" text NOT NULL,
 "source_timestamp" timestamptz NOT NULL,
 "source_url" text,
 "source_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
 "rights_status" "story_rights_status" DEFAULT 'PENDING' NOT NULL,
 "import_batch_id" uuid NOT NULL,
 "imported_by_membership_id" uuid NOT NULL,
 "imported_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "story_import_sources_shape_check" CHECK (length(trim("source_message_id")) BETWEEN 1 AND 128 AND length(trim("source_author")) BETWEEN 1 AND 200 AND length(coalesce("source_url", '')) <= 2048)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "story_import_sources_campaign_provider_message_idx" ON "story_import_sources" USING btree ("campaign_id","provider","source_message_id");
--> statement-breakpoint
CREATE INDEX "story_import_sources_campaign_batch_idx" ON "story_import_sources" USING btree ("campaign_id","import_batch_id");
--> statement-breakpoint
ALTER TABLE "story_import_sources" ADD CONSTRAINT "story_import_sources_campaign_post_fk" FOREIGN KEY ("campaign_id","post_id") REFERENCES "public"."story_posts"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "story_import_sources" ADD CONSTRAINT "story_import_sources_campaign_importer_fk" FOREIGN KEY ("campaign_id","imported_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "story_import_sources" ADD CONSTRAINT "story_import_sources_campaign_batch_fk" FOREIGN KEY ("campaign_id","import_batch_id") REFERENCES "public"."story_import_batches"("campaign_id","id") ON DELETE restrict;