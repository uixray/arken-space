SELECT 'assets', count(*)::bigint FROM assets
UNION ALL SELECT 'audio_states', count(*)::bigint FROM audio_states
UNION ALL SELECT 'campaigns', count(*)::bigint FROM campaigns
UNION ALL SELECT 'characters', count(*)::bigint FROM characters
UNION ALL SELECT 'chat_messages', count(*)::bigint FROM chat_messages
UNION ALL SELECT 'fog_reveals', count(*)::bigint FROM fog_reveals
UNION ALL SELECT 'game_events', count(*)::bigint FROM game_events
UNION ALL SELECT 'invites', count(*)::bigint FROM invites
UNION ALL SELECT 'memberships', count(*)::bigint FROM memberships
UNION ALL SELECT 'scenes', count(*)::bigint FROM scenes
UNION ALL SELECT 'sessions', count(*)::bigint FROM sessions
UNION ALL SELECT 'tokens', count(*)::bigint FROM tokens
ORDER BY 1;
