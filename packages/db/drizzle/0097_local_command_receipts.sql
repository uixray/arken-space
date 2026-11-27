-- ACK receipt and game mutation commit in one transaction; snapshots stay projected.
CREATE TABLE local_command_receipts (
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 action_id uuid NOT NULL,
 membership_id uuid NOT NULL,
 device_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 sequence bigint NOT NULL CHECK(sequence>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,action_id),
 FOREIGN KEY(campaign_id,membership_id) REFERENCES memberships(campaign_id,id) ON DELETE CASCADE
);
