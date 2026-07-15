CREATE SEQUENCE "chat_messages_sequence_seq";
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "sequence" bigint;
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at" ASC, "id" ASC) AS "sequence"
  FROM "chat_messages"
)
UPDATE "chat_messages"
SET "sequence" = ranked."sequence"
FROM ranked
WHERE "chat_messages"."id" = ranked."id";
--> statement-breakpoint
DO $$
DECLARE maximum_sequence bigint;
BEGIN
  SELECT max("sequence") INTO maximum_sequence FROM "chat_messages";
  IF maximum_sequence IS NULL THEN
    PERFORM setval('chat_messages_sequence_seq', 1, false);
  ELSE
    PERFORM setval('chat_messages_sequence_seq', maximum_sequence, true);
  END IF;
END $$;
--> statement-breakpoint
ALTER SEQUENCE "chat_messages_sequence_seq" OWNED BY "chat_messages"."sequence";
--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "sequence" SET DEFAULT nextval('chat_messages_sequence_seq');
--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "sequence" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "chat_campaign_created_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_sequence_idx" ON "chat_messages" USING btree ("sequence");
--> statement-breakpoint
CREATE INDEX "chat_campaign_sequence_idx" ON "chat_messages" USING btree ("campaign_id","sequence");
