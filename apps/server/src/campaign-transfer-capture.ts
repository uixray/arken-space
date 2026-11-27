import {campaignTransferEventReaderNames} from "./campaign-transfer-event-coverage.js";
import {campaignTransferPolicies,type CampaignTransferTable} from './campaign-transfer-policy.js';
import {creationTransferTables,nonReplayableQuoteTables} from './campaign-transfer-creation.js';
import type {CampaignTransferSource,TransferPage,TransferRows} from './campaign-transfer-source.js';
type Result=TransferRows&{redactions?:unknown[];references?:unknown;contents?:unknown[];journalSequences?:string[]};
type Reader={name:string;read:(page:TransferPage)=>Promise<Result>};
/** Explicit routing only. Never falls back to a generic query for protected data. */
export function campaignTransferTableReaders(source:CampaignTransferSource,table:CampaignTransferTable):Reader[]{
 const policy=campaignTransferPolicies[table];if(!policy)throw Error('CAMPAIGN_TRANSFER_TABLE_UNKNOWN');
 const one=(name:string,read:Reader['read'])=>[{name,read}];
 if(policy==='EXCLUDED_AUTH_RUNTIME')return [];
 if(policy==='ROOT'||policy==='CAMPAIGN_ROWS')return one('readOwnedRows',p=>source.readOwnedRows(table,p));
 if(table==='memberships')return one('readParticipants',p=>source.readParticipants(p));
 if(table==='game_events')return campaignTransferEventReaderNames().map(name=>({name,read:p=>source[name](p)}));
 if(table==='action_journal')return one('readActionJournal',p=>source.readActionJournal(p));
 if(table==='world_content_actions')return one('readWorldHistory',p=>source.readWorldHistory(p));
 if(table==='chat_messages')return one('readChatMessages',p=>source.readChatMessages(p));
 if(table==='chat_attachments')return one('readChatAttachments',p=>source.readChatAttachments(p));
 if(table==='chat_threads'||table==='chat_read_cursors'||table==='character_private_notebooks'||table==='player_requests')return one('readMemberRows',p=>source.readMemberRows(table,p));
 if(table==='world_content'||table==='world_content_media'||table==='world_content_relations'||table==='world_content_images')return one('readWorldRows',p=>source.readWorldRows(table,p));
 if(table==='sticker_packs'||table==='stickers'||table==='sticker_media'||table==='sticker_pack_entitlements'||table==='player_likeness_consents'||table==='global_sticker_packs'||table==='global_stickers'||table==='global_sticker_media')return one('readStickerRows',p=>source.readStickerRows(table,p));
 if(table==='character_catalog_entries'||table==='character_controllers'||table==='drawings'||table==='fog_reveals'||table==='token_controllers'||table==='tokens')return one('readRelatedRows',p=>source.readRelatedRows(table,p));
 if((nonReplayableQuoteTables as readonly string[]).includes(table))return one('readNonReplayableQuotes',p=>source.readNonReplayableQuotes(table as Parameters<CampaignTransferSource['readNonReplayableQuotes']>[0],p));
 if((creationTransferTables as readonly string[]).includes(table))return one('readCreationRows',p=>source.readCreationRows(table as Parameters<CampaignTransferSource['readCreationRows']>[0],p));
 throw Error('CAMPAIGN_TRANSFER_CAPTURE_HANDLER_REQUIRED');
}
/** Bounded pages, preserving raw SQL JSON and all reader dependency/projection
 * metadata. Domain groups for game_events are emitted separately, not sorted
 * across groups; explicit sequence values remain authoritative. No package is
 * published and no rows are written to a target database by this iterator. */
export async function* captureCampaignTransferTable(source:CampaignTransferSource,table:CampaignTransferTable){
 const readers=campaignTransferTableReaders(source,table);if(table==='game_events')await source.assertEventCoverage();let rows=0,bytes=0;
 for(const reader of readers){let offset=0;while(true){const result=await reader.read({offset,limit:500});
  if(result.rows.length>500||result.nextOffset!==null&&result.nextOffset!==offset+result.rows.length||result.nextOffset!==null&&!result.rows.length)throw Error('CAMPAIGN_TRANSFER_CAPTURE_PAGE_INVALID');
  rows+=result.rows.length;for(const raw of result.rows)bytes+=Buffer.byteLength(raw)+1;
  if(rows>1000000||bytes>256*1024*1024)throw Error('CAMPAIGN_TRANSFER_CAPTURE_TABLE_LIMIT');
  yield {table,reader:reader.name,result};if(result.nextOffset===null)break;offset=result.nextOffset;
 }}
}
