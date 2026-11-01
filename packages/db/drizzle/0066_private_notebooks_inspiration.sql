CREATE TABLE "character_private_notebooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL CONSTRAINT "character_private_notebooks_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "character_id" uuid NOT NULL,
  "author_membership_id" uuid NOT NULL,
  "text" text NOT NULL DEFAULT '',
  "revision" integer NOT NULL DEFAULT 0,
  "last_action_id" uuid,
  "last_command_hash" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "private_notebook_character_fk" FOREIGN KEY ("campaign_id","character_id") REFERENCES "characters"("campaign_id","id") ON DELETE CASCADE,
  CONSTRAINT "private_notebook_author_fk" FOREIGN KEY ("campaign_id","author_membership_id") REFERENCES "memberships"("campaign_id","id") ON DELETE CASCADE,
  CONSTRAINT "private_notebook_content_check" CHECK (length("text") <= 20000 AND "revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "private_notebook_author_character_unique" ON "character_private_notebooks" ("campaign_id","character_id","author_membership_id");
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "inspiration_source_message_id" uuid CONSTRAINT "chat_messages_inspiration_source_message_id_chat_messages_id_fk" REFERENCES "chat_messages"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_inspiration_source_unique" ON "chat_messages" ("inspiration_source_message_id");
--> statement-breakpoint
UPDATE "characters" SET "resources" = "resources" || '{"inspiration":{"current":0,"maximum":1}}'::jsonb WHERE NOT ("resources" ? 'inspiration');
