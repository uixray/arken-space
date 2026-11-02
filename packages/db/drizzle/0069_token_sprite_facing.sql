ALTER TABLE "token_definitions" ADD COLUMN "sprite_set" jsonb;
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "facing" text DEFAULT 'FRONT' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_facing_check" CHECK ("facing" IN ('FRONT', 'BACK', 'LEFT', 'RIGHT'));
--> statement-breakpoint
-- Server-authoritative for every write path, including bulk, history and grid
-- transforms. Never derive from a client's history. Horizontal wins equal
-- diagonals; a zero displacement preserves the previous persisted direction.
CREATE FUNCTION "derive_token_facing"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dx double precision; dy double precision;
BEGIN
  dx := NEW.x - OLD.x;
  dy := NEW.y - OLD.y;
  IF dx = 0 AND dy = 0 THEN
    NEW.facing := OLD.facing;
  ELSIF abs(dx) >= abs(dy) THEN
    NEW.facing := CASE WHEN dx > 0 THEN 'RIGHT' ELSE 'LEFT' END;
  ELSE
    NEW.facing := CASE WHEN dy > 0 THEN 'FRONT' ELSE 'BACK' END;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "tokens_derive_facing" BEFORE UPDATE OF x, y, facing ON "tokens"
FOR EACH ROW EXECUTE FUNCTION "derive_token_facing"();
