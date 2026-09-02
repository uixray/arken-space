CREATE TYPE "public"."spell_assignment_kind" AS ENUM('SCHOOL', 'NODE');--> statement-breakpoint
CREATE TABLE "character_spell_assignment_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"pack_version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" "spell_assignment_kind" NOT NULL,
	"school_id" uuid NOT NULL,
	"node_id" uuid,
	"rank" integer,
	"snapshot" jsonb NOT NULL,
	"override_reason" text,
	"assigned_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_spell_assignment_versions_shape_check" CHECK ("character_spell_assignment_versions"."version" > 0 AND (
        ("character_spell_assignment_versions"."kind" = 'SCHOOL' AND "character_spell_assignment_versions"."node_id" IS NULL AND "character_spell_assignment_versions"."rank" IS NULL)
        OR
        ("character_spell_assignment_versions"."kind" = 'NODE' AND "character_spell_assignment_versions"."node_id" IS NOT NULL AND "character_spell_assignment_versions"."rank" > 0)
      )),
	CONSTRAINT "character_spell_assignment_versions_override_reason_check" CHECK ("character_spell_assignment_versions"."override_reason" IS NULL OR length(trim("character_spell_assignment_versions"."override_reason")) BETWEEN 1 AND 2000),
	CONSTRAINT "character_spell_assignment_versions_snapshot_shape_check" CHECK ((
        jsonb_typeof("character_spell_assignment_versions"."snapshot") = 'object'
        AND "character_spell_assignment_versions"."snapshot" @> jsonb_build_object(
          'schemaVersion', 1,
          'assignmentId', "character_spell_assignment_versions"."assignment_id"::text,
          'assignmentVersionId', "character_spell_assignment_versions"."id"::text,
          'assignmentVersion', "character_spell_assignment_versions"."version",
          'packId', "character_spell_assignment_versions"."pack_id"::text,
          'packVersionId', "character_spell_assignment_versions"."pack_version_id"::text,
          'packLifecycle', 'ACTIVE',
          'kind', "character_spell_assignment_versions"."kind"::text,
          'schoolId', "character_spell_assignment_versions"."school_id"::text,
          'nodeId', "character_spell_assignment_versions"."node_id"::text,
          'rank', "character_spell_assignment_versions"."rank"
        )
        AND jsonb_typeof("character_spell_assignment_versions"."snapshot"->'provenance') = 'object'
        AND jsonb_typeof("character_spell_assignment_versions"."snapshot"->'school') = 'object'
      ) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "character_spell_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "character_spell_assignments_campaign_id_id_idx" ON "character_spell_assignments" USING btree ("campaign_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_spell_assignments_scope_id_idx" ON "character_spell_assignments" USING btree ("campaign_id","character_id","pack_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "spell_pack_versions_campaign_pack_id_idx" ON "spell_pack_versions" USING btree ("campaign_id","pack_id","id");--> statement-breakpoint
ALTER TABLE "character_spell_assignment_versions" ADD CONSTRAINT "character_spell_assignment_versions_parent_fk" FOREIGN KEY ("campaign_id","character_id","pack_id","assignment_id") REFERENCES "public"."character_spell_assignments"("campaign_id","character_id","pack_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_spell_assignment_versions" ADD CONSTRAINT "character_spell_assignment_versions_pack_version_fk" FOREIGN KEY ("campaign_id","pack_id","pack_version_id") REFERENCES "public"."spell_pack_versions"("campaign_id","pack_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Deferred NO ACTION preserves the audit actor on individual membership deletes,
-- while allowing the campaign's assignment and membership cascades to finish
-- within the same statement before PostgreSQL checks the relationship.
ALTER TABLE "character_spell_assignment_versions" ADD CONSTRAINT "character_spell_assignment_versions_actor_fk" FOREIGN KEY ("campaign_id","assigned_by_membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "character_spell_assignments" ADD CONSTRAINT "character_spell_assignments_campaign_character_fk" FOREIGN KEY ("campaign_id","character_id") REFERENCES "public"."characters"("campaign_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_spell_assignments" ADD CONSTRAINT "character_spell_assignments_campaign_pack_fk" FOREIGN KEY ("campaign_id","pack_id") REFERENCES "public"."spell_packs"("campaign_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_spell_assignment_versions_campaign_id_id_idx" ON "character_spell_assignment_versions" USING btree ("campaign_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_spell_assignment_versions_sequence_idx" ON "character_spell_assignment_versions" USING btree ("campaign_id","assignment_id","version");--> statement-breakpoint
CREATE INDEX "character_spell_assignment_versions_character_idx" ON "character_spell_assignment_versions" USING btree ("campaign_id","character_id","created_at");--> statement-breakpoint
CREATE INDEX "character_spell_assignments_character_idx" ON "character_spell_assignments" USING btree ("campaign_id","character_id");--> statement-breakpoint
CREATE FUNCTION preserve_character_spell_assignment_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'character spell assignment identity is immutable';
  RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER character_spell_assignments_immutable
BEFORE UPDATE ON character_spell_assignments
FOR EACH ROW
EXECUTE FUNCTION preserve_character_spell_assignment_identity();--> statement-breakpoint
CREATE FUNCTION preserve_character_spell_assignment_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     OR EXISTS (
       SELECT 1
       FROM character_spell_assignments assignment
       WHERE assignment.campaign_id = OLD.campaign_id
         AND assignment.id = OLD.assignment_id
     )
  THEN
    RAISE EXCEPTION 'character spell assignment history is immutable';
  END IF;

  RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER character_spell_assignment_versions_immutable
BEFORE UPDATE OR DELETE ON character_spell_assignment_versions
FOR EACH ROW
EXECUTE FUNCTION preserve_character_spell_assignment_history();
