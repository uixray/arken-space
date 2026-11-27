ALTER TABLE cloud_sync_grants ADD COLUMN grant_scope text NOT NULL DEFAULT 'STAGING_ONLY';
--> statement-breakpoint
ALTER TABLE cloud_sync_grants ADD CONSTRAINT cloud_sync_grants_scope_check CHECK(grant_scope IN ('STAGING_ONLY','READ_RECEIPTS_ONLY'));
--> statement-breakpoint
CREATE INDEX local_cloud_stored_batches_sequence_idx ON local_cloud_stored_batches(stream_id,last_sequence,receipt_id);
--> statement-breakpoint
CREATE INDEX local_cloud_streams_history_idx ON local_cloud_streams(campaign_id,origin_host_id,session_id,epoch,id);
