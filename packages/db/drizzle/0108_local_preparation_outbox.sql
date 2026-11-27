-- Session activity gates peer access, not durable local event ownership.
-- Existing uncaptured history is deliberately not assigned a fabricated epoch.
CREATE OR REPLACE FUNCTION capture_local_event_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE local_authority record;
BEGIN
 SELECT a.host_id,a.session_id,a.epoch INTO local_authority
 FROM local_session_authorities a JOIN local_host_instances h ON h.id=a.host_id
 WHERE a.campaign_id=NEW.campaign_id FOR SHARE OF a;
 IF FOUND THEN
  INSERT INTO local_event_outbox(origin_host_id,event_sequence,campaign_id,action_id,authority_session_id,authority_epoch,event)
  VALUES(local_authority.host_id,NEW.sequence,NEW.campaign_id,NEW.action_id,local_authority.session_id,local_authority.epoch,to_jsonb(NEW));
 END IF;
 RETURN NEW;
END;
$$;
