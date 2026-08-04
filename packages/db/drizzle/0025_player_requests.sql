CREATE TYPE "public"."player_request_audience" AS ENUM('PUBLIC', 'GM_ONLY');
--> statement-breakpoint
CREATE TYPE "public"."player_request_horizon" AS ENUM('NOW', 'BEFORE_BREAK', 'NEXT_SESSION');
--> statement-breakpoint
CREATE TYPE "public"."player_request_status" AS ENUM('SUBMITTED', 'ACKNOWLEDGED', 'RESOLVED', 'DECLINED', 'CANCELLED');
--> statement-breakpoint
CREATE TABLE "player_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "author_membership_id" uuid NOT NULL,
  "character_id" uuid,
  "audience" "player_request_audience" NOT NULL,
  "horizon" "player_request_horizon" NOT NULL,
  "status" "player_request_status" DEFAULT 'SUBMITTED' NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "resolution_note" text,
  "resolved_by_membership_id" uuid,
  "revision" integer DEFAULT 0 NOT NULL,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "player_requests_content_revision_check" CHECK (length(trim("title")) BETWEEN 1 AND 120 AND length(trim("body")) BETWEEN 1 AND 4000 AND "revision" >= 0),
  CONSTRAINT "player_requests_resolution_shape_check" CHECK ((("status" IN ('RESOLVED', 'DECLINED')) AND "resolved_by_membership_id" IS NOT NULL) OR (("status" NOT IN ('RESOLVED', 'DECLINED')) AND "resolved_by_membership_id" IS NULL AND "resolution_note" IS NULL)),
  CONSTRAINT "player_requests_resolution_note_length_check" CHECK ("resolution_note" IS NULL OR length(trim("resolution_note")) BETWEEN 1 AND 2000),
  CONSTRAINT "player_requests_cancellation_shape_check" CHECK (("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL) OR ("status" <> 'CANCELLED' AND "cancelled_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "player_requests" ADD CONSTRAINT "player_requests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "player_requests" ADD CONSTRAINT "player_requests_campaign_author_fk" FOREIGN KEY ("campaign_id","author_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "player_requests" ADD CONSTRAINT "player_requests_campaign_character_fk" FOREIGN KEY ("campaign_id","character_id") REFERENCES "public"."characters"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "player_requests" ADD CONSTRAINT "player_requests_campaign_resolver_fk" FOREIGN KEY ("campaign_id","resolved_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "player_requests_campaign_created_idx" ON "player_requests" USING btree ("campaign_id","created_at");
--> statement-breakpoint
CREATE INDEX "player_requests_campaign_author_idx" ON "player_requests" USING btree ("campaign_id","author_membership_id");
--> statement-breakpoint
CREATE INDEX "player_requests_campaign_status_idx" ON "player_requests" USING btree ("campaign_id","status");
--> statement-breakpoint
CREATE INDEX "player_requests_campaign_horizon_status_idx" ON "player_requests" USING btree ("campaign_id","horizon","status");
