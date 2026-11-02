ALTER TABLE "bug_intake_updates" ADD COLUMN "conflicting_payloads" jsonb DEFAULT '[]'::jsonb NOT NULL;
