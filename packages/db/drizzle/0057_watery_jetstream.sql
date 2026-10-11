-- Clear only dangling legacy UUID pointers before enforcing asset lifetimes.
UPDATE "world_content" AS wc SET "cover_asset_id" = NULL
WHERE wc."cover_asset_id" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "assets" AS a WHERE a."id" = wc."cover_asset_id");--> statement-breakpoint
UPDATE "world_content_instances" AS wi SET "portrait_asset_id" = NULL
WHERE wi."portrait_asset_id" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "assets" AS a WHERE a."id" = wi."portrait_asset_id");--> statement-breakpoint
DELETE FROM "world_content_media" AS wcm WHERE NOT EXISTS
  (SELECT 1 FROM "assets" AS a WHERE a."id" = wcm."asset_id");--> statement-breakpoint
ALTER TABLE "world_content" ADD CONSTRAINT "world_content_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_content_instances" ADD CONSTRAINT "world_content_instances_portrait_asset_id_assets_id_fk" FOREIGN KEY ("portrait_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_content_media" ADD CONSTRAINT "world_content_media_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_content_media_asset_idx" ON "world_content_media" USING btree ("asset_id");
