CREATE TABLE "player_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_access_grants" ADD CONSTRAINT "player_access_grants_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_access_grants" ADD CONSTRAINT "player_access_grants_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_access_grants_token_hash_idx" ON "player_access_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "player_access_grants_membership_idx" ON "player_access_grants" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "player_access_grants_campaign_idx" ON "player_access_grants" USING btree ("campaign_id");