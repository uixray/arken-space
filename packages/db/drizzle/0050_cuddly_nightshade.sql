CREATE TABLE "account_campaign_creations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_campaign_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_campaign_invites_label_check" CHECK (length(trim("account_campaign_invites"."label")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "account_campaign_creations" ADD CONSTRAINT "account_campaign_creations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_campaign_creations" ADD CONSTRAINT "account_campaign_creations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_campaign_invites" ADD CONSTRAINT "account_campaign_invites_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_campaign_invites" ADD CONSTRAINT "account_campaign_invites_created_by_membership_id_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_campaign_invites" ADD CONSTRAINT "account_campaign_invites_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_campaign_creations_user_key_idx" ON "account_campaign_creations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "account_campaign_invites_token_hash_idx" ON "account_campaign_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_campaign_invites_campaign_idx" ON "account_campaign_invites" USING btree ("campaign_id","created_at");