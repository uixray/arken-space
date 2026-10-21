ALTER TABLE "story_post_revisions" ADD COLUMN "world_day" integer;--> statement-breakpoint
ALTER TABLE "story_post_revisions" ADD COLUMN "era" text;--> statement-breakpoint
ALTER TABLE "story_posts" ADD COLUMN "world_day" integer;--> statement-breakpoint
ALTER TABLE "story_posts" ADD COLUMN "era" text;--> statement-breakpoint
CREATE INDEX "story_posts_campaign_world_day_idx" ON "story_posts" USING btree ("campaign_id","world_day","updated_at","id");--> statement-breakpoint
ALTER TABLE "story_posts" ADD CONSTRAINT "story_posts_world_time_check" CHECK (("story_posts"."world_day" IS NULL OR "story_posts"."world_day" BETWEEN 1 AND 1000000) AND ("story_posts"."era" IS NULL OR length(trim("story_posts"."era")) BETWEEN 1 AND 80));