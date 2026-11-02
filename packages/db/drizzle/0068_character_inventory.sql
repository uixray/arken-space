ALTER TABLE "world_content_instances" ADD COLUMN "inventory_character_id" uuid;
--> statement-breakpoint
ALTER TABLE "world_content_instances" ADD CONSTRAINT "world_instances_inventory_character_fk" FOREIGN KEY ("campaign_id", "inventory_character_id") REFERENCES "characters" ("campaign_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "world_content_instances" ADD CONSTRAINT "world_instances_inventory_quantity_check" CHECK ("inventory_character_id" IS NULL OR ("quantity" IS NOT NULL AND "quantity" > 0));
--> statement-breakpoint
CREATE INDEX "world_instances_inventory_character_idx" ON "world_content_instances" ("campaign_id", "inventory_character_id");
