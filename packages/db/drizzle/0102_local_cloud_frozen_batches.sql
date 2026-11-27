CREATE TABLE "local_cloud_stored_batches" (
	"stream_id" uuid NOT NULL,
	"batch_hash" text NOT NULL,
	"receipt_id" uuid NOT NULL,
	"last_sequence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_cloud_stored_batches_pkey" PRIMARY KEY("stream_id","batch_hash"),
	CONSTRAINT "local_cloud_stored_batches_bounds" CHECK (length("local_cloud_stored_batches"."batch_hash")=64 AND "local_cloud_stored_batches"."last_sequence">0)
);
--> statement-breakpoint
CREATE TABLE "local_cloud_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_origin" text NOT NULL,
	"cloud_origin_id" uuid NOT NULL,
	"origin_host_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"stored_sequence" bigint,
	"frozen_batch" jsonb,
	"frozen_hash" text,
	CONSTRAINT "local_cloud_streams_bounds" CHECK ("local_cloud_streams"."epoch">0 AND ("local_cloud_streams"."stored_sequence" IS NULL OR "local_cloud_streams"."stored_sequence">0)),
	CONSTRAINT "local_cloud_streams_frozen_check" CHECK (("local_cloud_streams"."frozen_batch" IS NULL AND "local_cloud_streams"."frozen_hash" IS NULL) OR ("local_cloud_streams"."frozen_batch" IS NOT NULL AND jsonb_typeof("local_cloud_streams"."frozen_batch")='object' AND length("local_cloud_streams"."frozen_hash")=64 AND "local_cloud_streams"."frozen_hash" IS NOT NULL AND octet_length("local_cloud_streams"."frozen_batch"::text)<=2097152))
);
--> statement-breakpoint
ALTER TABLE "local_cloud_stored_batches" ADD CONSTRAINT "local_cloud_stored_batches_stream_id_local_cloud_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."local_cloud_streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "local_cloud_stored_batches_receipt_idx" ON "local_cloud_stored_batches" USING btree ("stream_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_cloud_streams_remote_idx" ON "local_cloud_streams" USING btree ("target_origin","cloud_origin_id");