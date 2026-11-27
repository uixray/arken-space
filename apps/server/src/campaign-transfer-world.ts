import {sql} from "drizzle-orm";
/** GM-only source roots. Canonical world data is shared, not campaign-owned:
 * include the campaign's graph plus explicit GM selections, never every row. */
export function campaignTransferWorldGraph(campaignId:string,selectedIds:readonly string[]){
 const uuid="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
 return sql`WITH RECURSIVE roots(id) AS (
  SELECT world_content_id FROM world_content_instances WHERE campaign_id=${campaignId}
  UNION SELECT canonical_location_id FROM world_map_locations WHERE campaign_id=${campaignId} AND canonical_location_id IS NOT NULL
  UNION SELECT region_id FROM economy_merchants WHERE campaign_id=${campaignId}
  UNION SELECT jsonb_array_elements_text(${JSON.stringify(selectedIds)}::jsonb)::uuid
 ), edges(origin,target) AS (
  SELECT id,region_id FROM world_content WHERE region_id IS NOT NULL
  UNION SELECT from_world_content_id,to_world_content_id FROM world_content_relations
  UNION SELECT to_world_content_id,from_world_content_id FROM world_content_relations
  UNION SELECT w.id,(match[1])::uuid FROM world_content w CROSS JOIN LATERAL regexp_matches(w.public_text||' '||w.gm_only_text,${"[?&]article=("+uuid+")"},'g') AS match
 ), selected(id) AS (
  SELECT id FROM roots WHERE id IS NOT NULL
  UNION SELECT e.target FROM selected s JOIN edges e ON e.origin=s.id
 ) SELECT w.id FROM selected s JOIN world_content w ON w.id=s.id LIMIT 1000001`;
}
