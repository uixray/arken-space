CREATE TABLE "local_campaign_imports" (
 "id" uuid PRIMARY KEY NOT NULL,
 "instance_id" uuid NOT NULL REFERENCES "local_host_instances"("id"),
 "owner_user_id" uuid NOT NULL REFERENCES "users"("id"),
 "campaign_id" uuid NOT NULL UNIQUE,
 "manifest_sha256" text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
