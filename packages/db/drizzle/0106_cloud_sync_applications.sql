ALTER TABLE cloud_sync_origins ADD COLUMN applied_sequence bigint, ADD COLUMN applied_cloud_sequence bigint, ADD COLUMN closed_at timestamptz;
--> statement-breakpoint
ALTER TABLE cloud_sync_receipts ADD COLUMN batch_metadata jsonb;
--> statement-breakpoint
CREATE TABLE cloud_sync_applications (
 receipt_id uuid PRIMARY KEY CONSTRAINT cloud_sync_applications_receipt_id_cloud_sync_receipts_id_fk REFERENCES cloud_sync_receipts(id),
 origin_id uuid NOT NULL CONSTRAINT cloud_sync_applications_origin_id_cloud_sync_origins_id_fk REFERENCES cloud_sync_origins(id),
 writer_revision bigint NOT NULL CONSTRAINT cloud_sync_applications_revision_check CHECK(writer_revision>0),
 mappings jsonb NOT NULL CONSTRAINT cloud_sync_applications_mapping_check CHECK(jsonb_typeof(mappings)='array' AND jsonb_array_length(mappings) BETWEEN 1 AND 64),
 applied_at timestamptz NOT NULL DEFAULT now()
);
