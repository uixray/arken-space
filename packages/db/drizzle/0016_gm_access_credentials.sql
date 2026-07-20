CREATE TABLE "gm_access_credentials" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gm_access_credentials" ADD CONSTRAINT "gm_access_credentials_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
