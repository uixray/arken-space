CREATE TABLE "world_content_images" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "storage_key" text NOT NULL UNIQUE,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "width" integer,
  "height" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "world_content_images" (id, name, storage_key, mime_type, size_bytes, width, height)
SELECT a.id, a.name, a.storage_key, a.mime_type, a.size_bytes, a.width, a.height
FROM assets a
WHERE a.id IN (SELECT cover_asset_id FROM world_content WHERE cover_asset_id IS NOT NULL)
   OR a.id IN (SELECT asset_id FROM world_content_media);
--> statement-breakpoint
ALTER TABLE "world_content" DROP CONSTRAINT "world_content_cover_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "world_content_media" DROP CONSTRAINT "world_content_media_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "world_content" ADD CONSTRAINT "world_content_cover_asset_id_world_content_images_id_fk"
  FOREIGN KEY (cover_asset_id) REFERENCES world_content_images(id);
--> statement-breakpoint
ALTER TABLE "world_content_media" ADD CONSTRAINT "world_content_media_asset_id_world_content_images_id_fk"
  FOREIGN KEY (asset_id) REFERENCES world_content_images(id);
--> statement-breakpoint
CREATE FUNCTION retain_world_content_image() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE image_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'world_content' THEN image_id := NEW.cover_asset_id;
  ELSE image_id := NEW.asset_id; END IF;
  IF image_id IS NULL OR EXISTS (SELECT 1 FROM world_content_images WHERE id = image_id) THEN
    RETURN NEW;
  END IF;
  -- Serialize first retention with asset deletion/replacement. The global image
  -- is immutable: replacing a campaign asset must not rewrite shared canon.
  PERFORM id FROM assets WHERE id = image_id AND kind <> 'AUDIO'
    AND mime_type IN ('image/png', 'image/jpeg', 'image/webp') FOR SHARE;
  INSERT INTO world_content_images (id, name, storage_key, mime_type, size_bytes, width, height)
  SELECT id, name, storage_key, mime_type, size_bytes, width, height
  FROM assets WHERE id = image_id AND kind <> 'AUDIO'
    AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER world_content_retain_cover
BEFORE INSERT OR UPDATE OF cover_asset_id ON world_content
FOR EACH ROW EXECUTE FUNCTION retain_world_content_image();
--> statement-breakpoint
CREATE TRIGGER world_content_retain_gallery
BEFORE INSERT OR UPDATE OF asset_id ON world_content_media
FOR EACH ROW EXECUTE FUNCTION retain_world_content_image();
