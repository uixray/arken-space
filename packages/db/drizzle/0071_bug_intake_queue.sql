CREATE TABLE "bug_intake_messages" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "provider" text NOT NULL,
 "chat_id" text NOT NULL, "message_id" text NOT NULL, "album_id" text,
 "source_revision_at" timestamptz NOT NULL, "source_hash" text NOT NULL,
 "source" jsonb NOT NULL, "revision" integer NOT NULL DEFAULT 0,
 "state" text NOT NULL DEFAULT 'REVIEW', "approval" jsonb, "linear_issue_id" text,
 "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "bug_intake_provider_check" CHECK (provider = 'TELEGRAM'),
 CONSTRAINT "bug_intake_revision_check" CHECK (revision >= 0),
 CONSTRAINT "bug_intake_state_check" CHECK (state IN ('REVIEW','APPROVED','LINKED','DISMISSED')),
 CONSTRAINT "bug_intake_approval_check" CHECK (state <> 'APPROVED' OR approval IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bug_intake_source_unique" ON "bug_intake_messages" (provider,chat_id,message_id);
CREATE INDEX "bug_intake_queue_idx" ON "bug_intake_messages" (state,updated_at,id);
CREATE INDEX "bug_intake_album_idx" ON "bug_intake_messages" (provider,chat_id,album_id);
--> statement-breakpoint
CREATE TABLE "bug_intake_versions" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "message_id" uuid NOT NULL CONSTRAINT "bug_intake_versions_message_id_bug_intake_messages_id_fk" REFERENCES "bug_intake_messages"(id) ON DELETE RESTRICT,
 "source_hash" text NOT NULL, "source_revision_at" timestamptz NOT NULL,
 "source" jsonb NOT NULL, "received_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "bug_intake_version_unique" ON "bug_intake_versions" (message_id,source_hash);
--> statement-breakpoint
CREATE TABLE "bug_intake_files" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "version_id" uuid NOT NULL CONSTRAINT "bug_intake_files_version_id_bug_intake_versions_id_fk" REFERENCES "bug_intake_versions"(id) ON DELETE RESTRICT,
 "source_file_id" text NOT NULL, "name" text NOT NULL, "state" text NOT NULL DEFAULT 'MISSING',
 "storage_key" text CONSTRAINT "bug_intake_files_storage_key_unique" UNIQUE, "sha256" text, "mime_type" text, "size_bytes" integer,
 "failure_code" text, "exclusion_reason" text, "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "bug_intake_file_state_check" CHECK (state IN ('MISSING','STORED','FAILED','EXCLUDED')),
 CONSTRAINT "bug_intake_file_stored_check" CHECK (state <> 'STORED' OR (storage_key IS NOT NULL AND sha256 IS NOT NULL AND mime_type IS NOT NULL AND size_bytes IS NOT NULL AND size_bytes >= 0)),
 CONSTRAINT "bug_intake_file_excluded_check" CHECK (state <> 'EXCLUDED' OR (exclusion_reason IS NOT NULL AND length(trim(exclusion_reason)) > 0)),
 CONSTRAINT "bug_intake_file_failed_check" CHECK (state <> 'FAILED' OR failure_code IS NOT NULL)
);
CREATE UNIQUE INDEX "bug_intake_file_unique" ON "bug_intake_files" (version_id,source_file_id);
--> statement-breakpoint
CREATE TABLE "bug_intake_actions" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "action_id" uuid NOT NULL CONSTRAINT "bug_intake_actions_action_id_unique" UNIQUE,
 "message_id" uuid NOT NULL CONSTRAINT "bug_intake_actions_message_id_bug_intake_messages_id_fk" REFERENCES "bug_intake_messages"(id) ON DELETE RESTRICT,
 "operator_membership_id" uuid NOT NULL CONSTRAINT "bug_intake_actions_operator_membership_id_memberships_id_fk" REFERENCES "memberships"(id) ON DELETE RESTRICT,
 "action" text NOT NULL, "request_hash" text NOT NULL, "resulting_revision" integer NOT NULL,
 "receipt" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "bug_intake_actions_message_idx" ON "bug_intake_actions" (message_id,created_at);
