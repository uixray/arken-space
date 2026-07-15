ALTER TABLE "campaigns" ADD COLUMN "day" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "battle_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "battle_counter" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "wallet" jsonb DEFAULT '{"gold":0,"silver":0,"copper":0,"sp":0}'::jsonb NOT NULL;