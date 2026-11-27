-- Only the final acknowledged request is durable. Unfinished chunks are bounded memory.
CREATE TABLE local_chat_upload_receipts (
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 upload_id uuid NOT NULL,
 membership_id uuid NOT NULL,
 device_id uuid NOT NULL,
 session_id uuid NOT NULL,
 epoch integer NOT NULL,
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 content_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,upload_id),
 FOREIGN KEY(campaign_id,membership_id) REFERENCES memberships(campaign_id,id) ON DELETE CASCADE,
 FOREIGN KEY(campaign_id,content_id) REFERENCES chat_attachment_uploads(campaign_id,content_id) ON DELETE CASCADE
);
