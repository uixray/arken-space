CREATE TABLE "local_event_outbox" (
	"origin_host_id" uuid NOT NULL,
	"event_sequence" bigint NOT NULL,
	"campaign_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"authority_session_id" uuid NOT NULL,
	"authority_epoch" integer NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_event_outbox_pkey" PRIMARY KEY("origin_host_id","event_sequence"),
	CONSTRAINT "local_event_outbox_sequence_check" CHECK ("local_event_outbox"."event_sequence">0),
	CONSTRAINT "local_event_outbox_epoch_check" CHECK ("local_event_outbox"."authority_epoch">0),
	CONSTRAINT "local_event_outbox_event_check" CHECK (jsonb_typeof("local_event_outbox"."event")='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "local_event_outbox_origin_action_idx" ON "local_event_outbox" USING btree ("origin_host_id","campaign_id","action_id");--> statement-breakpoint
CREATE INDEX "local_event_outbox_campaign_sequence_idx" ON "local_event_outbox" USING btree ("campaign_id","event_sequence");
--> statement-breakpoint
-- Capture the exact server event in the same commit, not from a later snapshot.
-- Cloud databases without an active local authority have no matching row.
CREATE FUNCTION capture_local_event_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE local_authority record;
BEGIN
 SELECT a.host_id,a.session_id,a.epoch INTO local_authority
 FROM local_session_authorities a JOIN local_host_instances h ON h.id=a.host_id
 WHERE a.campaign_id=NEW.campaign_id AND a.active=true FOR SHARE OF a;
 IF FOUND THEN
  INSERT INTO local_event_outbox(origin_host_id,event_sequence,campaign_id,action_id,authority_session_id,authority_epoch,event)
  VALUES(local_authority.host_id,NEW.sequence,NEW.campaign_id,NEW.action_id,local_authority.session_id,local_authority.epoch,to_jsonb(NEW));
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER game_events_local_outbox AFTER INSERT ON game_events
 FOR EACH ROW EXECUTE FUNCTION capture_local_event_outbox();
