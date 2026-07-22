ALTER TYPE "public"."chat_thread_type" ADD VALUE 'DIRECT';
--> statement-breakpoint
CREATE TYPE "public"."chat_attachment_upload_status" AS ENUM('STAGED', 'CLAIMED', 'EXPIRED');
--> statement-breakpoint
ALTER TABLE "chat_threads" ALTER COLUMN "stream" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "participant_a_membership_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "participant_b_membership_id" uuid;
--> statement-breakpoint
DROP INDEX "chat_threads_campaign_stream_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_campaign_stream_idx" ON "chat_threads" USING btree ("campaign_id","stream");
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_campaign_direct_pair_idx" ON "chat_threads" USING btree ("campaign_id","participant_a_membership_id","participant_b_membership_id") WHERE "stream" IS NULL;
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_campaign_participant_a_fk" FOREIGN KEY ("campaign_id","participant_a_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_campaign_participant_b_fk" FOREIGN KEY ("campaign_id","participant_b_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_shape_check" CHECK (("type"::text = 'STREAM' AND "stream" IS NOT NULL AND "participant_a_membership_id" IS NULL AND "participant_b_membership_id" IS NULL) OR ("type"::text = 'DIRECT' AND "stream" IS NULL AND "participant_a_membership_id" IS NOT NULL AND "participant_b_membership_id" IS NOT NULL AND "participant_a_membership_id" < "participant_b_membership_id"));
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_campaign_thread_id_idx" ON "chat_messages" USING btree ("campaign_id","thread_id","id");
--> statement-breakpoint
CREATE TABLE "chat_attachment_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "content_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "uploaded_by_membership_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "storage_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "width" integer,
  "height" integer,
  "status" "chat_attachment_upload_status" DEFAULT 'STAGED' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_attachment_uploads_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "chat_attachment_uploads_dimensions_check" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_attachment_uploads_content_id_idx" ON "chat_attachment_uploads" USING btree ("content_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_attachment_uploads_campaign_content_idx" ON "chat_attachment_uploads" USING btree ("campaign_id","content_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_attachment_uploads_storage_key_idx" ON "chat_attachment_uploads" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX "chat_attachment_uploads_expiry_idx" ON "chat_attachment_uploads" USING btree ("status","expires_at");
--> statement-breakpoint
ALTER TABLE "chat_attachment_uploads" ADD CONSTRAINT "chat_attachment_uploads_campaign_uploader_fk" FOREIGN KEY ("campaign_id","uploaded_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "chat_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "content_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_attachments_content_id_idx" ON "chat_attachments" USING btree ("content_id");
--> statement-breakpoint
CREATE INDEX "chat_attachments_message_idx" ON "chat_attachments" USING btree ("message_id");
--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_campaign_upload_fk" FOREIGN KEY ("campaign_id","content_id") REFERENCES "public"."chat_attachment_uploads"("campaign_id","content_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_campaign_thread_fk" FOREIGN KEY ("campaign_id","thread_id") REFERENCES "public"."chat_threads"("campaign_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_campaign_thread_message_fk" FOREIGN KEY ("campaign_id","thread_id","message_id") REFERENCES "public"."chat_messages"("campaign_id","thread_id","id") ON DELETE cascade ON UPDATE no action;
