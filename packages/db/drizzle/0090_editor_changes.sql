CREATE TABLE "editor_changes" (
  "id" uuid PRIMARY KEY,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "draft" jsonb NOT NULL,
  "receipt" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_at" timestamptz,
  CONSTRAINT "editor_changes_receipt_check" CHECK (
    ("receipt" IS NULL) = ("confirmed_at" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "editor_changes_history_idx" ON "editor_changes" (
  "campaign_id", ("draft" #>> '{target,kind}'), ("draft" #>> '{target,id}'),
  "confirmed_at" DESC, "id" DESC
) WHERE "confirmed_at" IS NOT NULL;
