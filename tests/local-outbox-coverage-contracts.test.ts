import {expect,it} from "vitest";
import {localOutboxCoverageSchema,cloudAppliedReceiptSchema} from "@arken/contracts";
it("keeps exact bigint coverage bounds and rejects reversed/incomplete results",()=>{
 const covered={status:"COVERED",checkedEvents:130,baselineSequence:"9007199254740993",throughSequence:"9007199254741253"};
 expect(localOutboxCoverageSchema.parse(covered)).toEqual(covered);
 expect(localOutboxCoverageSchema.safeParse({...covered,throughSequence:"1"}).success).toBe(false);
 expect(localOutboxCoverageSchema.safeParse({status:"COVERED",checkedEvents:1}).success).toBe(false);
 expect(localOutboxCoverageSchema.safeParse({...covered,checkedEvents:1000001}).success).toBe(false);
 expect(localOutboxCoverageSchema.safeParse({...covered,token:"SECRET"}).success).toBe(false);
 expect(localOutboxCoverageSchema.parse({status:"BUSY",checkedEvents:0})).toEqual({status:"BUSY",checkedEvents:0});
});

it("requires complete monotonic exact APPLIED mappings with unique actions",()=>{
 const id="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",proof={status:"APPLIED",originId:id,receiptId:id,batchHash:"a".repeat(64),writerRevision:"9007199254740993",lastSequence:"9007199254740995",mappings:[{sourceSequence:"9007199254740993",cloudSequence:"1",actionId:id},{sourceSequence:"9007199254740995",cloudSequence:"3",actionId:other}]};
 expect(cloudAppliedReceiptSchema.parse(proof)).toEqual(proof);
 for(const wrong of [{...proof,mappings:[proof.mappings[1],proof.mappings[0]]},{...proof,lastSequence:"9007199254740994"},{...proof,mappings:[proof.mappings[0],{...proof.mappings[1],actionId:id}]},{...proof,mappings:[proof.mappings[0],{...proof.mappings[1],cloudSequence:"1"}]}])expect(cloudAppliedReceiptSchema.safeParse(wrong).success).toBe(false);
});
