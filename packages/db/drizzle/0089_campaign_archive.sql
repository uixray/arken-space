CREATE TABLE campaign_archive_state (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  archived_at timestamptz,
  revision integer NOT NULL CHECK (revision > 0),
  last_action_id uuid NOT NULL,
  last_actor_user_id uuid NOT NULL
);
