CREATE TABLE "creation_rule_packs" (
 "id" uuid PRIMARY KEY, "campaign_id" uuid NOT NULL CONSTRAINT "creation_rule_packs_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE CASCADE,
 "kind" text NOT NULL, "name" text NOT NULL, "enabled" boolean NOT NULL DEFAULT false,
 "revision" integer NOT NULL DEFAULT 0, "created_by_membership_id" uuid NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "creation_rule_pack_shape" CHECK (kind IN ('SKILL','ARTIFACT') AND revision>=0 AND length(trim(name)) BETWEEN 1 AND 100),
 CONSTRAINT "creation_rule_pack_creator_fk" FOREIGN KEY (campaign_id,created_by_membership_id) REFERENCES memberships(campaign_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_rule_packs_campaign_id_unique" ON creation_rule_packs(campaign_id,id);
--> statement-breakpoint
CREATE TABLE "creation_rule_versions" (
 "id" uuid PRIMARY KEY, "campaign_id" uuid NOT NULL, "pack_id" uuid NOT NULL,
 "number" integer NOT NULL, "published" boolean NOT NULL, "source" jsonb NOT NULL,
 "source_hash" text NOT NULL, "created_by_membership_id" uuid NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "creation_rule_version_pack_fk" FOREIGN KEY(campaign_id,pack_id) REFERENCES creation_rule_packs(campaign_id,id) ON DELETE CASCADE,
 CONSTRAINT "creation_rule_version_creator_fk" FOREIGN KEY(campaign_id,created_by_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT "creation_rule_version_shape" CHECK(number>0 AND source_hash ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_rule_versions_campaign_id_unique" ON creation_rule_versions(campaign_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_rule_versions_number_unique" ON creation_rule_versions(campaign_id,pack_id,number);
--> statement-breakpoint
CREATE TABLE "creation_templates" (
 "id" uuid PRIMARY KEY, "campaign_id" uuid NOT NULL CONSTRAINT "creation_templates_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 "author_membership_id" uuid NOT NULL, "kind" text NOT NULL, "revision" integer NOT NULL DEFAULT 0,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "creation_template_author_fk" FOREIGN KEY(campaign_id,author_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT "creation_template_shape" CHECK(kind IN ('SKILL','ARTIFACT') AND revision>=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_templates_campaign_id_unique" ON creation_templates(campaign_id,id);
--> statement-breakpoint
CREATE INDEX "creation_templates_author_idx" ON creation_templates(campaign_id,author_membership_id,id);
--> statement-breakpoint
CREATE TABLE "creation_template_versions" (
 "id" uuid PRIMARY KEY, "campaign_id" uuid NOT NULL, "template_id" uuid NOT NULL, "number" integer NOT NULL,
 "previous_version_id" uuid CONSTRAINT "creation_template_versions_previous_version_id_creation_template_versions_id_fk" REFERENCES creation_template_versions(id), "rule_version_id" uuid NOT NULL,
 "design" jsonb NOT NULL, "evaluation" jsonb NOT NULL, "version_hash" text NOT NULL,
 "created_by_membership_id" uuid NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "creation_template_version_template_fk" FOREIGN KEY(campaign_id,template_id) REFERENCES creation_templates(campaign_id,id) ON DELETE CASCADE,
 CONSTRAINT "creation_template_version_rules_fk" FOREIGN KEY(campaign_id,rule_version_id) REFERENCES creation_rule_versions(campaign_id,id),
 CONSTRAINT "creation_template_version_creator_fk" FOREIGN KEY(campaign_id,created_by_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT "creation_template_version_shape" CHECK(number>0 AND version_hash ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_template_versions_campaign_id_unique" ON creation_template_versions(campaign_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_template_versions_number_unique" ON creation_template_versions(campaign_id,template_id,number);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_template_versions_lineage_unique" ON creation_template_versions(campaign_id,template_id,id);
--> statement-breakpoint
ALTER TABLE creation_template_versions ADD CONSTRAINT creation_template_parent_scope_fk
 FOREIGN KEY(campaign_id,template_id,previous_version_id) REFERENCES creation_template_versions(campaign_id,template_id,id);
--> statement-breakpoint
CREATE TABLE "creation_reviews" (
 "id" uuid PRIMARY KEY, "campaign_id" uuid NOT NULL, "version_id" uuid NOT NULL, "revision" integer NOT NULL,
 "decision" text NOT NULL, "reason" text NOT NULL, "decided_by_membership_id" uuid NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "creation_review_version_fk" FOREIGN KEY(campaign_id,version_id) REFERENCES creation_template_versions(campaign_id,id) ON DELETE CASCADE,
 CONSTRAINT "creation_review_actor_fk" FOREIGN KEY(campaign_id,decided_by_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT "creation_review_shape" CHECK(revision>=0 AND decision IN ('APPROVED','REJECTED','REVOKED') AND length(trim(reason)) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_reviews_revision_unique" ON creation_reviews(campaign_id,version_id,revision);
--> statement-breakpoint
CREATE TABLE "creation_actions" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "campaign_id" uuid NOT NULL CONSTRAINT "creation_actions_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 "action_id" uuid NOT NULL, "actor_membership_id" uuid NOT NULL, "type" text NOT NULL, "request_hash" text NOT NULL,
 "receipt" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "creation_action_actor_fk" FOREIGN KEY(campaign_id,actor_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT "creation_action_hash_shape" CHECK(request_hash ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_actions_action_unique" ON creation_actions(campaign_id,action_id);
--> statement-breakpoint
CREATE FUNCTION creation_immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'creation snapshots and review decisions are immutable' USING ERRCODE='23514'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER creation_rule_version_immutable BEFORE UPDATE ON creation_rule_versions FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
CREATE TRIGGER creation_template_version_immutable BEFORE UPDATE ON creation_template_versions FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
CREATE TRIGGER creation_review_immutable BEFORE UPDATE ON creation_reviews FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
CREATE TRIGGER creation_action_immutable BEFORE UPDATE ON creation_actions FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
