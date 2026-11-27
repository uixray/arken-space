-- All token write paths (including bulk/history/HTTP) share the same policy.
CREATE FUNCTION arken_isometric_token_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scene_row scenes%ROWTYPE;
  config jsonb; floor_config jsonb; cell jsonb;
  size_value double precision; offset_x double precision; offset_y double precision;
  sx double precision; sy double precision; ex double precision; ey double precision;
  dx double precision; dy double precision; cx integer; cy integer; end_x integer; end_y integer;
  step_x integer; step_y integer; cross_x double precision; cross_y double precision;
  delta_x double precision; delta_y double precision; iterations integer := 0;
  bx integer; bounds_y integer; bw integer; bh integer;
  check_x integer; check_y integer; check_index integer;
BEGIN
  SELECT * INTO scene_row FROM scenes WHERE id = NEW.scene_id FOR SHARE;
  IF scene_row.projection <> 'ISOMETRIC' OR scene_row.grid->'isometric' IS NULL THEN RETURN NEW; END IF;
  config := scene_row.grid->'isometric';
  IF jsonb_array_length(config->'floors') <> 1 OR NEW.level_id IS NOT NULL OR NEW.z <> 0 THEN
    RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  floor_config := config->'floors'->0;
  size_value := (scene_row.grid->>'size')::double precision;
  offset_x := (scene_row.grid->>'offsetX')::double precision;
  offset_y := (scene_row.grid->>'offsetY')::double precision;
  ex := (NEW.x + NEW.width / 2.0 - offset_x) / size_value;
  ey := (NEW.y + NEW.height - offset_y) / size_value;
  sx := ex; sy := ey;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.scene_id = NEW.scene_id THEN
      sx := (OLD.x + OLD.width / 2.0 - offset_x) / size_value;
      sy := (OLD.y + OLD.height - offset_y) / size_value;
    END IF;
  END IF;
  bx := (floor_config->'bounds'->>'x')::integer; bounds_y := (floor_config->'bounds'->>'y')::integer;
  bw := (floor_config->'bounds'->>'width')::integer; bh := (floor_config->'bounds'->>'height')::integer;
  IF NOT (sx >= bx AND sy >= bounds_y AND sx < bx+bw AND sy < bounds_y+bh AND ex >= bx AND ey >= bounds_y AND ex < bx+bw AND ey < bounds_y+bh) THEN
    RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  cx := floor(sx); cy := floor(sy); end_x := floor(ex); end_y := floor(ey);
  dx := ex - sx; dy := ey - sy; step_x := sign(dx); step_y := sign(dy);
  delta_x := CASE WHEN dx = 0 THEN 'Infinity'::double precision ELSE 1/abs(dx) END;
  delta_y := CASE WHEN dy = 0 THEN 'Infinity'::double precision ELSE 1/abs(dy) END;
  cross_x := CASE WHEN dx = 0 THEN 'Infinity'::double precision ELSE ((CASE WHEN step_x > 0 THEN cx+1 ELSE cx END)-sx)/dx END;
  cross_y := CASE WHEN dy = 0 THEN 'Infinity'::double precision ELSE ((CASE WHEN step_y > 0 THEN cy+1 ELSE cy END)-sy)/dy END;
  LOOP
    IF cx < bx OR cy < bounds_y OR cx >= bx+bw OR cy >= bounds_y+bh OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(floor_config->'blocked') c
      WHERE (c->>'x')::integer = cx AND (c->>'y')::integer = cy
    ) THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE = '23514'; END IF;
    EXIT WHEN cx = end_x AND cy = end_y;
    iterations := iterations + 1;
    IF iterations > 4096 THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE = '23514'; END IF;
    IF abs(cross_x-cross_y) < 0.0000000001 THEN
      FOR check_index IN 1..2 LOOP
        check_x := cx + CASE WHEN check_index=1 THEN step_x ELSE 0 END;
        check_y := cy + CASE WHEN check_index=2 THEN step_y ELSE 0 END;
        IF check_x < bx OR check_y < bounds_y OR check_x >= bx+bw OR check_y >= bounds_y+bh OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(floor_config->'blocked') c
          WHERE (c->>'x')::integer = check_x AND (c->>'y')::integer = check_y
        ) THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE = '23514'; END IF;
      END LOOP;
      cx := cx+step_x; cy := cy+step_y; cross_x := cross_x+delta_x; cross_y := cross_y+delta_y;
    ELSIF cross_x < cross_y THEN cx := cx+step_x; cross_x := cross_x+delta_x;
    ELSE cy := cy+step_y; cross_y := cross_y+delta_y;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tokens_isometric_policy BEFORE INSERT OR UPDATE OF scene_id, x, y, z, level_id, width, height
ON tokens FOR EACH ROW EXECUTE FUNCTION arken_isometric_token_guard();
