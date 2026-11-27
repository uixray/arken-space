import {expect,it} from "vitest";
import {validateTransferWorldHistoryRow} from "./campaign-transfer-world-history.js";
const entity=crypto.randomUUID(),peer=crypto.randomUUID(),id=crypto.randomUUID(),stamp=new Date().toISOString();
const relation={id,fromWorldContentId:entity,toWorldContentId:peer,relationType:"RELATED",note:"GM-only history",revision:0,createdAt:stamp,updatedAt:stamp};
const row={type:"world_content.relation_deleted",entity_type:"world_content_relation",entity_id:id,payload:relation};
it("reports historical relation dependencies even after the live relation disappears",()=>{
 expect(validateTransferWorldHistoryRow(row)).toEqual({articleIds:[entity,peer],imageIds:[]});
});
it("rejects unknown payload fields rather than silently stripping private data",()=>{
 expect(()=>validateTransferWorldHistoryRow({...row,payload:{...relation,unknownPrivatePayload:{secret:"hidden"}}})).toThrow();
});
it("rejects malformed payloads and mismatched entity identity/type",()=>{
 for(const candidate of [{...row,payload:{...relation,fromWorldContentId:"not-an-id"}},{...row,entity_id:entity},{...row,entity_type:"world_content"},{...row,payload:{...relation,revision:"123"}}])expect(()=>validateTransferWorldHistoryRow(candidate)).toThrow();
});
it("rejects unsupported types, rather than exporting opaque ledger data",()=>{
 expect(()=>validateTransferWorldHistoryRow({...row,type:"world_content.future"})).toThrow("TYPE_UNREVIEWED");
});
it("preserves old image references for the future full archive dependency collector",()=>{
 const image=crypto.randomUUID();expect(validateTransferWorldHistoryRow({type:"world_content.media_removed",entity_type:"world_content_media",entity_id:id,payload:{id,worldContentId:entity,assetId:image,caption:null,ordering:0,createdAt:stamp}})).toEqual({articleIds:[entity],imageIds:[image]});
});
