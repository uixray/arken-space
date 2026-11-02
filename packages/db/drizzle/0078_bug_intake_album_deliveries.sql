CREATE TABLE "bug_intake_album_deliveries" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "album_id" uuid NOT NULL,
 "approved_revision" integer NOT NULL,
 "state" text DEFAULT 'QUEUED' NOT NULL,
 "payload" jsonb NOT NULL, "payload_hash" text NOT NULL,
 "claim_id" uuid, "upload_receipts" jsonb DEFAULT '{}'::jsonb NOT NULL,
 "linear_issue_id" text, "failure_code" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "bug_intake_album_delivery_state_check" CHECK ("bug_intake_album_deliveries"."state" IN ('QUEUED','CLAIMED','SENT','UNKNOWN','CANCELLED')),
 CONSTRAINT "bug_intake_album_delivery_revision_check" CHECK ("bug_intake_album_deliveries"."approved_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bug_intake_album_deliveries" ADD CONSTRAINT "bug_intake_album_deliveries_album_id_bug_intake_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."bug_intake_albums"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "bug_intake_album_delivery_revision_unique" ON "bug_intake_album_deliveries" USING btree ("album_id","approved_revision");
--> statement-breakpoint
CREATE INDEX "bug_intake_album_delivery_state_idx" ON "bug_intake_album_deliveries" USING btree ("state","created_at","id");
