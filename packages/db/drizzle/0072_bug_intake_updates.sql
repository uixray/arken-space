CREATE TABLE "bug_intake_updates" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "receiver_id" text NOT NULL, "update_id" text NOT NULL,
 "payload_hash" text NOT NULL, "payload" jsonb NOT NULL,
 "state" text DEFAULT 'PENDING' NOT NULL, "reason" text,
 "message_id" uuid,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "bug_intake_update_state_check" CHECK ("bug_intake_updates"."state" IN ('PENDING', 'PROCESSED', 'QUARANTINED')),
 CONSTRAINT "bug_intake_updates_message_id_bug_intake_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."bug_intake_messages"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bug_intake_update_identity" ON "bug_intake_updates" USING btree ("receiver_id","update_id");
--> statement-breakpoint
CREATE INDEX "bug_intake_update_pending_idx" ON "bug_intake_updates" USING btree ("state","created_at","id");
