CREATE TYPE "public"."chat_thread_type" AS ENUM('STREAM');
--> statement-breakpoint
CREATE TYPE "public"."chat_stream" AS ENUM('ROLLS', 'STORY', 'TABLE');
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"type" "chat_thread_type" DEFAULT 'STREAM' NOT NULL,
	"stream" "chat_stream" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_campaign_stream_idx" ON "chat_threads" USING btree ("campaign_id","stream");
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_campaign_id_id_idx" ON "chat_threads" USING btree ("campaign_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_campaign_id_id_idx" ON "memberships" USING btree ("campaign_id","id");
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION "create_fixed_chat_streams"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "chat_threads" ("campaign_id", "stream") VALUES
    (NEW."id", 'ROLLS'), (NEW."id", 'STORY'), (NEW."id", 'TABLE')
  ON CONFLICT ("campaign_id", "stream") DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "campaigns_create_fixed_chat_streams" AFTER INSERT ON "campaigns" FOR EACH ROW EXECUTE FUNCTION "create_fixed_chat_streams"();
--> statement-breakpoint
INSERT INTO "chat_threads" ("campaign_id", "stream") SELECT "id", stream FROM "campaigns" CROSS JOIN (VALUES ('ROLLS'::"chat_stream"), ('STORY'::"chat_stream"), ('TABLE'::"chat_stream")) AS fixed_streams(stream) ON CONFLICT ("campaign_id", "stream") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "thread_id" uuid;
--> statement-breakpoint
UPDATE "chat_messages" AS message SET "thread_id" = thread."id" FROM "chat_threads" AS thread WHERE thread."campaign_id" = message."campaign_id" AND thread."stream" = CASE WHEN message."kind" = 'DICE' THEN 'ROLLS'::"chat_stream" ELSE 'TABLE'::"chat_stream" END;
--> statement-breakpoint
CREATE FUNCTION "resolve_legacy_chat_message_thread"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."thread_id" IS NULL THEN
    SELECT "id" INTO NEW."thread_id" FROM "chat_threads"
    WHERE "campaign_id" = NEW."campaign_id"
      AND "stream" = CASE WHEN NEW."kind" = 'DICE' THEN 'ROLLS'::"chat_stream" ELSE 'TABLE'::"chat_stream" END;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "chat_messages_resolve_legacy_thread" BEFORE INSERT ON "chat_messages" FOR EACH ROW EXECUTE FUNCTION "resolve_legacy_chat_message_thread"();
--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "thread_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_campaign_thread_fk" FOREIGN KEY ("campaign_id","thread_id") REFERENCES "public"."chat_threads"("campaign_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "chat_messages_thread_sequence_idx" ON "chat_messages" USING btree ("thread_id","sequence");
--> statement-breakpoint
CREATE TABLE "chat_read_cursors" (
	"campaign_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"last_read_sequence" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_read_cursors_membership_thread_idx" ON "chat_read_cursors" USING btree ("membership_id","thread_id");
--> statement-breakpoint
ALTER TABLE "chat_read_cursors" ADD CONSTRAINT "chat_read_cursors_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_read_cursors" ADD CONSTRAINT "chat_read_cursors_campaign_membership_fk" FOREIGN KEY ("campaign_id","membership_id") REFERENCES "public"."memberships"("campaign_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_read_cursors" ADD CONSTRAINT "chat_read_cursors_campaign_thread_fk" FOREIGN KEY ("campaign_id","thread_id") REFERENCES "public"."chat_threads"("campaign_id","id") ON DELETE cascade ON UPDATE no action;
