CREATE TYPE "public"."fog_shape" AS ENUM('RECT', 'CIRCLE', 'POLYGON', 'BRUSH');--> statement-breakpoint
ALTER TABLE "fog_reveals" ADD COLUMN "shape" "fog_shape" DEFAULT 'RECT' NOT NULL;--> statement-breakpoint
ALTER TABLE "fog_reveals" ADD COLUMN "geometry" jsonb;--> statement-breakpoint
ALTER TABLE "fog_reveals" ADD COLUMN "bbox" jsonb;--> statement-breakpoint
UPDATE "fog_reveals" SET "geometry" = jsonb_build_object('type','RECT','x',"x",'y',"y",'width',"width",'height',"height"), "bbox" = jsonb_build_object('x',"x",'y',"y",'width',"width",'height',"height") WHERE "geometry" IS NULL OR "bbox" IS NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION fill_legacy_fog_geometry() RETURNS trigger AS $$
BEGIN
  IF NEW.geometry IS NULL THEN
    NEW.shape := 'RECT';
    NEW.geometry := jsonb_build_object('type','RECT','x',NEW.x,'y',NEW.y,'width',NEW.width,'height',NEW.height);
  END IF;
  IF NEW.bbox IS NULL THEN
    NEW.bbox := jsonb_build_object('x',NEW.x,'y',NEW.y,'width',NEW.width,'height',NEW.height);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER fog_reveals_fill_legacy_geometry BEFORE INSERT OR UPDATE OF geometry, bbox, x, y, width, height ON "fog_reveals" FOR EACH ROW EXECUTE FUNCTION fill_legacy_fog_geometry();
--> statement-breakpointALTER TABLE "fog_reveals" ALTER COLUMN "geometry" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fog_reveals" ALTER COLUMN "bbox" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fog_reveals" ADD CONSTRAINT "fog_bbox_positive" CHECK (("bbox"->>'width')::double precision > 0 AND ("bbox"->>'height')::double precision > 0);
