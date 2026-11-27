-- Explicit cloud writer authority. Missing rows preserve legacy HOSTED writes.
CREATE TABLE campaign_writer_authorities (
 campaign_id uuid PRIMARY KEY CONSTRAINT campaign_writer_authorities_campaign_id_campaigns_id_fk REFERENCES campaigns(id) ON DELETE CASCADE,
 revision bigint NOT NULL CONSTRAINT campaign_writer_revision_check CHECK(revision>0),
 writer text NOT NULL,
 origin_id uuid CONSTRAINT campaign_writer_authorities_origin_id_cloud_sync_origins_id_fk REFERENCES cloud_sync_origins(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT campaign_writer_kind_check CHECK((writer='HOSTED' AND origin_id IS NULL) OR (writer='LOCAL' AND origin_id IS NOT NULL))
);
--> statement-breakpoint
CREATE FUNCTION enforce_campaign_writer_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scopes uuid[]; old_scopes uuid[]; new_scopes uuid[]; campaign uuid; lease record; permit jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN EXECUTE TG_ARGV[0] INTO old_scopes USING to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN EXECUTE TG_ARGV[0] INTO new_scopes USING to_jsonb(NEW); END IF;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO scopes FROM unnest(coalesce(old_scopes,'{}'::uuid[])||coalesce(new_scopes,'{}'::uuid[])) id WHERE id IS NOT NULL;
 FOREACH campaign IN ARRAY coalesce(scopes,'{}'::uuid[]) LOOP
  PERFORM pg_advisory_xact_lock_shared(683149,hashtext(campaign::text));
  SELECT revision,writer,origin_id INTO lease FROM campaign_writer_authorities WHERE campaign_id=campaign;
  IF FOUND AND lease.writer='LOCAL' THEN
   permit:=nullif(current_setting('arken.cloud_writer',true),'')::jsonb;
   IF permit IS NULL OR permit->>'campaignId' IS DISTINCT FROM campaign::text OR permit->>'revision' IS DISTINCT FROM lease.revision::text OR permit->>'originId' IS DISTINCT FROM lease.origin_id::text THEN
    RAISE EXCEPTION 'CAMPAIGN_WRITER_FENCED' USING ERRCODE='55000';
   END IF;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "achievement_awards" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "achievement_definitions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "achievement_history" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "action_journal" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "assets" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "audio_clip_candidates" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "audio_clip_provenance" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "campaign_archive_state" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "campaign_audio_tracks" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "campaign_economies" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "campaign_sound_packs" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "campaign_soundpad_settings" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "campaign_sounds" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "campaigns" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "catalog_entries" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "character_catalog_entries" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT campaign_id FROM public."characters" WHERE "id"=($1->>''character_id'')::uuid UNION SELECT campaign_id FROM public."catalog_entries" WHERE "id"=($1->>''source_catalog_entry_id'')::uuid) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "character_controllers" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT campaign_id FROM public."characters" WHERE "id"=($1->>''character_id'')::uuid UNION SELECT campaign_id FROM public."memberships" WHERE "id"=($1->>''membership_id'')::uuid) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "character_media" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "character_private_notebooks" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "character_spell_assignment_versions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "character_spell_assignments" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "characters" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "chat_attachments" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "chat_messages" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "chat_read_cursors" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "chat_threads" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_actions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_licences" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_listing_versions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_listings" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_object_edges" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_objects" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_operation_quotes" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_operations" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_purchases" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_recipe_versions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_recipes" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_reviews" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_rule_packs" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_rule_versions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_store_policies" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_store_quotes" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_template_origins" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_template_versions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "creation_templates" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "drawings" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT campaign_id FROM public."scenes" WHERE "id"=($1->>''scene_id'')::uuid UNION SELECT campaign_id FROM public."memberships" WHERE "id"=($1->>''author_membership_id'')::uuid) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "economy_merchants" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "economy_offers" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "economy_purchases" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "economy_quotes" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "encounters" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "fog_reveals" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT campaign_id FROM public."scenes" WHERE "id"=($1->>''scene_id'')::uuid) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "game_events" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "memberships" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "player_likeness_consents" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "player_requests" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "scenes" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "spell_pack_versions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "spell_packs" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "sticker_media" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "sticker_pack_entitlements" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "sticker_packs" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "stickers" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "story_import_batches" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "story_import_sources" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "story_post_media" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "story_post_revisions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "story_posts" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "token_controllers" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT campaign_id FROM public."token_definitions" WHERE "id"=($1->>''token_definition_id'')::uuid UNION SELECT campaign_id FROM public."memberships" WHERE "id"=($1->>''membership_id'')::uuid) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "token_definitions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "tokens" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT campaign_id FROM public."token_definitions" WHERE "id"=($1->>''definition_id'')::uuid UNION SELECT campaign_id FROM public."scenes" WHERE "id"=($1->>''scene_id'')::uuid UNION SELECT campaign_id FROM public."characters" WHERE "id"=($1->>''character_id'')::uuid UNION SELECT campaign_id FROM public."memberships" WHERE "id"=($1->>''owner_membership_id'')::uuid UNION SELECT campaign_id FROM public."assets" WHERE "id"=($1->>''asset_id'')::uuid) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "world_content_instance_actions" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "world_content_instances" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "world_instance_bindings" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "world_map_location_scenes" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "world_map_locations" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "world_map_party_position" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
--> statement-breakpoint
CREATE TRIGGER campaign_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON "world_maps" FOR EACH ROW EXECUTE FUNCTION enforce_campaign_writer_authority('SELECT array_agg(DISTINCT campaign_id) FROM (SELECT ($1->>''campaign_id'')::uuid AS campaign_id) scope');
