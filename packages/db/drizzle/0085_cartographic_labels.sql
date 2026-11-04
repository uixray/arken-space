-- Optional presentation only; existing rows preserve their plain labels.
ALTER TABLE scenes ADD COLUMN title_label jsonb;
--> statement-breakpoint
ALTER TABLE world_map_locations ADD COLUMN label jsonb;
