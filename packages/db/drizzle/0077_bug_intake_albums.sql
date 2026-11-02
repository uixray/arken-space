CREATE TABLE "bug_intake_albums" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "provider" text NOT NULL, "chat_id" text NOT NULL, "album_id" text NOT NULL,
 "revision" integer DEFAULT 0 NOT NULL, "state" text DEFAULT 'REVIEW' NOT NULL,
 "approval" jsonb, "linear_issue_id" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "bug_intake_album_provider_check" CHECK ("bug_intake_albums"."provider" = 'TELEGRAM'),
 CONSTRAINT "bug_intake_album_revision_check" CHECK ("bug_intake_albums"."revision" >= 0),
 CONSTRAINT "bug_intake_album_state_check" CHECK ("bug_intake_albums"."state" IN ('REVIEW', 'APPROVED', 'LINKED', 'DISMISSED')),
 CONSTRAINT "bug_intake_album_approval_check" CHECK ("bug_intake_albums"."state" <> 'APPROVED' OR "bug_intake_albums"."approval" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bug_intake_album_source_unique" ON "bug_intake_albums" USING btree ("provider","chat_id","album_id");
--> statement-breakpoint
CREATE INDEX "bug_intake_album_queue_idx" ON "bug_intake_albums" USING btree ("state","updated_at","id");
