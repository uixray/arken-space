CREATE TYPE "public"."audio_purpose" AS ENUM ('MUSIC', 'SOUND_EFFECT', 'BOTH');--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "audio_purpose" "audio_purpose";--> statement-breakpoint
UPDATE "assets" AS asset
SET "audio_purpose" = CASE
  WHEN asset."kind" <> 'AUDIO' THEN NULL
  WHEN EXISTS (
    SELECT 1 FROM "campaign_sounds" AS sound
    WHERE sound."campaign_id" = asset."campaign_id" AND sound."asset_id" = asset."id"
  ) AND EXISTS (
    SELECT 1 FROM "campaign_audio_tracks" AS track
    WHERE track."campaign_id" = asset."campaign_id" AND track."asset_id" = asset."id"
  ) THEN 'BOTH'::"audio_purpose"
  WHEN EXISTS (
    SELECT 1 FROM "campaign_sounds" AS sound
    WHERE sound."campaign_id" = asset."campaign_id" AND sound."asset_id" = asset."id"
  ) THEN 'SOUND_EFFECT'::"audio_purpose"
  ELSE 'MUSIC'::"audio_purpose"
END;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_audio_purpose_kind_check" CHECK (("kind" = 'AUDIO' AND "audio_purpose" IS NOT NULL) OR ("kind" <> 'AUDIO' AND "audio_purpose" IS NULL));
