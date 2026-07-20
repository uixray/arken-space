SELECT 'action_journal', count(*)::bigint FROM action_journal
UNION ALL SELECT 'assets', count(*)::bigint FROM assets
UNION ALL SELECT 'audio_states', count(*)::bigint FROM audio_states
UNION ALL SELECT 'campaigns', count(*)::bigint FROM campaigns
UNION ALL SELECT 'catalog_entries', count(*)::bigint FROM catalog_entries
UNION ALL SELECT 'character_catalog_entries', count(*)::bigint FROM character_catalog_entries
UNION ALL SELECT 'characters', count(*)::bigint FROM characters
UNION ALL SELECT 'chat_messages', count(*)::bigint FROM chat_messages
UNION ALL SELECT 'drawings', count(*)::bigint FROM drawings
UNION ALL SELECT 'fog_reveals', count(*)::bigint FROM fog_reveals
UNION ALL SELECT 'feedback_attachments', count(*)::bigint FROM feedback_attachments
UNION ALL SELECT 'feedback_reports', count(*)::bigint FROM feedback_reports
UNION ALL SELECT 'game_events', count(*)::bigint FROM game_events
UNION ALL SELECT 'gm_access_credentials', count(*)::bigint FROM gm_access_credentials
UNION ALL SELECT 'invites', count(*)::bigint FROM invites
UNION ALL SELECT 'memberships', count(*)::bigint FROM memberships
UNION ALL SELECT 'player_access_grants', count(*)::bigint FROM player_access_grants
UNION ALL SELECT 'scenes', count(*)::bigint FROM scenes
UNION ALL SELECT 'sessions', count(*)::bigint FROM sessions
UNION ALL SELECT 'tokens', count(*)::bigint FROM tokens
UNION ALL SELECT 'token_controllers', count(*)::bigint FROM token_controllers
UNION ALL SELECT 'token_definitions', count(*)::bigint FROM token_definitions
ORDER BY 1;
