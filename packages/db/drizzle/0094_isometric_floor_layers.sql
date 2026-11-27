ALTER TABLE fog_reveals ADD COLUMN level_id uuid;
--> statement-breakpoint
ALTER TABLE drawings ADD COLUMN level_id uuid;
--> statement-breakpoint
CREATE INDEX fog_scene_level_idx ON fog_reveals(scene_id, level_id, sequence);
--> statement-breakpoint
CREATE INDEX drawings_scene_level_idx ON drawings(scene_id, level_id);
--> statement-breakpoint
CREATE FUNCTION arken_iso_cell_walkable(f jsonb, x double precision, y double precision)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(x >= (f->'bounds'->>'x')::integer AND y >= (f->'bounds'->>'y')::integer
 AND x < (f->'bounds'->>'x')::integer+(f->'bounds'->>'width')::integer
 AND y < (f->'bounds'->>'y')::integer+(f->'bounds'->>'height')::integer
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'blocked') c WHERE (c->>'x')::integer=floor(x) AND (c->>'y')::integer=floor(y)), false)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION arken_isometric_token_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 s scenes%ROWTYPE; cfg jsonb; f jsonb; source_floor jsonb; source_level text; target_level text;
 size_value double precision; ox double precision; oy double precision;
 sx double precision; sy double precision; ex double precision; ey double precision;
 dx double precision; dy double precision; cx integer; cy integer; end_x integer; end_y integer;
 step_x integer; step_y integer; cross_x double precision; cross_y double precision;
 delta_x double precision; delta_y double precision; iterations integer:=0;
BEGIN
 SELECT * INTO s FROM scenes WHERE id=NEW.scene_id FOR SHARE;
 IF s.projection <> 'ISOMETRIC' OR s.grid->'isometric' IS NULL THEN RETURN NEW; END IF;
 cfg:=s.grid->'isometric'; target_level:=COALESCE(NEW.level_id::text,cfg->'floors'->0->>'id');
 SELECT item INTO f FROM jsonb_array_elements(cfg->'floors') item WHERE item->>'id'=target_level;
 IF f IS NULL OR NEW.z<>0 THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE='23514'; END IF;
 IF target_level=cfg->'floors'->0->>'id' THEN NEW.level_id:=NULL; END IF;
 size_value:=(s.grid->>'size')::double precision; ox:=(s.grid->>'offsetX')::double precision; oy:=(s.grid->>'offsetY')::double precision;
 ex:=(NEW.x+NEW.width/2.0-ox)/size_value; ey:=(NEW.y+NEW.height-oy)/size_value;
 IF NOT arken_iso_cell_walkable(f,ex,ey) THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE='23514'; END IF;
 sx:=ex; sy:=ey; source_level:=target_level; source_floor:=f;
 IF TG_OP='UPDATE' THEN
   IF OLD.scene_id=NEW.scene_id THEN
     sx:=(OLD.x+OLD.width/2.0-ox)/size_value; sy:=(OLD.y+OLD.height-oy)/size_value;
     source_level:=COALESCE(OLD.level_id::text,cfg->'floors'->0->>'id');
     SELECT item INTO source_floor FROM jsonb_array_elements(cfg->'floors') item WHERE item->>'id'=source_level;
   END IF;
 END IF;
 IF NOT arken_iso_cell_walkable(source_floor,sx,sy) THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE='23514'; END IF;
 IF source_level<>target_level THEN
   IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cfg->'transitions') t WHERE
    ((t->'from'->>'floorId'=source_level AND t->'to'->>'floorId'=target_level
      AND (t->'from'->>'x')::integer=floor(sx) AND (t->'from'->>'y')::integer=floor(sy)
      AND (t->'to'->>'x')::integer=floor(ex) AND (t->'to'->>'y')::integer=floor(ey))
     OR ((t->>'bidirectional')::boolean AND t->'to'->>'floorId'=source_level AND t->'from'->>'floorId'=target_level
      AND (t->'to'->>'x')::integer=floor(sx) AND (t->'to'->>'y')::integer=floor(sy)
      AND (t->'from'->>'x')::integer=floor(ex) AND (t->'from'->>'y')::integer=floor(ey))))
   THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 cx:=floor(sx); cy:=floor(sy); end_x:=floor(ex); end_y:=floor(ey); dx:=ex-sx; dy:=ey-sy;
 step_x:=sign(dx); step_y:=sign(dy);
 delta_x:=CASE WHEN dx=0 THEN 'Infinity'::double precision ELSE 1/abs(dx) END;
 delta_y:=CASE WHEN dy=0 THEN 'Infinity'::double precision ELSE 1/abs(dy) END;
 cross_x:=CASE WHEN dx=0 THEN 'Infinity'::double precision ELSE ((CASE WHEN step_x>0 THEN cx+1 ELSE cx END)-sx)/dx END;
 cross_y:=CASE WHEN dy=0 THEN 'Infinity'::double precision ELSE ((CASE WHEN step_y>0 THEN cy+1 ELSE cy END)-sy)/dy END;
 LOOP
   IF NOT arken_iso_cell_walkable(f,cx,cy) THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE='23514'; END IF;
   EXIT WHEN cx=end_x AND cy=end_y;
   iterations:=iterations+1;
   IF iterations>4096 THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE='23514'; END IF;
   IF abs(cross_x-cross_y)<0.0000000001 THEN
     IF NOT arken_iso_cell_walkable(f,cx+step_x,cy) OR NOT arken_iso_cell_walkable(f,cx,cy+step_y)
     THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE='23514'; END IF;
     cx:=cx+step_x;cy:=cy+step_y;cross_x:=cross_x+delta_x;cross_y:=cross_y+delta_y;
   ELSIF cross_x<cross_y THEN cx:=cx+step_x;cross_x:=cross_x+delta_x;
   ELSE cy:=cy+step_y;cross_y:=cross_y+delta_y; END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION arken_canvas_layer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s scenes%ROWTYPE; cfg jsonb; target text;
BEGIN
 SELECT * INTO s FROM scenes WHERE id=NEW.scene_id FOR SHARE;
 cfg:=s.grid->'isometric';
 IF s.projection<>'ISOMETRIC' OR cfg IS NULL THEN RETURN NEW; END IF;
 target:=COALESCE(NEW.level_id::text,cfg->'floors'->0->>'id');
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cfg->'floors') f WHERE f->>'id'=target)
 THEN RAISE EXCEPTION 'ISOMETRIC_MOVEMENT_FORBIDDEN' USING ERRCODE='23514'; END IF;
 IF target=cfg->'floors'->0->>'id' THEN NEW.level_id:=NULL; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fog_isometric_layer BEFORE INSERT OR UPDATE ON fog_reveals FOR EACH ROW EXECUTE FUNCTION arken_canvas_layer_guard();
--> statement-breakpoint
CREATE TRIGGER drawings_isometric_layer BEFORE INSERT OR UPDATE ON drawings FOR EACH ROW EXECUTE FUNCTION arken_canvas_layer_guard();
