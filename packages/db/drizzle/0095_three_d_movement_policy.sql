-- Reuse the exact floor/stair authority; no separate 3D movement implementation.
DO $$
DECLARE name text; definition text; updated text;
BEGIN
  FOREACH name IN ARRAY ARRAY['arken_isometric_token_guard()','arken_canvas_layer_guard()'] LOOP
    SELECT pg_get_functiondef(name::regprocedure) INTO definition;
    updated:=replace(replace(definition,'s.projection <> ''ISOMETRIC''','s.projection NOT IN (''ISOMETRIC'',''THREE_D'')'),'s.projection<>''ISOMETRIC''','s.projection NOT IN (''ISOMETRIC'',''THREE_D'')');
    IF updated=definition THEN RAISE EXCEPTION '3D_POLICY_UPGRADE_SOURCE_MISMATCH'; END IF;
    EXECUTE updated;
  END LOOP;
END;
$$;
--> statement-breakpoint
-- Archives/history and future writers cannot split render and movement policy.
CREATE FUNCTION arken_three_d_scene_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg jsonb; spec jsonb; f jsonb; c jsonb; expected integer:=0; actual integer; blocked boolean;
BEGIN
 IF NEW.projection <> 'THREE_D' THEN RETURN NEW; END IF;
 cfg:=NEW.grid->'isometric'; spec:=NEW.grid->'threeD';
 IF cfg IS NULL OR spec IS NULL OR spec->>'version'<>'1' OR spec->>'reviewed'<>'true'
 OR jsonb_typeof(spec->'cells') IS DISTINCT FROM 'array' OR jsonb_typeof(cfg->'floors') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'INVALID_3D_SCENE' USING ERRCODE='23514'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(cfg->'floors') LOOP
   expected:=expected+(f->'bounds'->>'width')::integer*(f->'bounds'->>'height')::integer;
 END LOOP;
 actual:=jsonb_array_length(spec->'cells');
 IF expected<1 OR expected>16384 OR actual<>expected OR actual<>(SELECT count(DISTINCT (value->>'floorId',value->>'x',value->>'y')) FROM jsonb_array_elements(spec->'cells'))
 THEN RAISE EXCEPTION 'INVALID_3D_CELL_COVERAGE' USING ERRCODE='23514'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(spec->'cells') LOOP
   SELECT value INTO f FROM jsonb_array_elements(cfg->'floors') WHERE value->>'id'=c->>'floorId';
   IF f IS NULL OR (c->>'x')::integer<(f->'bounds'->>'x')::integer OR (c->>'y')::integer<(f->'bounds'->>'y')::integer
   OR (c->>'x')::integer>=(f->'bounds'->>'x')::integer+(f->'bounds'->>'width')::integer
   OR (c->>'y')::integer>=(f->'bounds'->>'y')::integer+(f->'bounds'->>'height')::integer
   OR c->>'kind' NOT IN ('FLOOR','WALL','DOOR','PROP','VOID')
   THEN RAISE EXCEPTION 'INVALID_3D_CELL' USING ERRCODE='23514'; END IF;
   blocked:=c->>'kind' IN ('WALL','VOID','PROP') OR (c->>'kind'='DOOR' AND COALESCE(c->>'open','false')<>'true');
   IF blocked IS DISTINCT FROM EXISTS(SELECT 1 FROM jsonb_array_elements(f->'blocked') b WHERE (b->>'x')::integer=(c->>'x')::integer AND (b->>'y')::integer=(c->>'y')::integer)
   THEN RAISE EXCEPTION '3D_MOVEMENT_POLICY_MISMATCH' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scenes_three_d_policy BEFORE INSERT OR UPDATE OF projection,grid ON scenes
FOR EACH ROW EXECUTE FUNCTION arken_three_d_scene_guard();
