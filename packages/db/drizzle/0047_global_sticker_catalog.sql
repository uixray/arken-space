CREATE TABLE "global_sticker_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"creator_membership_id" uuid,
	"create_action_id" text NOT NULL,
	"lifecycle" "sticker_pack_lifecycle" DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"deprecated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "global_sticker_packs_creator_fk" FOREIGN KEY ("creator_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX "global_sticker_packs_lifecycle_idx" ON "global_sticker_packs" USING btree ("lifecycle");
--> statement-breakpoint
CREATE UNIQUE INDEX "global_sticker_packs_creator_action_idx" ON "global_sticker_packs" USING btree ("creator_membership_id","create_action_id");
--> statement-breakpoint
CREATE TABLE "global_sticker_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by_membership_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "global_sticker_media_uploader_fk" FOREIGN KEY ("uploaded_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL,
	CONSTRAINT "global_sticker_media_size_check" CHECK ("size_bytes" > 0),
	CONSTRAINT "global_sticker_media_dimensions_check" CHECK ("width" BETWEEN 1 AND 4096 AND "height" BETWEEN 1 AND 4096)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "global_sticker_media_storage_key_idx" ON "global_sticker_media" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX "global_sticker_media_sha_idx" ON "global_sticker_media" USING btree ("sha256");
--> statement-breakpoint
CREATE TABLE "global_stickers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"action_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"name" text NOT NULL,
	"alt_text" text NOT NULL,
	"author_credit" text,
	"license_note" text,
	"source_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "global_stickers_pack_fk" FOREIGN KEY ("pack_id") REFERENCES "global_sticker_packs"("id") ON DELETE CASCADE,
	CONSTRAINT "global_stickers_media_fk" FOREIGN KEY ("media_id") REFERENCES "global_sticker_media"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX "global_stickers_pack_id_id_idx" ON "global_stickers" USING btree ("pack_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "global_stickers_pack_action_idx" ON "global_stickers" USING btree ("pack_id","action_id");
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "global_sticker_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_global_sticker_fk" FOREIGN KEY ("global_sticker_id") REFERENCES "global_stickers"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_sticker_shape_check";
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sticker_shape_check" CHECK (("sticker_id" IS NULL AND "global_sticker_id" IS NULL AND "sticker_presentation" IS NULL) OR ((("sticker_id" IS NOT NULL)::int + ("global_sticker_id" IS NOT NULL)::int) = 1 AND "sticker_presentation" IS NOT NULL AND "kind" = 'TEXT' AND "dice" IS NULL));
--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_player_request_shape_check";
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_player_request_shape_check" CHECK ("player_request_id" IS NULL OR ("kind" = 'SYSTEM' AND "body" = '' AND "dice" IS NULL AND "system_data" IS NULL AND "sticker_id" IS NULL AND "global_sticker_id" IS NULL AND "sticker_presentation" IS NULL));
