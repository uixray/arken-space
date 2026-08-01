CREATE TABLE "character_controllers" (
 "character_id" uuid NOT NULL,
 "membership_id" uuid NOT NULL,
 "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_controllers" ADD CONSTRAINT "character_controllers_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "character_controllers" ADD CONSTRAINT "character_controllers_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "character_controllers_character_member_idx" ON "character_controllers" USING btree ("character_id","membership_id");
--> statement-breakpoint
CREATE INDEX "character_controllers_membership_idx" ON "character_controllers" USING btree ("membership_id");
--> statement-breakpoint
INSERT INTO "character_controllers" ("character_id", "membership_id") SELECT "id", "owner_membership_id" FROM "characters" WHERE "owner_membership_id" IS NOT NULL ON CONFLICT ("character_id", "membership_id") DO NOTHING;
