import {sql} from "drizzle-orm";
import type {SQL} from "drizzle-orm";
import type {AuthContext} from "./auth.js";
/** Pure SQL selectors; only the already-authorized transfer snapshot executes
 * these. A published global library is not copied wholesale into every campaign. */
export function campaignTransferStickerSelectors(auth:AuthContext,messageFilter:SQL,globalEnabled:boolean){
 const packs=sql`SELECT id FROM sticker_packs WHERE campaign_id=${auth.campaignId} AND (subject<>'PLAYER' OR EXISTS(SELECT 1 FROM player_likeness_consents c WHERE c.campaign_id=${auth.campaignId} AND c.pack_id=sticker_packs.id AND c.membership_id=sticker_packs.subject_membership_id AND c.status='GRANTED'))`;
 const items=sql`SELECT id FROM stickers WHERE campaign_id=${auth.campaignId} AND pack_id IN (${packs})`;
 const media=sql`SELECT media_id FROM stickers WHERE campaign_id=${auth.campaignId} AND id IN (${items})`;
 const referenced=sql`SELECT global_sticker_id FROM chat_messages WHERE ${messageFilter} AND global_sticker_id IS NOT NULL`;
 const globalItems=sql`SELECT gs.id FROM global_stickers gs JOIN global_sticker_packs gp ON gp.id=gs.pack_id WHERE (gp.creator_membership_id=${auth.membershipId} AND ${globalEnabled}) OR (gp.lifecycle IN ('ACTIVE','DEPRECATED') AND gs.id IN (${referenced}))`;
 const globalPacks=sql`SELECT pack_id FROM global_stickers WHERE id IN (${globalItems}) UNION SELECT id FROM global_sticker_packs WHERE creator_membership_id=${auth.membershipId} AND ${globalEnabled}`;
 const globalMedia=sql`SELECT media_id FROM global_stickers WHERE id IN (${globalItems})`;
 return {packs,items,media,globalItems,globalPacks,globalMedia};
}
