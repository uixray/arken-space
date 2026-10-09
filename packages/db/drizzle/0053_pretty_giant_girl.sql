CREATE TABLE "account_mail_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action_token_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"key_id" text NOT NULL,
	"payload_nonce" text,
	"payload_ciphertext" text,
	"payload_auth_tag" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"last_error_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_mail_outbox_purpose_check" CHECK ("account_mail_outbox"."purpose" in ('VERIFY_EMAIL','RESET_PASSWORD')),
	CONSTRAINT "account_mail_outbox_status_check" CHECK ("account_mail_outbox"."status" in ('PENDING','LEASED','ACCEPTED','CANCELLED','DEAD')),
	CONSTRAINT "account_mail_outbox_attempts_check" CHECK ("account_mail_outbox"."attempt_count" >= 0 AND "account_mail_outbox"."format_version" > 0),
	CONSTRAINT "account_mail_outbox_lease_check" CHECK (("account_mail_outbox"."status" = 'LEASED' AND "account_mail_outbox"."lease_owner" IS NOT NULL AND "account_mail_outbox"."lease_token" IS NOT NULL AND "account_mail_outbox"."lease_expires_at" IS NOT NULL) OR ("account_mail_outbox"."status" <> 'LEASED' AND "account_mail_outbox"."lease_owner" IS NULL AND "account_mail_outbox"."lease_token" IS NULL AND "account_mail_outbox"."lease_expires_at" IS NULL)),
	CONSTRAINT "account_mail_outbox_payload_check" CHECK (("account_mail_outbox"."status" in ('PENDING','LEASED') AND "account_mail_outbox"."payload_nonce" IS NOT NULL AND "account_mail_outbox"."payload_ciphertext" IS NOT NULL AND "account_mail_outbox"."payload_auth_tag" IS NOT NULL) OR ("account_mail_outbox"."status" not in ('PENDING','LEASED') AND "account_mail_outbox"."payload_nonce" IS NULL AND "account_mail_outbox"."payload_ciphertext" IS NULL AND "account_mail_outbox"."payload_auth_tag" IS NULL)),
	CONSTRAINT "account_mail_outbox_accepted_check" CHECK (("account_mail_outbox"."status" = 'ACCEPTED' AND "account_mail_outbox"."accepted_at" IS NOT NULL) OR ("account_mail_outbox"."status" <> 'ACCEPTED' AND "account_mail_outbox"."accepted_at" IS NULL)),
	CONSTRAINT "account_mail_outbox_error_category_check" CHECK ("account_mail_outbox"."last_error_category" IS NULL OR "account_mail_outbox"."last_error_category" in ('SUPERSEDED','TOKEN_USED','TOKEN_EXPIRED','USER_INELIGIBLE','DECRYPTION_FAILED','TRANSPORT_FAILURE','RETRY_EXHAUSTED'))
);
--> statement-breakpoint
ALTER TABLE "account_mail_outbox" ADD CONSTRAINT "account_mail_outbox_action_token_id_account_action_tokens_id_fk" FOREIGN KEY ("action_token_id") REFERENCES "public"."account_action_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_mail_outbox_action_token_idx" ON "account_mail_outbox" USING btree ("action_token_id");--> statement-breakpoint
CREATE INDEX "account_mail_outbox_due_idx" ON "account_mail_outbox" USING btree ("status","next_attempt_at","lease_expires_at");
