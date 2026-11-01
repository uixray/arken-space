ALTER TABLE "player_requests" ADD COLUMN "progression" jsonb;
--> statement-breakpoint
ALTER TABLE "player_requests" ADD CONSTRAINT "player_requests_progression_private_check"
CHECK ("progression" IS NULL OR ("character_id" IS NOT NULL AND "audience" = 'GM_ONLY'));
