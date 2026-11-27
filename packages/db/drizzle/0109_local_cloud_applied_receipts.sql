ALTER TABLE local_cloud_stored_batches ADD COLUMN batch_metadata jsonb, ADD COLUMN applied_receipt jsonb;
--> statement-breakpoint
ALTER TABLE local_cloud_streams ADD COLUMN applied_sequence bigint;
