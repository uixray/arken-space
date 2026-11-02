CREATE TABLE "bug_intake_update_actions" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "action_id" uuid NOT NULL CONSTRAINT "bug_intake_update_actions_action_id_unique" UNIQUE,
 "update_row_id" uuid NOT NULL,
 "operator_membership_id" uuid NOT NULL,
 "action" text NOT NULL, "request_hash" text NOT NULL, "receipt" jsonb NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "bug_intake_update_actions_update_row_id_bug_intake_updates_id_fk" FOREIGN KEY ("update_row_id") REFERENCES "public"."bug_intake_updates"("id") ON DELETE restrict ON UPDATE no action,
 CONSTRAINT "bug_intake_update_actions_operator_membership_id_memberships_id_fk" FOREIGN KEY ("operator_membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "bug_intake_update_actions_row_idx" ON "bug_intake_update_actions" USING btree ("update_row_id","created_at");
