ALTER TABLE "users" ALTER COLUMN "email_normalized" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "email_display" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "identity_kind" text DEFAULT 'EMAIL' NOT NULL;
ALTER TABLE "users" ADD COLUMN "local_instance_id" uuid;
ALTER TABLE "users" ADD COLUMN "local_login" text;
ALTER TABLE "users" ADD COLUMN "local_approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_identity_check" CHECK (
  ("identity_kind" = 'EMAIL' AND "email_normalized" IS NOT NULL AND "email_display" IS NOT NULL
   AND "local_instance_id" IS NULL AND "local_login" IS NULL AND "local_approved_at" IS NULL)
  OR
  ("identity_kind" = 'LOCAL' AND "email_normalized" IS NULL AND "email_display" IS NULL AND "verified_at" IS NULL
   AND "local_instance_id" IS NOT NULL AND "local_login" IS NOT NULL AND "local_approved_at" IS NOT NULL)
);
CREATE UNIQUE INDEX "users_local_login_idx" ON "users" ("local_instance_id", "local_login");
--> statement-breakpoint
CREATE TABLE "local_host_instances" (
  "singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
  "id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "local_host_instances_id_unique" UNIQUE ("id"),
  CONSTRAINT "local_host_instances_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "local_host_singleton_check" CHECK ("singleton" = true)
);
