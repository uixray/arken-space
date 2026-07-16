WITH ranked_assignments AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY character_id, source_catalog_entry_id
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM character_catalog_entries
  WHERE source_catalog_entry_id IS NOT NULL
)
UPDATE character_catalog_entries AS entry
SET source_catalog_entry_id = NULL
FROM ranked_assignments
WHERE entry.id = ranked_assignments.id
  AND ranked_assignments.duplicate_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "character_catalog_source_unique" ON "character_catalog_entries" USING btree ("character_id","source_catalog_entry_id");
