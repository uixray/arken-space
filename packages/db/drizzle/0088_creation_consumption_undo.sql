-- Additive change: preserve the original lifecycle guard, but permit exactly
-- one restoration tied to a durable, not-yet-undone application receipt.
CREATE OR REPLACE FUNCTION creation_protect_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM campaigns WHERE id=OLD.campaign_id) THEN
   RAISE EXCEPTION 'CREATION_OBJECT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF OLD.status='CONSUMED' AND NEW.status='ACTIVE' THEN
  IF current_setting('arken.creation_object',true) IS DISTINCT FROM OLD.id::text
   OR OLD.entry_id IS NOT NULL OR NEW.entry_id IS NULL
   OR NEW.revision<>OLD.revision+1
   OR (to_jsonb(NEW)-ARRAY['entry_id','status','revision']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['entry_id','status','revision'])
   OR NOT EXISTS (
    SELECT 1 FROM game_events e
    WHERE e.campaign_id=OLD.campaign_id AND e.entity_type='chat'
     AND e.entity_id::text=current_setting('arken.creation_undo_message',true)
     AND e.type IN ('entry.roll','ability.area.applied')
     AND e.payload->'undoReceipt'->'consumption'->>'objectId'=OLD.id::text
     AND e.payload->'undoReceipt'->'consumption'->>'entryId'=NEW.entry_id::text
     AND e.payload->'undoReceipt'->'consumption'->>'instanceId'=OLD.instance_id::text
     AND e.payload->'undoReceipt'->'consumption'->>'objectRevision'=OLD.revision::text
     AND NOT EXISTS (SELECT 1 FROM game_events u WHERE u.campaign_id=e.campaign_id
      AND u.type='entry.undo' AND u.payload->>'originalMessageId'=e.entity_id::text)
   ) THEN RAISE EXCEPTION 'CREATION_OBJECT_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN NEW;
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
