ALTER TYPE "public"."asset_kind" ADD VALUE 'DICE_FRAME';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "poster_storage_key" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "poster_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "catalog_entries" ADD COLUMN "dice_frame_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "dice_frame_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_entries" ADD CONSTRAINT "catalog_entries_dice_frame_asset_id_assets_id_fk" FOREIGN KEY ("dice_frame_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_dice_frame_asset_id_assets_id_fk" FOREIGN KEY ("dice_frame_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_poster_storage_key_unique" UNIQUE("poster_storage_key");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_dice_frame_poster_check" CHECK (("assets"."kind"::text = 'DICE_FRAME') = ("assets"."poster_storage_key" IS NOT NULL AND "assets"."poster_size_bytes" IS NOT NULL));