CREATE TYPE "public"."feedback_status" AS ENUM('NEW', 'ACKNOWLEDGED', 'LINKED', 'RESOLVED', 'DISMISSED');
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD COLUMN "status" "feedback_status" DEFAULT 'NEW' NOT NULL;
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD COLUMN "linear_key" text;
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD COLUMN "linear_url" text;
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE "feedback_operator_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "report_id" uuid NOT NULL,
  "operator_membership_id" uuid NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_operator_audits" ADD CONSTRAINT "feedback_operator_audits_report_id_feedback_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."feedback_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback_operator_audits" ADD CONSTRAINT "feedback_operator_audits_operator_membership_id_memberships_id_fk" FOREIGN KEY ("operator_membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "feedback_operator_audits_report_idx" ON "feedback_operator_audits" USING btree ("report_id");
--> statement-breakpoint
CREATE INDEX "feedback_reports_operator_queue_idx" ON "feedback_reports" USING btree ("status", "created_at", "id");
