ALTER TABLE "creation_operation_quotes" ADD COLUMN "transfer_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creation_store_quotes" ADD COLUMN "transfer_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "economy_quotes" ADD COLUMN "transfer_invalidated" boolean DEFAULT false NOT NULL;