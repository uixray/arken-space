-- Build the count query from the checked-in allowlist and only the tables that
-- exist in the live database. This lets a candidate checkout back up an older
-- (valid migration-prefix) production database without referencing future
-- tables. The restore report records sampled versus full coverage.
SELECT string_agg(
  format(
    'SELECT %L AS table_name, count(*)::bigint AS row_count FROM %I',
    table_name,
    table_name
  ),
  E'\nUNION ALL\n'
) || E'\nORDER BY 1;'
FROM (
  VALUES
    ('action_journal'),
    ('assets'),
    ('audio_states'),
    ('campaigns'),
    ('catalog_entries'),
    ('character_catalog_entries'),
    ('character_controllers'),
    ('character_media'),
    ('characters'),
    ('chat_attachment_uploads'),
    ('chat_attachments'),
    ('chat_messages'),
    ('chat_read_cursors'),
    ('chat_threads'),
    ('drawings'),
    ('encounters'),
    ('feedback_attachments'),
    ('feedback_operator_audits'),
    ('feedback_reports'),
    ('fog_reveals'),
    ('game_events'),
    ('gm_access_credentials'),
    ('invites'),
    ('memberships'),
    ('player_access_grants'),
    ('player_likeness_consents'),
    ('player_requests'),
    ('scenes'),
    ('sessions'),
    ('sticker_media'),
    ('sticker_pack_entitlements'),
    ('sticker_packs'),
    ('stickers'),
    ('story_import_batches'),
    ('story_import_sources'),
    ('story_post_media'),
    ('story_post_revisions'),
    ('story_posts'),
    ('token_controllers'),
    ('token_definitions'),
    ('tokens'),
    ('world_map_location_scenes'),
    ('world_map_locations'),
    ('world_map_party_position'),
    ('world_maps')
) AS allowlist(table_name)
WHERE to_regclass(format('%I.%I', 'public', table_name)) IS NOT NULL
\gexec
