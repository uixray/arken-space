CREATE TABLE "editor_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"receipt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "editor_changes_receipt_check" CHECK (("editor_changes"."receipt" IS NULL) = ("editor_changes"."confirmed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "editor_changes" ADD CONSTRAINT "editor_changes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editor_changes_history_idx" ON "editor_changes" USING btree ("campaign_id",("draft" #>> '{target,kind}'),("draft" #>> '{target,id}'),"confirmed_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "editor_changes"."confirmed_at" IS NOT NULL;