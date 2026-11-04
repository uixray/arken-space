CREATE TABLE creation_recipes (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL CONSTRAINT "creation_recipes_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 name text NOT NULL, enabled boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 0,
 created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_recipe_actor_fk FOREIGN KEY(campaign_id,created_by_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_recipe_shape CHECK(revision>=0 AND length(trim(name)) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_recipes_campaign_id_unique ON creation_recipes(campaign_id,id);
--> statement-breakpoint
CREATE TABLE creation_recipe_versions (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL, recipe_id uuid NOT NULL, number integer NOT NULL,
 published boolean NOT NULL, source jsonb NOT NULL, source_hash text NOT NULL,
 created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_recipe_version_recipe_fk FOREIGN KEY(campaign_id,recipe_id) REFERENCES creation_recipes(campaign_id,id) ON DELETE CASCADE,
 CONSTRAINT creation_recipe_version_actor_fk FOREIGN KEY(campaign_id,created_by_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_recipe_version_shape CHECK(number>0 AND source_hash ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_recipe_versions_campaign_id_unique ON creation_recipe_versions(campaign_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_recipe_versions_number_unique ON creation_recipe_versions(campaign_id,recipe_id,number);
--> statement-breakpoint
CREATE TABLE creation_objects (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL CONSTRAINT "creation_objects_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 version_id uuid NOT NULL, kind text NOT NULL, character_id uuid NOT NULL,
 entry_id uuid CONSTRAINT "creation_objects_entry_id_character_catalog_entries_id_fk" REFERENCES character_catalog_entries(id), instance_id uuid, status text NOT NULL,
 level integer NOT NULL, stage text NOT NULL, snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
 paid_basis jsonb NOT NULL, revision integer NOT NULL DEFAULT 0, created_action_id uuid NOT NULL,
 created_by_membership_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_object_version_fk FOREIGN KEY(campaign_id,version_id) REFERENCES creation_template_versions(campaign_id,id),
 CONSTRAINT creation_object_character_fk FOREIGN KEY(campaign_id,character_id) REFERENCES characters(campaign_id,id),
 CONSTRAINT creation_object_instance_fk FOREIGN KEY(campaign_id,instance_id) REFERENCES world_content_instances(campaign_id,id),
 CONSTRAINT creation_object_actor_fk FOREIGN KEY(campaign_id,created_by_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_object_shape CHECK(level BETWEEN 1 AND 1000 AND revision>=0 AND snapshot_hash ~ '^[a-f0-9]{64}$'
  AND stage IN ('CRAFTED','EVOLVING','MASTERWORK','FORGED')
  AND ((status='ACTIVE' AND entry_id IS NOT NULL) OR (status='CONSUMED' AND entry_id IS NULL))
  AND ((kind='SKILL' AND instance_id IS NULL) OR (kind='ARTIFACT' AND instance_id IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_objects_campaign_id_unique ON creation_objects(campaign_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_objects_entry_unique ON creation_objects(entry_id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_objects_instance_unique ON creation_objects(instance_id);
--> statement-breakpoint
CREATE INDEX creation_objects_character_idx ON creation_objects(campaign_id,character_id,id);
--> statement-breakpoint
CREATE TABLE creation_operation_quotes (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL CONSTRAINT "creation_operation_quotes_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 actor_membership_id uuid NOT NULL, character_id uuid NOT NULL, recipe_version_id uuid NOT NULL,
 request jsonb NOT NULL, input_hash text NOT NULL, inputs jsonb NOT NULL, view jsonb NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_quote_actor_fk FOREIGN KEY(campaign_id,actor_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_quote_character_fk FOREIGN KEY(campaign_id,character_id) REFERENCES characters(campaign_id,id),
 CONSTRAINT creation_quote_recipe_fk FOREIGN KEY(campaign_id,recipe_version_id) REFERENCES creation_recipe_versions(campaign_id,id),
 CONSTRAINT creation_quote_hash_shape CHECK(input_hash ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_quotes_campaign_id_unique ON creation_operation_quotes(campaign_id,id);
--> statement-breakpoint
CREATE TABLE creation_operations (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL CONSTRAINT "creation_operations_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 action_id uuid NOT NULL, quote_id uuid NOT NULL, actor_membership_id uuid NOT NULL, character_id uuid NOT NULL,
 receipt jsonb NOT NULL, provenance jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_operation_quote_fk FOREIGN KEY(campaign_id,quote_id) REFERENCES creation_operation_quotes(campaign_id,id),
 CONSTRAINT creation_operation_actor_fk FOREIGN KEY(campaign_id,actor_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_operation_character_fk FOREIGN KEY(campaign_id,character_id) REFERENCES characters(campaign_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_operations_campaign_id_unique ON creation_operations(campaign_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_operations_action_unique ON creation_operations(campaign_id,action_id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_operations_quote_unique ON creation_operations(quote_id);
--> statement-breakpoint
CREATE INDEX creation_operations_character_idx ON creation_operations(campaign_id,character_id,id);
--> statement-breakpoint
CREATE TABLE creation_object_edges (
 campaign_id uuid NOT NULL CONSTRAINT "creation_object_edges_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 input_object_id uuid PRIMARY KEY, output_object_id uuid NOT NULL, operation_id uuid NOT NULL,
 CONSTRAINT creation_edge_input_fk FOREIGN KEY(campaign_id,input_object_id) REFERENCES creation_objects(campaign_id,id),
 CONSTRAINT creation_edge_output_fk FOREIGN KEY(campaign_id,output_object_id) REFERENCES creation_objects(campaign_id,id),
 CONSTRAINT creation_edge_operation_fk FOREIGN KEY(campaign_id,operation_id) REFERENCES creation_operations(campaign_id,id),
 CONSTRAINT creation_edge_no_self CHECK(input_object_id<>output_object_id)
);
--> statement-breakpoint
CREATE INDEX creation_edges_output_idx ON creation_object_edges(campaign_id,output_object_id);
--> statement-breakpoint
CREATE TRIGGER creation_recipe_version_immutable BEFORE UPDATE ON creation_recipe_versions FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
CREATE TRIGGER creation_quote_immutable BEFORE UPDATE ON creation_operation_quotes FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
CREATE TRIGGER creation_operation_immutable BEFORE UPDATE ON creation_operations FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
CREATE TRIGGER creation_edge_immutable BEFORE UPDATE ON creation_object_edges FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
-- Runtime counters may move; their maximum/reset rule and every other field may not.
CREATE FUNCTION creation_entry_mechanics(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN value ? 'uses' THEN
  (value - 'uses') || jsonb_build_object('uses', (value->'uses') - ARRAY['current','lastRechargeDay','lastBattleCounter'])
 ELSE value END
$$;
--> statement-breakpoint
CREATE FUNCTION creation_protect_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM campaigns WHERE id=OLD.campaign_id) THEN
   RAISE EXCEPTION 'CREATION_OBJECT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF current_setting('arken.creation_object',true) IS DISTINCT FROM OLD.id::text OR OLD.status='CONSUMED'
  OR (to_jsonb(NEW)-ARRAY['character_id','entry_id','status','revision']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['character_id','entry_id','status','revision'])
  OR NEW.revision<>OLD.revision+1
  OR (NEW.status='ACTIVE' AND NEW.entry_id IS DISTINCT FROM OLD.entry_id)
  OR (NEW.status='CONSUMED' AND NEW.character_id IS DISTINCT FROM OLD.character_id) THEN
  RAISE EXCEPTION 'CREATION_OBJECT_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER creation_object_protected BEFORE UPDATE OR DELETE ON creation_objects FOR EACH ROW EXECUTE FUNCTION creation_protect_object();
--> statement-breakpoint
CREATE FUNCTION creation_protect_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obj creation_objects%ROWTYPE;
BEGIN
 SELECT * INTO obj FROM creation_objects WHERE entry_id=OLD.id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM campaigns WHERE id=obj.campaign_id) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CREATION_BOUND_ENTRY' USING ERRCODE='23514'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.source_catalog_entry_id IS DISTINCT FROM OLD.source_catalog_entry_id
  OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.name IS DISTINCT FROM OLD.name
  OR NEW.description IS DISTINCT FROM OLD.description
  OR creation_entry_mechanics(NEW.data) IS DISTINCT FROM creation_entry_mechanics(OLD.data)
  OR (NEW.character_id IS DISTINCT FROM OLD.character_id AND current_setting('arken.creation_object',true) IS DISTINCT FROM obj.id::text)
 THEN RAISE EXCEPTION 'CREATION_BOUND_ENTRY' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER creation_entry_protected BEFORE UPDATE OR DELETE ON character_catalog_entries FOR EACH ROW EXECUTE FUNCTION creation_protect_entry();
--> statement-breakpoint
CREATE FUNCTION creation_protect_instance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obj creation_objects%ROWTYPE;
BEGIN
 SELECT * INTO obj FROM creation_objects WHERE instance_id=OLD.id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM campaigns WHERE id=obj.campaign_id) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CREATION_BOUND_INSTANCE' USING ERRCODE='23514'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
  OR NEW.world_content_id IS DISTINCT FROM OLD.world_content_id
  OR ((NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.inventory_character_id IS DISTINCT FROM OLD.inventory_character_id
       OR NEW.owner_membership_id IS DISTINCT FROM OLD.owner_membership_id)
      AND current_setting('arken.creation_object',true) IS DISTINCT FROM obj.id::text)
 THEN RAISE EXCEPTION 'CREATION_BOUND_INSTANCE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER creation_instance_protected BEFORE UPDATE OR DELETE ON world_content_instances FOR EACH ROW EXECUTE FUNCTION creation_protect_instance();
--> statement-breakpoint
-- Deferred so a transfer/consumption can change its exact linked rows atomically.
CREATE FUNCTION creation_check_live_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obj creation_objects%ROWTYPE; ent character_catalog_entries%ROWTYPE; inst world_content_instances%ROWTYPE;
BEGIN
 SELECT * INTO obj FROM creation_objects WHERE id=NEW.id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM creation_template_versions v JOIN creation_templates t ON t.id=v.template_id AND t.campaign_id=v.campaign_id
  WHERE v.id=obj.version_id AND v.campaign_id=obj.campaign_id AND t.kind=obj.kind
   AND v.version_hash IS NOT DISTINCT FROM obj.snapshot->>'versionHash'
   AND v.evaluation->'card'->>'name' IS NOT DISTINCT FROM obj.snapshot->>'name'
   AND v.evaluation->'card'->>'description' IS NOT DISTINCT FROM obj.snapshot->>'description'
   AND v.evaluation->'card'->>'appearance' IS NOT DISTINCT FROM obj.snapshot->>'appearance'
   AND v.evaluation->'card'->'artifact'->>'baseItemId' IS NOT DISTINCT FROM obj.snapshot->>'baseItemId'
   AND creation_entry_mechanics(v.evaluation->'entryData') IS NOT DISTINCT FROM creation_entry_mechanics(obj.snapshot->'entryData')
 ) THEN RAISE EXCEPTION 'CREATION_BINDING_INCONSISTENT' USING ERRCODE='23514'; END IF;
 IF obj.status='ACTIVE' THEN
  SELECT * INTO ent FROM character_catalog_entries WHERE id=obj.entry_id;
  IF NOT FOUND OR ent.character_id<>obj.character_id OR ent.source_catalog_entry_id IS NOT NULL
   OR ent.name IS DISTINCT FROM obj.snapshot->>'name' OR ent.description IS DISTINCT FROM obj.snapshot->>'description'
   OR ent.kind::text IS DISTINCT FROM obj.snapshot->>'entryKind'
   OR creation_entry_mechanics(ent.data) IS DISTINCT FROM creation_entry_mechanics(obj.snapshot->'entryData') THEN
   RAISE EXCEPTION 'CREATION_BINDING_INCONSISTENT' USING ERRCODE='23514';
  END IF;
 END IF;
 IF obj.instance_id IS NOT NULL THEN
  SELECT * INTO inst FROM world_content_instances WHERE id=obj.instance_id;
  IF NOT FOUND OR inst.campaign_id<>obj.campaign_id OR inst.world_content_id::text IS DISTINCT FROM obj.snapshot->>'baseItemId'
   OR inst.owner_membership_id IS NOT NULL
   OR (obj.status='ACTIVE' AND (inst.quantity IS DISTINCT FROM 1 OR inst.inventory_character_id IS DISTINCT FROM obj.character_id))
   OR (obj.status='CONSUMED' AND (inst.quantity IS DISTINCT FROM 0 OR inst.inventory_character_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'CREATION_BINDING_INCONSISTENT' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER creation_object_binding_consistent AFTER INSERT OR UPDATE ON creation_objects
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION creation_check_live_binding();
