CREATE TABLE campaign_transfer_exports (
 manifest_sha256 text PRIMARY KEY,campaign_id uuid NOT NULL,owner_user_id uuid NOT NULL,owner_membership_id uuid NOT NULL,baseline_sequence bigint NOT NULL,schema_digest text NOT NULL,snapshot_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT campaign_transfer_exports_bounds CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$' AND schema_digest ~ '^[a-f0-9]{64}$' AND snapshot_digest ~ '^[a-f0-9]{64}$' AND baseline_sequence>=0)
);
--> statement-breakpoint
ALTER TABLE local_campaign_imports ADD COLUMN source_baseline_sequence bigint, ADD COLUMN source_schema_digest text;
--> statement-breakpoint
ALTER TABLE cloud_sync_origins ADD COLUMN transfer_manifest_sha256 text;
