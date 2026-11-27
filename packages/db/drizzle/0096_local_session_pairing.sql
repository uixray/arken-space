-- Durable local authority and pairing metadata; not a second game-state store.
CREATE TABLE local_session_authorities (
 campaign_id uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
 host_id uuid NOT NULL REFERENCES local_host_instances(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL,
 epoch integer NOT NULL CHECK(epoch>0),
 active boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE local_session_pairings (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES local_session_authorities(campaign_id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 epoch integer NOT NULL CHECK(epoch>0),
 membership_id uuid NOT NULL,
 device_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 FOREIGN KEY(campaign_id,membership_id) REFERENCES memberships(campaign_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX local_pairings_member_idx ON local_session_pairings(campaign_id,membership_id,device_id);
--> statement-breakpoint
CREATE TABLE local_session_peers (
 campaign_id uuid NOT NULL REFERENCES local_session_authorities(campaign_id) ON DELETE CASCADE,
 membership_id uuid NOT NULL,
 device_id uuid NOT NULL,
 session_id uuid NOT NULL,
 epoch integer NOT NULL CHECK(epoch>0),
 credential_hash text NOT NULL UNIQUE CHECK(length(credential_hash)=64),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(campaign_id,membership_id,device_id),
 FOREIGN KEY(campaign_id,membership_id) REFERENCES memberships(campaign_id,id) ON DELETE CASCADE
);
