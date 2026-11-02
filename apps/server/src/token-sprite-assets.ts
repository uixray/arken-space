import { sql } from "drizzle-orm";
import { tokenDefinitions } from "@arken/db";

/** Shared by deletion, replacement and usage reporting; no raw JSON text match. */
export function spriteReferencesAsset(assetId: string) {
  return sql<boolean>`coalesce(${tokenDefinitions.spriteSet}->'frames', '[]'::jsonb)
    @> jsonb_build_array(jsonb_build_object('assetId', ${assetId}::text))`;
}
