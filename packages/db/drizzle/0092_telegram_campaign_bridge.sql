CREATE TABLE telegram_campaign_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receiver_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE, session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  telegram_user_id text NOT NULL, chat_id text, thread_id text NOT NULL DEFAULT '0',
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
--> statement-breakpoint
CREATE TABLE telegram_campaign_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receiver_id uuid NOT NULL,
  telegram_user_id text NOT NULL, session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX telegram_campaign_member_identity_idx ON telegram_campaign_members(receiver_id,telegram_user_id);
--> statement-breakpoint
CREATE TABLE telegram_campaign_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receiver_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  owner_session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  chat_id text NOT NULL, thread_id text NOT NULL DEFAULT '0'
);
--> statement-breakpoint
CREATE UNIQUE INDEX telegram_campaign_chat_campaign_idx ON telegram_campaign_chats(receiver_id,campaign_id);
--> statement-breakpoint
CREATE UNIQUE INDEX telegram_campaign_chat_destination_idx ON telegram_campaign_chats(receiver_id,chat_id,thread_id);
--> statement-breakpoint
CREATE TABLE telegram_campaign_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receiver_id uuid NOT NULL,
  update_id text NOT NULL, message_id text NOT NULL, action_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  payload_hash text NOT NULL, payload jsonb NOT NULL,
  telegram_user_id text NOT NULL, chat_id text NOT NULL, thread_id text NOT NULL DEFAULT '0',
  session_id uuid, state text NOT NULL DEFAULT 'PENDING', reply_state text NOT NULL DEFAULT 'NONE',
  reply_text text, reply_message_id text, error_code text, worker_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_campaign_update_state_check CHECK (state IN ('PENDING','RUNNING','DONE','UNKNOWN','REJECTED')),
  CONSTRAINT telegram_campaign_reply_state_check CHECK (reply_state IN ('NONE','PENDING','SENDING','SENT','UNKNOWN','FAILED','CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX telegram_campaign_update_identity_idx ON telegram_campaign_updates(receiver_id,update_id);
--> statement-breakpoint
CREATE UNIQUE INDEX telegram_campaign_message_identity_idx ON telegram_campaign_updates(receiver_id,chat_id,thread_id,message_id);
--> statement-breakpoint
CREATE INDEX telegram_campaign_update_queue_idx ON telegram_campaign_updates(receiver_id,state,created_at);
