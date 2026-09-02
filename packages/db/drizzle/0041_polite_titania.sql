CREATE TYPE "public"."spell_pack_lifecycle" AS ENUM('DRAFT', 'REFERENCE', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "spell_pack_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"lifecycle" "spell_pack_lifecycle" NOT NULL,
	"graph" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spell_pack_versions_positive_version_check" CHECK ("spell_pack_versions"."version" > 0),
	CONSTRAINT "spell_pack_versions_graph_shape_check" CHECK ((
        jsonb_typeof("spell_pack_versions"."graph") = 'object'
        AND "spell_pack_versions"."graph" @> jsonb_build_object(
          'packId', "spell_pack_versions"."pack_id"::text,
          'versionId', "spell_pack_versions"."id"::text,
          'version', "spell_pack_versions"."version",
          'lifecycle', "spell_pack_versions"."lifecycle"::text
        )
        AND jsonb_typeof("spell_pack_versions"."graph"->'provenance') = 'object'
      ) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "spell_packs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "spell_packs_campaign_id_id_idx" ON "spell_packs" USING btree ("campaign_id","id");--> statement-breakpoint
ALTER TABLE "spell_pack_versions" ADD CONSTRAINT "spell_pack_versions_campaign_pack_fk" FOREIGN KEY ("campaign_id","pack_id") REFERENCES "public"."spell_packs"("campaign_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spell_packs" ADD CONSTRAINT "spell_packs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spell_pack_versions_campaign_id_id_idx" ON "spell_pack_versions" USING btree ("campaign_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "spell_pack_versions_campaign_pack_version_idx" ON "spell_pack_versions" USING btree ("campaign_id","pack_id","version");--> statement-breakpoint
CREATE INDEX "spell_pack_versions_campaign_pack_created_idx" ON "spell_pack_versions" USING btree ("campaign_id","pack_id","created_at");--> statement-breakpoint
CREATE FUNCTION preserve_spell_pack_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'spell pack identity is immutable';
  RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER spell_packs_immutable
BEFORE UPDATE ON spell_packs
FOR EACH ROW
EXECUTE FUNCTION preserve_spell_pack_identity();--> statement-breakpoint
CREATE FUNCTION preserve_spell_pack_version_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     OR EXISTS (
       SELECT 1
       FROM spell_packs pack
       WHERE pack.campaign_id = OLD.campaign_id
         AND pack.id = OLD.pack_id
     )
  THEN
    RAISE EXCEPTION 'spell pack version history is immutable';
  END IF;

  RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER spell_pack_versions_immutable
BEFORE UPDATE OR DELETE ON spell_pack_versions
FOR EACH ROW
EXECUTE FUNCTION preserve_spell_pack_version_history();
