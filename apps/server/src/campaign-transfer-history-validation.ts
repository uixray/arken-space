import {campaignTransferEventReader,campaignTransferEventReaderNames} from './campaign-transfer-event-coverage.js';
import {validateTransferApplicationEvent} from './campaign-transfer-application-events.js';import {validateTransferChatDelivery} from './campaign-transfer-chat-events.js';import {validateTransferCanvasEvent} from './campaign-transfer-canvas-events.js';import {validateTransferCharacterEvent} from './campaign-transfer-character-events.js';import {validateTransferCommerceEvent} from './campaign-transfer-commerce-events.js';import {validateTransferNarrativeEvent} from './campaign-transfer-narrative-events.js';import {validateTransferWorldMapEvent} from './campaign-transfer-world-map-events.js';import {validateTransferMagicAwardEvent} from './campaign-transfer-magic-award-events.js';import {validateTransferControlEvent} from './campaign-transfer-control-events.js';import {validateTransferMediaEvent} from './campaign-transfer-media-events.js';import {validateTransferEncounterEvent} from './campaign-transfer-encounter-events.js';
import {validateTransferJournalRow} from './campaign-transfer-journal.js';import {validateTransferWorldHistoryRow} from './campaign-transfer-world-history.js';
const validators:Record<ReturnType<typeof campaignTransferEventReaderNames>[number],(event:Record<string,unknown>)=>unknown>={
 readApplicationEvents:validateTransferApplicationEvent,
 readChatDeliveryEvents:event=>{const dto=validateTransferChatDelivery(event.payload);if(typeof event.entity_id!=='string'||dto.id.toLowerCase()!==event.entity_id.toLowerCase())throw Error('CAMPAIGN_TRANSFER_CHAT_EVENT_IDENTITY');return dto;},
 readCanvasEvents:validateTransferCanvasEvent,readCharacterEvents:validateTransferCharacterEvent,readCommerceEvents:validateTransferCommerceEvent,readNarrativeEvents:validateTransferNarrativeEvent,readWorldMapEvents:validateTransferWorldMapEvent,readMagicAwardEvents:validateTransferMagicAwardEvent,readControlEvents:validateTransferControlEvent,readMediaEvents:validateTransferMediaEvent,readEncounterEvents:validateTransferEncounterEvent,
};
/** Repeat typed payload validation on package input, not just trusted capture.
 * Parsed values are validation-only; raw bigint-bearing JSON remains untouched.
 * Cross-row history/receipt/ACL bindings require further closure validation. */
export function validateCampaignTransferHistoryRow(table:string,row:Record<string,unknown>,exactRow?:Record<string,unknown>){
 if(table==='game_events'){
  if(typeof row.type!=='string'||typeof row.entity_type!=='string')throw Error('CAMPAIGN_TRANSFER_EVENT_HEADER_INVALID');
  const reader=campaignTransferEventReader(row.type,row.entity_type);if(!reader)throw Error('CAMPAIGN_TRANSFER_EVENT_HANDLER_REQUIRED');let validationRow=row;
  if(row.type==='canvas.undo'||row.type==='canvas.redo'){
   const payload=(exactRow?.payload??row.payload) as Record<string,unknown>|null,sequence=payload?.journalSequence;
   if(typeof sequence==='bigint')validationRow={...row,payload:{...(row.payload as Record<string,unknown>),journalSequence:sequence.toString()}};
   else if(typeof sequence==='number'&&!Number.isSafeInteger(sequence))throw Error('CAMPAIGN_TRANSFER_JOURNAL_SEQUENCE_PRECISION');
  }
  validators[reader](validationRow);
 }else if(table==='action_journal')validateTransferJournalRow(row);
 else if(table==='world_content_actions')validateTransferWorldHistoryRow(row);
}
