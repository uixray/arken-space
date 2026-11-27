import {createHash} from 'node:crypto';import {z} from 'zod';import {validateTransferChatDelivery,transferInspirationReferences} from './campaign-transfer-chat-events.js';
/** Current GM export ACL plus immutable delivery/current-message consistency.
 * Historical unknown audience IDs are retained, not bound to new accounts. */
export function createCampaignTransferChatClosure(ownerMembershipId:string){
 const owner=ownerMembershipId.toLowerCase(),threads=new Map<string,{direct:boolean;stream:unknown;a:unknown;b:unknown}>(),messages=new Map<string,{thread:string;member:string;bodyHash:string;visibility:unknown;references:string[];request:unknown}>(),events:{message:string;thread:string;member:string;bodyHash:string;visibility:unknown;stream:unknown;references:string[]}[]=[],requests=new Set<string>(),cursors:string[]=[];let closed=false,entries=0;
 const uuid=(value:unknown)=>z.string().uuid().parse(value).toLowerCase(),bodyHash=(value:unknown)=>createHash('sha256').update(z.string().parse(value)).digest('hex');
 const run=(action:()=>void)=>{if(closed)throw Error('CAMPAIGN_TRANSFER_CHAT_CLOSURE_CLOSED');try{action();}catch(error){closed=true;throw error;}};
 const charge=()=>{if(++entries>1000000)throw Error('CAMPAIGN_TRANSFER_CHAT_CLOSURE_LIMIT');};
 return {
  addRow(table:string,row:Record<string,unknown>){run(()=>{
   if(table==='chat_threads'){charge();const direct=row.type==='DIRECT',a=row.participant_a_membership_id,b=row.participant_b_membership_id;if(direct&&(typeof a!=='string'||typeof b!=='string'||uuid(a)!==owner&&uuid(b)!==owner))throw Error('CAMPAIGN_TRANSFER_PEER_DM_FORBIDDEN');threads.set(uuid(row.id),{direct,stream:row.stream,a,b});}
   else if(table==='chat_messages'){charge();if(row.sticker_viewer_membership_ids!==null){const audience=z.array(z.string().uuid()).parse(row.sticker_viewer_membership_ids);if(!audience.some(id=>id.toLowerCase()===owner))throw Error('CAMPAIGN_TRANSFER_CHAT_AUDIENCE_FORBIDDEN');}
    const references=transferInspirationReferences(row.dice).map(uuid);if(row.inspiration_source_message_id!==null)references.push(uuid(row.inspiration_source_message_id));messages.set(uuid(row.id),{thread:uuid(row.thread_id),member:uuid(row.membership_id),bodyHash:bodyHash(row.body),visibility:row.visibility,references,request:row.player_request_id});
   }else if(table==='player_requests'){charge();requests.add(uuid(row.id));}
   else if(table==='chat_read_cursors'){charge();if(uuid(row.membership_id)!==owner)throw Error('CAMPAIGN_TRANSFER_PRIVATE_CURSOR_FORBIDDEN');cursors.push(uuid(row.thread_id));}
   else if(table==='character_private_notebooks'&&uuid(row.author_membership_id)!==owner)throw Error('CAMPAIGN_TRANSFER_PRIVATE_NOTEBOOK_FORBIDDEN');
   else if(table==='game_events'&&(row.type==='chat.created'||row.type==='dice.created')){charge();const dto=validateTransferChatDelivery(row.payload);if(uuid(row.entity_id)!==uuid(dto.id))throw Error('CAMPAIGN_TRANSFER_CHAT_EVENT_IDENTITY');events.push({message:uuid(dto.id),thread:uuid(dto.threadId),member:uuid(dto.membershipId),bodyHash:bodyHash(dto.body),visibility:dto.visibility,stream:dto.stream,references:transferInspirationReferences(dto).map(uuid)});}
  });},
  finish(){if(closed)throw Error('CAMPAIGN_TRANSFER_CHAT_CLOSURE_CLOSED');closed=true;
   for(const message of messages.values()){if(!threads.has(message.thread))throw Error('CAMPAIGN_TRANSFER_CHAT_THREAD_REQUIRED');for(const id of message.references)if(!messages.has(id))throw Error('CAMPAIGN_TRANSFER_CHAT_INSPIRATION_FORBIDDEN');if(message.request!==null&&!requests.has(uuid(message.request)))throw Error('CAMPAIGN_TRANSFER_CHAT_REQUEST_REQUIRED');}
   for(const thread of cursors)if(!threads.has(thread))throw Error('CAMPAIGN_TRANSFER_CHAT_THREAD_REQUIRED');
   for(const event of events){for(const id of event.references)if(!messages.has(id))throw Error('CAMPAIGN_TRANSFER_CHAT_INSPIRATION_FORBIDDEN');const message=messages.get(event.message),thread=threads.get(event.thread);if(!message||!thread||message.thread!==event.thread||message.member!==event.member||message.bodyHash!==event.bodyHash||message.visibility!==event.visibility||event.stream!==(thread.direct?null:thread.stream))throw Error('CAMPAIGN_TRANSFER_CHAT_EVENT_BINDING_INVALID');}
   return {messages:messages.size,events:events.length};
  },
 };
}
