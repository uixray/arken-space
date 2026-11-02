ALTER TABLE "world_content" ADD COLUMN "region_id" uuid;
--> statement-breakpoint
ALTER TABLE "world_content" ADD COLUMN "era" text;
--> statement-breakpoint
ALTER TABLE "world_content" ADD CONSTRAINT "world_content_region_id_world_content_id_fk" FOREIGN KEY ("region_id") REFERENCES "world_content"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "world_content" ADD CONSTRAINT "world_content_region_self_check" CHECK ("region_id" IS NULL OR "region_id" <> "id");
--> statement-breakpoint
ALTER TABLE "world_content" ADD CONSTRAINT "world_content_era_check" CHECK ("era" IS NULL OR length(trim("era")) BETWEEN 1 AND 80);
--> statement-breakpoint
CREATE INDEX "world_content_region_idx" ON "world_content" ("region_id");
--> statement-breakpoint
CREATE INDEX "world_content_era_idx" ON "world_content" ("era");
