-- Revocation retains membership provenance, character ownership and other campaigns.
ALTER TABLE memberships ADD COLUMN access_revoked_at timestamptz;
