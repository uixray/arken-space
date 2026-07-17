CREATE TYPE "public"."feedback_kind" AS ENUM('SUGGESTION', 'BUG', 'IDEA');
--> statement-breakpoint
CREATE TYPE "public"."feedback_attachment_kind" AS ENUM('SCREENSHOT', 'USER_IMAGE');
--> statement-breakpoint
CREATE TABLE "feedback_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "feedback_kind" NOT NULL,
	"campaign_id" uuid,
	"actor_membership_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"contact" text,
	"build_version" text NOT NULL,
	"build_revision" text NOT NULL,
	"request_id" text NOT NULL,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" "feedback_attachment_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_actor_membership_id_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_report_id_feedback_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."feedback_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "feedback_reports_created_idx" ON "feedback_reports" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "feedback_reports_campaign_idx" ON "feedback_reports" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX "feedback_attachments_report_idx" ON "feedback_attachments" USING btree ("report_id");
