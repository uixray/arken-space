CREATE TYPE "public"."character_lifecycle" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "lifecycle" character_lifecycle DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "archived_by_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_campaign_archiver_fk" FOREIGN KEY ("campaign_id","archived_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "characters_campaign_lifecycle_idx" ON "characters" USING btree ("campaign_id","lifecycle");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_lifecycle_shape_check" CHECK (("characters"."lifecycle" = 'ACTIVE' AND "characters"."archived_at" IS NULL AND "characters"."archived_by_membership_id" IS NULL) OR ("characters"."lifecycle" = 'ARCHIVED' AND "characters"."archived_at" IS NOT NULL AND "characters"."archived_by_membership_id" IS NOT NULL));