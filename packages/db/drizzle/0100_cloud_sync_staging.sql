CREATE TABLE "cloud_sync_inbox" (
	"origin_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"action_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"envelope" jsonb NOT NULL,
	CONSTRAINT "cloud_sync_inbox_pkey" PRIMARY KEY("origin_id","sequence"),
	CONSTRAINT "cloud_sync_inbox_bounds" CHECK ("cloud_sync_inbox"."sequence">0 AND jsonb_typeof("cloud_sync_inbox"."envelope")='object')
);
--> statement-breakpoint
CREATE TABLE "cloud_sync_origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"baseline_sequence" bigint NOT NULL,
	"received_sequence" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_sync_origins_bounds" CHECK ("cloud_sync_origins"."epoch">0 AND "cloud_sync_origins"."baseline_sequence">=0 AND ("cloud_sync_origins"."received_sequence" IS NULL OR "cloud_sync_origins"."received_sequence">0))
);
--> statement-breakpoint
CREATE TABLE "cloud_sync_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_id" uuid NOT NULL,
	"batch_hash" text NOT NULL,
	"last_sequence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_sync_receipts_bounds" CHECK (length("cloud_sync_receipts"."batch_hash")=64 AND "cloud_sync_receipts"."last_sequence">0)
);
--> statement-breakpoint
ALTER TABLE "cloud_sync_inbox" ADD CONSTRAINT "cloud_sync_inbox_origin_id_cloud_sync_origins_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."cloud_sync_origins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_sync_inbox" ADD CONSTRAINT "cloud_sync_inbox_receipt_id_cloud_sync_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."cloud_sync_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_sync_origins" ADD CONSTRAINT "cloud_sync_origins_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_sync_receipts" ADD CONSTRAINT "cloud_sync_receipts_origin_id_cloud_sync_origins_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."cloud_sync_origins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_sync_inbox_action_idx" ON "cloud_sync_inbox" USING btree ("origin_id","action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_sync_origins_identity_idx" ON "cloud_sync_origins" USING btree ("campaign_id","host_id","session_id","epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_sync_receipts_batch_idx" ON "cloud_sync_receipts" USING btree ("origin_id","batch_hash");