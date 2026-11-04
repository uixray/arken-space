-- Separate owner-issued hosted identities; do not fabricate email verification.
ALTER TABLE users ADD COLUMN hosted_login text;
ALTER TABLE users ADD COLUMN hosted_approved_at timestamptz;
ALTER TABLE users ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE users DROP CONSTRAINT users_identity_check;
ALTER TABLE users ADD CONSTRAINT users_identity_check CHECK (
  (identity_kind = 'EMAIL' AND email_normalized IS NOT NULL AND email_display IS NOT NULL
   AND local_instance_id IS NULL AND local_login IS NULL AND local_approved_at IS NULL
   AND hosted_login IS NULL AND hosted_approved_at IS NULL)
  OR
  (identity_kind = 'LOCAL' AND email_normalized IS NULL AND email_display IS NULL AND verified_at IS NULL
   AND local_instance_id IS NOT NULL AND local_login IS NOT NULL AND local_approved_at IS NOT NULL
   AND hosted_login IS NULL AND hosted_approved_at IS NULL)
  OR
  (identity_kind = 'HOSTED' AND email_normalized IS NULL AND email_display IS NULL AND verified_at IS NULL
   AND local_instance_id IS NULL AND local_login IS NULL AND local_approved_at IS NULL
   AND hosted_login IS NOT NULL AND hosted_approved_at IS NOT NULL
   AND hosted_login ~ '^[a-z0-9][a-z0-9_.-]{2,39}$')
);
CREATE UNIQUE INDEX users_hosted_login_idx ON users (hosted_login);
