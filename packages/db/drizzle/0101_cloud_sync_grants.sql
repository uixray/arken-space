CREATE TABLE "cloud_sync_grants" (
	"origin_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_sync_grants_hash_check" CHECK (length("cloud_sync_grants"."token_hash")=64)
);
--> statement-breakpoint
ALTER TABLE "cloud_sync_grants" ADD CONSTRAINT "cloud_sync_grants_origin_id_cloud_sync_origins_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."cloud_sync_origins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_sync_grants_token_idx" ON "cloud_sync_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_sync_grants_id_idx" ON "cloud_sync_grants" USING btree ("id");