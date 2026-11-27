import {transferEncounterEventTypes,encounterEventEntities} from "./campaign-transfer-encounter-events.js";
import {transferMediaEventTypes,mediaEventEntities} from "./campaign-transfer-media-events.js";
import {transferControlEventTypes,controlEventEntities} from "./campaign-transfer-control-events.js";
import {transferMagicAwardEventTypes,magicAwardEventEntities} from "./campaign-transfer-magic-award-events.js";
import {transferWorldMapEventTypes,worldMapEventEntities} from "./campaign-transfer-world-map-events.js";
import {transferNarrativeEventTypes,narrativeEventEntities} from "./campaign-transfer-narrative-events.js";
import {transferCommerceEventTypes,commerceEventEntities} from "./campaign-transfer-commerce-events.js";
import {transferCharacterEventTypes,characterEventEntities} from "./campaign-transfer-character-events.js";
import {transferCanvasEventTypes,canvasEventEntities} from "./campaign-transfer-canvas-events.js";
import {transferApplicationEventTypes} from './campaign-transfer-application-events.js';
import {transferChatDeliveryTypes} from './campaign-transfer-chat-events.js';
const transferEventHandlers=new Map<string,{entityTypes:readonly string[];reader:'readEncounterEvents'|'readApplicationEvents'|'readChatDeliveryEvents'|'readCanvasEvents'|'readCharacterEvents'|'readCommerceEvents'|'readNarrativeEvents'|'readWorldMapEvents'|'readMagicAwardEvents'|'readControlEvents'|'readMediaEvents'}>([
 ...transferApplicationEventTypes.map(type=>[type,{entityTypes:['chat'],reader:'readApplicationEvents'}] as const),
 ...transferChatDeliveryTypes.map(type=>[type,{entityTypes:['chat'],reader:'readChatDeliveryEvents'}] as const),
 ...transferCanvasEventTypes.map(type=>[type,{entityTypes:canvasEventEntities(type),reader:"readCanvasEvents"}] as const),
 ...transferCharacterEventTypes.map(type=>[type,{entityTypes:characterEventEntities(type),reader:"readCharacterEvents"}] as const),
 ...transferCommerceEventTypes.map(type=>[type,{entityTypes:commerceEventEntities(type),reader:"readCommerceEvents"}] as const),
 ...transferNarrativeEventTypes.map(type=>[type,{entityTypes:narrativeEventEntities(type),reader:"readNarrativeEvents"}] as const),
 ...transferWorldMapEventTypes.map(type=>[type,{entityTypes:worldMapEventEntities(type),reader:"readWorldMapEvents"}] as const),
 ...transferMagicAwardEventTypes.map(type=>[type,{entityTypes:magicAwardEventEntities(type),reader:"readMagicAwardEvents"}] as const),
 ...transferControlEventTypes.map(type=>[type,{entityTypes:controlEventEntities(type),reader:"readControlEvents"}] as const),
 ...transferEncounterEventTypes.map(type=>[type,{entityTypes:encounterEventEntities(type),reader:"readEncounterEvents"}] as const),
 ...transferMediaEventTypes.map(type=>[type,{entityTypes:mediaEventEntities(type),reader:"readMediaEvents"}] as const),
]);
export type TransferEventGroup={type:string;entityType:string;count:string};
export function inspectTransferEventCoverage(groups:readonly TransferEventGroup[]){
 const supported:TransferEventGroup[]=[],unsupported:TransferEventGroup[]=[];let count=0n;
 for(const group of groups){if(!/^(0|[1-9][0-9]*)$/.test(group.count))throw Error('CAMPAIGN_TRANSFER_EVENT_COUNT_INVALID');count+=BigInt(group.count);const handler=transferEventHandlers.get(group.type);(handler?.entityTypes.includes(group.entityType)?supported:unsupported).push({...group});}
 return {totalRows:count.toString(),supported,unsupported};
}
export function assertTransferEventCoverage(groups:readonly TransferEventGroup[]){const result=inspectTransferEventCoverage(groups);if(result.unsupported.length)throw Error('CAMPAIGN_TRANSFER_EVENT_HANDLER_REQUIRED');return result;}

/** Capture dispatch derives from the same registry as the full-source gate. */
export const campaignTransferEventReaderNames=()=>[...new Set([...transferEventHandlers.values()].map(handler=>handler.reader))];

export function campaignTransferEventReader(type:string,entityType:string){const handler=transferEventHandlers.get(type);return handler?.entityTypes.includes(entityType)?handler.reader:undefined;}
