CREATE TABLE "bug_intake_deliveries" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "message_id" uuid NOT NULL, "approved_revision" integer NOT NULL,
 "state" text DEFAULT 'QUEUED' NOT NULL, "payload" jsonb NOT NULL, "payload_hash" text NOT NULL,
 "claim_id" uuid, "linear_issue_id" text, "failure_code" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "bug_intake_deliveries_message_id_bug_intake_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."bug_intake_messages"("id") ON DELETE restrict ON UPDATE no action,
 CONSTRAINT "bug_intake_delivery_state_check" CHECK ("bug_intake_deliveries"."state" IN ('QUEUED', 'CLAIMED', 'SENT', 'UNKNOWN', 'CANCELLED')),
 CONSTRAINT "bug_intake_delivery_revision_check" CHECK ("bug_intake_deliveries"."approved_revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bug_intake_delivery_revision_unique" ON "bug_intake_deliveries" USING btree ("message_id","approved_revision");
--> statement-breakpoint
CREATE INDEX "bug_intake_delivery_state_idx" ON "bug_intake_deliveries" USING btree ("state","created_at","id");
