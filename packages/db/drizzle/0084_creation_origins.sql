CREATE TABLE creation_template_origins (
 template_id uuid PRIMARY KEY, campaign_id uuid NOT NULL, source_version_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_origin_template_fk FOREIGN KEY(campaign_id,template_id) REFERENCES creation_templates(campaign_id,id) ON DELETE CASCADE,
 CONSTRAINT creation_origin_source_fk FOREIGN KEY(campaign_id,source_version_id) REFERENCES creation_template_versions(campaign_id,id)
);
--> statement-breakpoint
CREATE TRIGGER creation_origin_immutable BEFORE UPDATE ON creation_template_origins FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
