ALTER TABLE "bug_intake_deliveries" ADD COLUMN "upload_receipts" jsonb DEFAULT '{}'::jsonb NOT NULL;
