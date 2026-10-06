CREATE TABLE "public_roadmap_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"voter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_roadmap_votes_item_id_check" CHECK ("public_roadmap_votes"."item_id" in ('floating-ui','service-routine','bestiary-encounters','uix-526','uix-245','uix-382','uix-512','uix-588','uix-625','uix-264','uix-379'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_roadmap_votes_item_voter_idx" ON "public_roadmap_votes" USING btree ("item_id","voter_id");--> statement-breakpoint
CREATE INDEX "public_roadmap_votes_item_idx" ON "public_roadmap_votes" USING btree ("item_id");