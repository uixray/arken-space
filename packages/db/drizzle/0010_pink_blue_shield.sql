ALTER TABLE "scenes" ADD COLUMN "background_x" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "background_y" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "background_width" double precision DEFAULT 1920 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "background_height" double precision DEFAULT 1080 NOT NULL;--> statement-breakpoint
UPDATE "scenes"
SET
  "background_width" = "width",
  "background_height" = "height";
