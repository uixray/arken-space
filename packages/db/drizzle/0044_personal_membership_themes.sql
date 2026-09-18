ALTER TABLE "memberships"
  ADD COLUMN "default_theme_id" text NOT NULL DEFAULT 'forest',
  ADD COLUMN "selected_theme_id" text,
  ADD COLUMN "theme_revision" integer NOT NULL DEFAULT 0,
  ADD COLUMN "default_theme_revision" integer NOT NULL DEFAULT 0;

-- Stable one-time assignment from the immutable membership UUID's first eight
-- hex digits. It deliberately avoids names, aliases, sessions and catalog order.
UPDATE "memberships"
SET "default_theme_id" = (ARRAY['forest','dragons','ice','fire','gold','silver','light'])[
  ((('x' || substr(replace(id::text, '-', ''), 1, 8))::bit(32)::bigint) % 7) + 1
];

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_default_theme_id_check"
    CHECK ("default_theme_id" IN ('forest','dragons','ice','fire','gold','silver','light','classic-v1')),
  ADD CONSTRAINT "memberships_selected_theme_id_check"
    CHECK ("selected_theme_id" IS NULL OR "selected_theme_id" IN ('system','forest','dragons','ice','fire','gold','silver','light','classic-v1'));
