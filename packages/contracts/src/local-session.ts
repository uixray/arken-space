import { z } from "zod";
import type { GameSnapshot,StoryPostPageDto } from "./index.js";

export const localAuthoritySchema=z.object({
  campaignId:z.string().uuid(),sessionId:z.string().uuid(),hostId:z.string().uuid(),
  epoch:z.number().int().min(1).max(2147483647),
}).strict();
export const localPeerBindingSchema=z.object({
  campaignId:z.string().uuid(),deviceId:z.string().uuid(),sessionId:z.string().uuid(),
  epoch:z.number().int().min(1).max(2147483647),
  credential:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const cloudTransferProofSchema=z.object({manifestSha256:z.string().regex(/^[a-f0-9]{64}$/),baselineSequence:z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(v=>BigInt(v)<=9223372036854775807n),schemaDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type CloudTransferProof=z.infer<typeof cloudTransferProofSchema>;
export const localOutboxCoverageSchema=z.object({
 status:z.enum(["NOT_IMPORTED","BASELINE_UNKNOWN","BUSY","COVERED","MISSING_EVENTS","INTEGRITY_CONFLICT","EVENT_TOO_LARGE","LIMIT_REACHED"]),
 checkedEvents:z.number().int().min(0).max(1000000),
 baselineSequence:cloudTransferProofSchema.shape.baselineSequence.optional(),
 throughSequence:cloudTransferProofSchema.shape.baselineSequence.optional(),
 firstProblemSequence:cloudTransferProofSchema.shape.baselineSequence.optional(),
}).strict().superRefine((v,ctx)=>{
 const scanned=!["NOT_IMPORTED","BASELINE_UNKNOWN","BUSY"].includes(v.status);
 if(scanned&&(!v.baselineSequence||!v.throughSequence))ctx.addIssue({code:"custom",message:"COVERAGE_BOUNDS_REQUIRED"});
 if(v.baselineSequence&&v.throughSequence&&BigInt(v.baselineSequence)>BigInt(v.throughSequence))ctx.addIssue({code:"custom",message:"COVERAGE_BOUNDS_INVALID"});
});
export type LocalOutboxCoverage=z.infer<typeof localOutboxCoverageSchema>;

export const cloudSourceDescriptorSchema=localAuthoritySchema.extend({transferProof:cloudTransferProofSchema.optional()}).strict();
export type LocalAuthority=z.infer<typeof localAuthoritySchema>;
export type LocalPeerBinding=z.infer<typeof localPeerBindingSchema>;
export type LocalPeerAck=
  | {ok:true;status:"APPLIED"|"DUPLICATE";sequence:number}
  | {ok:false;reason:"ACTION_CONFLICT"|"CAMPAIGN_PAUSED"|"TOKEN_FORBIDDEN"|"STALE_REVISION"|"MOVEMENT_FORBIDDEN"};
export type LocalAssetChunk={assetId:string;variant?:"poster";offset:number;total:number;version:string;mimeType:string;base64:string;sha256:string};
export type LocalCanvasHistoryEntry={sequence:number;actorMembershipId:string;type:string;targetType:string;targetId:string;status:string;createdAt:Date|string;nextDirection:"undo"|"redo"|null};
export type LocalPeerResponse={commandError?:z.infer<typeof import("./index.js").localCommandErrorSchema>;areaResult?:z.infer<typeof import("./index.js").abilityAreaResultSchema>;applicationUndo?:{ok:true}|{duplicate:true};characterCounters?:import("./index.js").CharacterDto;entryRoll?:Record<string,unknown>;entryRecharge?:Record<string,unknown>;upload?:{uploadId:string;nextOffset:number;attachment?:import("./index.js").ChatAttachmentMetadata};authority:LocalAuthority;ack?:LocalPeerAck;snapshot:GameSnapshot;soundpad?:{packs:import("./soundpad.js").SoundpadPackDto[];playerPlaybackEnabled:boolean};canvasHistory?:LocalCanvasHistoryEntry[];mediaRevision?:string;storyFingerprint?:string|null;storyPage?:StoryPostPageDto;assetChunk?:LocalAssetChunk;chatResult?:import("./index.js").ChatMessageDto|{duplicate:true};directThread?:import("./index.js").DirectChatThreadDto;chatHistory?:{messages:import("./index.js").ChatMessageDto[];hasMore:boolean};chatReadCursor?:import("./index.js").ChatReadCursorDto};

export const localPreviewPollSchema=z.object({kind:z.literal("PREVIEW_POLL"),peer:localPeerBindingSchema,cursor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict();
export type LocalPreviewEvent=
 | {kind:"MOVING";movement:Parameters<import("./index.js").ServerToClientEvents["token:moving"]>[0]}
 | {kind:"HIDDEN";event:Parameters<import("./index.js").ServerToClientEvents["token:preview-hidden"]>[0]};
export type LocalPreviewBatch={authority:LocalAuthority;membershipId:string;epoch:string;cursor:number;reset:boolean;events:LocalPreviewEvent[]};

export type LocalPreviewAccepted={authority:LocalAuthority;membershipId:string;accepted:boolean};

/** Owner-only aggregate. Never expose outbox payloads or imply cloud ACK. */
export const localOutboxStatusSchema=z.object({pendingEvents:z.number().int().min(0).max(100000),limited:z.boolean(),delivery:z.literal("NOT_CONFIGURED")}).strict();

export const localCloudHistorySchema=z.object({entries:z.array(z.object({streamId:z.string().uuid(),originId:z.string().uuid(),target:z.string().url(),appliedThrough:cloudTransferProofSchema.shape.baselineSequence.refine(v=>BigInt(v)>0n)}).strict()).max(20),next:z.string().uuid().nullable()}).strict();

export const localCloudConnectionStatusSchema=z.object({canSend:z.boolean().optional(),history:localCloudHistorySchema.optional(),state:z.enum(["UNAVAILABLE","DISCONNECTED","READY","RECONNECT_REQUIRED"]),target:z.string().url().nullable(),expiresAt:z.string().datetime().nullable(),storedThrough:z.string().regex(/^[1-9][0-9]{0,18}$/).nullable().optional(),appliedThrough:z.string().regex(/^[1-9][0-9]{0,18}$/).nullable().optional()}).strict();

export const localCloudSendResultSchema=z.object({state:z.enum(["EMPTY","STORED_ONLY"]),sentEvents:z.number().int().min(0).max(32),storedThrough:z.string().regex(/^[1-9][0-9]{0,18}$/).nullable()}).strict();

export const localCloudGrantSchema=z.object({grantId:z.string().uuid(),originId:z.string().uuid(),origin:localAuthoritySchema,token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:z.string().datetime(),scope:z.enum(["STAGING_ONLY","READ_RECEIPTS_ONLY"])}).strict();

export const localCloudScopeCursorSchema=z.object({epoch:z.number().int().min(1).max(2147483647),sessionId:z.string().uuid()}).strict();
export const localCloudScopesSchema=z.object({scopes:z.array(z.object({authority:localAuthoritySchema,pendingEvents:z.number().int().min(1).max(100000),limited:z.boolean()}).strict()).max(20),next:localCloudScopeCursorSchema.nullable()}).strict();

const cloudSyncExactSequence=cloudTransferProofSchema.shape.baselineSequence;
export const cloudSyncStatusCursorSchema=z.object({lastSequence:cloudSyncExactSequence,receiptId:z.string().uuid()}).strict();
export const cloudSyncSourceStatusSchema=z.object({
 originId:z.string().uuid(),
 writer:z.object({mode:z.enum(["HOSTED","LOCAL"]),revision:cloudSyncExactSequence,isSelectedSource:z.boolean()}).strict(),
 source:z.object({closed:z.boolean(),archiveRecognized:z.boolean(),receivedThrough:cloudSyncExactSequence.nullable(),appliedThrough:cloudSyncExactSequence.nullable()}).strict(),
 receipts:z.array(z.object({receiptId:z.string().uuid(),batchHash:z.string().regex(/^[a-f0-9]{64}$/),lastSequence:cloudSyncExactSequence,state:z.enum(["STORED_ONLY","APPLIED"])}).strict()).max(20),
 next:cloudSyncStatusCursorSchema.nullable(),
}).strict();

const cloudAppliedSequence=cloudSyncExactSequence.refine(v=>BigInt(v)>0n);
export const cloudAppliedReceiptSchema=z.object({status:z.literal("APPLIED"),originId:z.string().uuid(),receiptId:z.string().uuid(),batchHash:z.string().regex(/^[a-f0-9]{64}$/),lastSequence:cloudAppliedSequence,writerRevision:cloudAppliedSequence,mappings:z.array(z.object({sourceSequence:cloudAppliedSequence,cloudSequence:cloudAppliedSequence,actionId:z.string().uuid()}).strict()).min(1).max(64)}).strict().superRefine((r,ctx)=>{
 const actions=new Set<string>();let source=0n,cloud=0n;
 for(const m of r.mappings){if(BigInt(m.sourceSequence)<=source||BigInt(m.cloudSequence)<=cloud||actions.has(m.actionId))ctx.addIssue({code:"custom",message:"APPLICATION_MAPPING_INVALID"});source=BigInt(m.sourceSequence);cloud=BigInt(m.cloudSequence);actions.add(m.actionId);}
 if(r.mappings.at(-1)?.sourceSequence!==r.lastSequence)ctx.addIssue({code:"custom",message:"APPLICATION_LAST_SEQUENCE_INVALID"});
});

export const localCloudCheckResultSchema=z.object({state:z.enum(["EMPTY","WAITING","APPLIED"]),appliedEvents:z.number().int().min(0).max(64),appliedThrough:cloudTransferProofSchema.shape.baselineSequence.nullable()}).strict();
