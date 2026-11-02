ALTER TABLE "world_content" ADD COLUMN "base_price_copper" bigint;
--> statement-breakpoint
ALTER TABLE "world_content" ADD CONSTRAINT "world_content_base_price_check" CHECK ("base_price_copper" IS NULL OR ("type" = 'ITEM' AND "base_price_copper" BETWEEN 0 AND 1000000000000));
--> statement-breakpoint
CREATE TABLE "campaign_economies" (
  "campaign_id" uuid PRIMARY KEY CONSTRAINT "campaign_economies_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "config" jsonb NOT NULL, "revision" integer NOT NULL DEFAULT 0,
  CONSTRAINT "campaign_economies_revision_check" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "economy_merchants" (
  "id" uuid PRIMARY KEY, "campaign_id" uuid NOT NULL CONSTRAINT "economy_merchants_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "name" text NOT NULL, "region_id" uuid NOT NULL CONSTRAINT "economy_merchants_region_id_world_content_id_fk" REFERENCES "world_content"("id"),
  "visible" boolean NOT NULL DEFAULT false, "percent" integer NOT NULL, "revision" integer NOT NULL DEFAULT 0,
  CONSTRAINT "economy_merchants_shape_check" CHECK (length(trim("name")) BETWEEN 1 AND 100 AND "percent" BETWEEN 0 AND 10000 AND "revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "economy_merchants_campaign_id_unique" ON "economy_merchants" ("campaign_id", "id");
--> statement-breakpoint
CREATE TABLE "economy_offers" (
  "id" uuid PRIMARY KEY, "campaign_id" uuid NOT NULL CONSTRAINT "economy_offers_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "merchant_id" uuid NOT NULL, "instance_id" uuid NOT NULL, "visible" boolean NOT NULL DEFAULT false,
  "supply_percent" integer NOT NULL, "gm_percent" integer NOT NULL, "override_copper" bigint,
  "reason" text NOT NULL DEFAULT '', "revision" integer NOT NULL DEFAULT 0,
  CONSTRAINT "economy_offers_merchant_fk" FOREIGN KEY ("campaign_id", "merchant_id") REFERENCES "economy_merchants"("campaign_id", "id"),
  CONSTRAINT "economy_offers_instance_fk" FOREIGN KEY ("campaign_id", "instance_id") REFERENCES "world_content_instances"("campaign_id", "id") ON DELETE CASCADE,
  CONSTRAINT "economy_offers_shape_check" CHECK ("revision" >= 0 AND "supply_percent" BETWEEN 0 AND 10000 AND "gm_percent" BETWEEN 0 AND 10000 AND ("override_copper" IS NULL OR "override_copper" BETWEEN 0 AND 1000000000000) AND length("reason") <= 500 AND (("override_copper" IS NULL AND "gm_percent" = 100) OR length(trim("reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "economy_offers_instance_unique" ON "economy_offers" ("campaign_id", "instance_id");
--> statement-breakpoint
CREATE TABLE "economy_quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "campaign_id" uuid NOT NULL CONSTRAINT "economy_quotes_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "actor_membership_id" uuid NOT NULL, "character_id" uuid NOT NULL, "offer_id" uuid NOT NULL,
  "input_hash" text NOT NULL, "inputs" jsonb NOT NULL, "view" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "economy_quotes_campaign_actor_idx" ON "economy_quotes" ("campaign_id", "actor_membership_id", "created_at");
--> statement-breakpoint
CREATE TABLE "economy_purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "campaign_id" uuid NOT NULL CONSTRAINT "economy_purchases_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "action_id" uuid NOT NULL, "actor_membership_id" uuid NOT NULL, "quote_id" uuid NOT NULL CONSTRAINT "economy_purchases_quote_id_economy_quotes_id_fk" REFERENCES "economy_quotes"("id"),
  "receipt" jsonb NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "economy_purchases_action_unique" ON "economy_purchases" ("campaign_id", "action_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "economy_purchases_quote_unique" ON "economy_purchases" ("quote_id");
--> statement-breakpoint
CREATE INDEX "economy_purchases_history_idx" ON "economy_purchases" ("campaign_id", "created_at", "id");
