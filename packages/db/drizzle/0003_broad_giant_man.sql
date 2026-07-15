CREATE TYPE "public"."catalog_entry_kind" AS ENUM('SKILL', 'ABILITY');--> statement-breakpoint
CREATE TYPE "public"."token_layer" AS ENUM('MAP', 'GM', 'PLAYERS');--> statement-breakpoint
CREATE TABLE "catalog_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" "catalog_entry_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_catalog_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"source_catalog_entry_id" uuid,
	"kind" "catalog_entry_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_controllers" (
	"token_definition_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"character_id" uuid,
	"default_asset_id" uuid,
	"name" text NOT NULL,
	"default_width" double precision DEFAULT 64 NOT NULL,
	"default_height" double precision DEFAULT 64 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION "ensure_token_definition"() RETURNS trigger AS $$
DECLARE campaign uuid;
BEGIN
  IF NEW.definition_id IS NULL THEN
    SELECT campaign_id INTO campaign FROM scenes WHERE id = NEW.scene_id;
    NEW.definition_id := gen_random_uuid();
    INSERT INTO token_definitions (id, campaign_id, character_id, default_asset_id, name, default_width, default_height)
    VALUES (NEW.definition_id, campaign, NEW.character_id, NEW.asset_id, NEW.name, NEW.width, NEW.height);
    IF NEW.owner_membership_id IS NOT NULL THEN
      INSERT INTO token_controllers (token_definition_id, membership_id) VALUES (NEW.definition_id, NEW.owner_membership_id) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "tokens_ensure_definition" BEFORE INSERT ON "tokens" FOR EACH ROW EXECUTE FUNCTION "ensure_token_definition"();--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "backstory" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "inventory" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "resources" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "characters" SET "stats" = jsonb_build_object(
  'strength', COALESCE(("stats"->>'strength')::numeric, ("stats"->>'might')::numeric, 0),
  'agility', COALESCE(("stats"->>'agility')::numeric, 0),
  'endurance', COALESCE(("stats"->>'endurance')::numeric, 0),
  'vitality', COALESCE(("stats"->>'vitality')::numeric, 0),
  'knowledge', COALESCE(("stats"->>'knowledge')::numeric, 0),
  'intelligence', COALESCE(("stats"->>'intelligence')::numeric, ("stats"->>'mind')::numeric, 0),
  'willpower', COALESCE(("stats"->>'willpower')::numeric, ("stats"->>'spirit')::numeric, 0),
  'charisma', COALESCE(("stats"->>'charisma')::numeric, ("stats"->>'presence')::numeric, 0)
);--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "definition_id" uuid;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "layer" "token_layer" DEFAULT 'PLAYERS' NOT NULL;--> statement-breakpoint
INSERT INTO "token_definitions" ("id", "campaign_id", "character_id", "default_asset_id", "name", "default_width", "default_height")
SELECT t."id", s."campaign_id", t."character_id", t."asset_id", t."name", t."width", t."height"
FROM "tokens" t JOIN "scenes" s ON s."id" = t."scene_id";--> statement-breakpoint
UPDATE "tokens" SET "definition_id" = "id";--> statement-breakpoint
INSERT INTO "token_controllers" ("token_definition_id", "membership_id")
SELECT "definition_id", "owner_membership_id" FROM "tokens" WHERE "owner_membership_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "character_catalog_entries" ("character_id", "kind", "name", "description", "data")
SELECT c."id", 'SKILL', item->>'name', '', item - 'name'
FROM "characters" c CROSS JOIN LATERAL jsonb_array_elements(c."skills") item;--> statement-breakpoint
INSERT INTO "character_catalog_entries" ("character_id", "kind", "name", "description", "data")
SELECT c."id", 'ABILITY', item->>'name', COALESCE(item->>'description', ''), item - 'name' - 'description'
FROM "characters" c CROSS JOIN LATERAL jsonb_array_elements(c."spells") item;--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "definition_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_entries" ADD CONSTRAINT "catalog_entries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_catalog_entries" ADD CONSTRAINT "character_catalog_entries_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_catalog_entries" ADD CONSTRAINT "character_catalog_entries_source_catalog_entry_id_catalog_entries_id_fk" FOREIGN KEY ("source_catalog_entry_id") REFERENCES "public"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_controllers" ADD CONSTRAINT "token_controllers_token_definition_id_token_definitions_id_fk" FOREIGN KEY ("token_definition_id") REFERENCES "public"."token_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_controllers" ADD CONSTRAINT "token_controllers_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_definitions" ADD CONSTRAINT "token_definitions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_definitions" ADD CONSTRAINT "token_definitions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_definitions" ADD CONSTRAINT "token_definitions_default_asset_id_assets_id_fk" FOREIGN KEY ("default_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_entries_campaign_idx" ON "catalog_entries" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "character_catalog_character_idx" ON "character_catalog_entries" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "token_controllers_definition_member_idx" ON "token_controllers" USING btree ("token_definition_id","membership_id");--> statement-breakpoint
CREATE INDEX "token_definitions_campaign_idx" ON "token_definitions" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_definition_id_token_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."token_definitions"("id") ON DELETE cascade ON UPDATE no action;
