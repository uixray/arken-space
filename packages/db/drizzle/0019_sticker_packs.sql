CREATE TYPE "public"."sticker_pack_subject" AS ENUM('CHARACTER','PLAYER','NPC','CREATURE');
--> statement-breakpoint
CREATE TYPE "public"."sticker_pack_audience" AS ENUM('CAMPAIGN','ENTITLED','GM_ONLY');
--> statement-breakpoint
CREATE TYPE "public"."sticker_pack_send_policy" AS ENUM('ALL_MEMBERS','ENTITLED_ONLY','GM_ONLY');
--> statement-breakpoint
CREATE TYPE "public"."sticker_pack_lifecycle" AS ENUM('DRAFT','ACTIVE','DEPRECATED','ARCHIVED');
--> statement-breakpoint
CREATE TYPE "public"."likeness_consent_status" AS ENUM('GRANTED','REVOKED');
--> statement-breakpoint
CREATE TYPE "public"."sticker_provenance_type" AS ENUM('ORIGINAL','COMMISSIONED','IMPORTED');
--> statement-breakpoint
CREATE UNIQUE INDEX "characters_campaign_id_id_idx" ON "characters" ("campaign_id","id");
--> statement-breakpoint
CREATE TABLE "sticker_packs" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "campaign_id" uuid NOT NULL, "name" text NOT NULL,
 "subject" "sticker_pack_subject" NOT NULL, "subject_character_id" uuid, "subject_membership_id" uuid, "subject_label" text,
 "audience" "sticker_pack_audience" DEFAULT 'CAMPAIGN' NOT NULL, "send_policy" "sticker_pack_send_policy" DEFAULT 'ALL_MEMBERS' NOT NULL,
 "lifecycle" "sticker_pack_lifecycle" DEFAULT 'DRAFT' NOT NULL, "revision" integer DEFAULT 0 NOT NULL,
 "deprecated_at" timestamptz, "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "sticker_packs_name_revision_check" CHECK (length(trim(name)) BETWEEN 1 AND 120 AND revision >= 0),
 CONSTRAINT "sticker_packs_subject_shape_check" CHECK ((subject='CHARACTER' AND subject_character_id IS NOT NULL AND subject_membership_id IS NULL AND subject_label IS NULL) OR (subject='PLAYER' AND subject_character_id IS NULL AND subject_membership_id IS NOT NULL AND subject_label IS NULL) OR (subject IN ('NPC','CREATURE') AND subject_character_id IS NULL AND subject_membership_id IS NULL AND subject_label IS NOT NULL AND length(trim(subject_label)) BETWEEN 1 AND 80)),
 CONSTRAINT "sticker_packs_deprecation_check" CHECK (lifecycle IS NOT NULL AND ((lifecycle='DEPRECATED' AND deprecated_at IS NOT NULL) OR (lifecycle<>'DEPRECATED' AND deprecated_at IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sticker_packs_campaign_id_id_idx" ON "sticker_packs" ("campaign_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sticker_packs_campaign_player_subject_idx" ON "sticker_packs" ("campaign_id","id","subject_membership_id");
--> statement-breakpoint
CREATE INDEX "sticker_packs_campaign_lifecycle_idx" ON "sticker_packs" ("campaign_id","lifecycle");
--> statement-breakpoint
ALTER TABLE "sticker_packs" ADD CONSTRAINT "sticker_packs_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "sticker_packs" ADD CONSTRAINT "sticker_packs_campaign_membership_fk" FOREIGN KEY ("campaign_id","subject_membership_id") REFERENCES "memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "sticker_packs" ADD CONSTRAINT "sticker_packs_campaign_character_fk" FOREIGN KEY ("campaign_id","subject_character_id") REFERENCES "characters"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "sticker_pack_entitlements" ("campaign_id" uuid NOT NULL,"pack_id" uuid NOT NULL,"membership_id" uuid NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "sticker_pack_entitlements_unique_idx" ON "sticker_pack_entitlements" ("pack_id","membership_id");
--> statement-breakpoint
ALTER TABLE "sticker_pack_entitlements" ADD CONSTRAINT "sticker_pack_entitlements_campaign_pack_fk" FOREIGN KEY ("campaign_id","pack_id") REFERENCES "sticker_packs"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "sticker_pack_entitlements" ADD CONSTRAINT "sticker_pack_entitlements_campaign_member_fk" FOREIGN KEY ("campaign_id","membership_id") REFERENCES "memberships"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE "player_likeness_consents" ("campaign_id" uuid NOT NULL,"pack_id" uuid NOT NULL,"membership_id" uuid NOT NULL,"status" "likeness_consent_status" NOT NULL,"granted_at" timestamptz,"revoked_at" timestamptz,"updated_at" timestamptz DEFAULT now() NOT NULL, CONSTRAINT "player_likeness_consents_status_check" CHECK (status IS NOT NULL AND ((status='GRANTED' AND granted_at IS NOT NULL AND revoked_at IS NULL) OR (status='REVOKED' AND granted_at IS NOT NULL AND revoked_at IS NOT NULL AND revoked_at >= granted_at))));
--> statement-breakpoint
CREATE UNIQUE INDEX "player_likeness_consents_unique_idx" ON "player_likeness_consents" ("pack_id","membership_id");
--> statement-breakpoint
ALTER TABLE "player_likeness_consents" ADD CONSTRAINT "player_likeness_consents_campaign_pack_fk" FOREIGN KEY ("campaign_id","pack_id","membership_id") REFERENCES "sticker_packs"("campaign_id","id","subject_membership_id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "player_likeness_consents" ADD CONSTRAINT "player_likeness_consents_campaign_member_fk" FOREIGN KEY ("campaign_id","membership_id") REFERENCES "memberships"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE "sticker_media" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"campaign_id" uuid NOT NULL,"uploaded_by_membership_id" uuid NOT NULL,"storage_key" text NOT NULL,"mime_type" text NOT NULL,"size_bytes" integer NOT NULL,"width" integer NOT NULL,"height" integer NOT NULL,"sha256" text NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL, CONSTRAINT "sticker_media_shape_check" CHECK (size_bytes > 0 AND size_bytes <= 5242880 AND width BETWEEN 1 AND 4096 AND height BETWEEN 1 AND 4096 AND mime_type IN ('image/png','image/webp') AND sha256 ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint
CREATE UNIQUE INDEX "sticker_media_campaign_id_id_idx" ON "sticker_media" ("campaign_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sticker_media_storage_key_idx" ON "sticker_media" ("storage_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "sticker_media_campaign_hash_idx" ON "sticker_media" ("campaign_id","sha256");
--> statement-breakpoint
ALTER TABLE "sticker_media" ADD CONSTRAINT "sticker_media_campaign_uploader_fk" FOREIGN KEY ("campaign_id","uploaded_by_membership_id") REFERENCES "memberships"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "stickers" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"campaign_id" uuid NOT NULL,"pack_id" uuid NOT NULL,"media_id" uuid NOT NULL,"name" text NOT NULL,"alt_text" text NOT NULL,"provenance_type" "sticker_provenance_type" NOT NULL,"source_reference" text,"author_credit" text,"license_note" text,"created_at" timestamptz DEFAULT now() NOT NULL, CONSTRAINT "stickers_name_check" CHECK (name IS NOT NULL AND length(trim(name)) BETWEEN 1 AND 80), CONSTRAINT "stickers_alt_text_check" CHECK (alt_text IS NOT NULL AND length(trim(alt_text)) BETWEEN 1 AND 240), CONSTRAINT "stickers_provenance_check" CHECK (provenance_type IS NOT NULL AND length(coalesce(source_reference,'')) <= 1000 AND length(coalesce(author_credit,'')) <= 200 AND length(coalesce(license_note,'')) <= 1000 AND (provenance_type <> 'IMPORTED' OR (source_reference IS NOT NULL AND length(trim(source_reference)) > 0 AND author_credit IS NOT NULL AND length(trim(author_credit)) > 0 AND license_note IS NOT NULL AND length(trim(license_note)) > 0))));
--> statement-breakpoint
CREATE UNIQUE INDEX "stickers_campaign_id_id_idx" ON "stickers" ("campaign_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "stickers_pack_media_idx" ON "stickers" ("pack_id","media_id");
--> statement-breakpoint
ALTER TABLE "stickers" ADD CONSTRAINT "stickers_campaign_pack_fk" FOREIGN KEY ("campaign_id","pack_id") REFERENCES "sticker_packs"("campaign_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "stickers" ADD CONSTRAINT "stickers_campaign_media_fk" FOREIGN KEY ("campaign_id","media_id") REFERENCES "sticker_media"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "sticker_viewer_membership_ids" jsonb;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "sticker_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "sticker_presentation" jsonb;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_campaign_sticker_fk" FOREIGN KEY ("campaign_id","sticker_id") REFERENCES "stickers"("campaign_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sticker_shape_check" CHECK ((sticker_id IS NULL AND sticker_presentation IS NULL) OR (sticker_id IS NOT NULL AND sticker_presentation IS NOT NULL AND kind='TEXT' AND dice IS NULL));
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sticker_presentation_check" CHECK (CASE WHEN sticker_presentation IS NULL THEN true WHEN jsonb_typeof(sticker_presentation) <> 'object' THEN false ELSE coalesce(sticker_presentation - 'name' - 'altText' - 'assetUrl' - 'width' - 'height' = '{}'::jsonb AND jsonb_typeof(sticker_presentation->'name') = 'string' AND length(trim(sticker_presentation->>'name')) BETWEEN 1 AND 80 AND jsonb_typeof(sticker_presentation->'altText') = 'string' AND length(trim(sticker_presentation->>'altText')) BETWEEN 1 AND 240 AND jsonb_typeof(sticker_presentation->'assetUrl') = 'string' AND length(sticker_presentation->>'assetUrl') BETWEEN 1 AND 2048 AND jsonb_typeof(sticker_presentation->'width') = 'number' AND (sticker_presentation->>'width')::numeric BETWEEN 1 AND 4096 AND jsonb_typeof(sticker_presentation->'height') = 'number' AND (sticker_presentation->>'height')::numeric BETWEEN 1 AND 4096, false) END);
--> statement-breakpoint
CREATE FUNCTION preserve_sticker_message_presentation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.sticker_id IS NOT NULL AND (NEW.sticker_id IS DISTINCT FROM OLD.sticker_id OR NEW.sticker_presentation IS DISTINCT FROM OLD.sticker_presentation OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.body IS DISTINCT FROM OLD.body OR NEW.thread_id IS DISTINCT FROM OLD.thread_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.membership_id IS DISTINCT FROM OLD.membership_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'sticker presentation is immutable'; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER chat_messages_sticker_immutable BEFORE UPDATE ON chat_messages FOR EACH ROW EXECUTE FUNCTION preserve_sticker_message_presentation();
