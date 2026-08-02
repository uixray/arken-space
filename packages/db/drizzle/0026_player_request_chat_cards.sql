ALTER TABLE "chat_messages" ADD COLUMN "player_request_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "player_requests_campaign_id_idx" ON "player_requests" USING btree ("campaign_id", "id");
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_campaign_player_request_fk" FOREIGN KEY ("campaign_id", "player_request_id") REFERENCES "public"."player_requests"("campaign_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_player_request_idx" ON "chat_messages" USING btree ("player_request_id");
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_player_request_shape_check" CHECK ("player_request_id" IS NULL OR ("kind" = 'SYSTEM' AND "body" = '' AND "dice" IS NULL AND "system_data" IS NULL AND "sticker_id" IS NULL AND "sticker_presentation" IS NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_player_request_chat_thread() RETURNS trigger AS $$
BEGIN
  IF NEW.player_request_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.campaign_id = NEW.campaign_id AND t.id = NEW.thread_id AND t.type = 'STREAM' AND t.stream = 'TABLE') THEN RAISE EXCEPTION 'player request cards must use the TABLE stream'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER chat_messages_player_request_table_trigger BEFORE INSERT OR UPDATE OF player_request_id, campaign_id, thread_id ON chat_messages FOR EACH ROW EXECUTE FUNCTION enforce_player_request_chat_thread();
