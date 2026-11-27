import {and,eq,sql} from "drizzle-orm";
import {characters,chatMessages,gameEvents} from "@arken/db";
import {createChatMessageSchema} from "@arken/contracts";
import type {AuthContext} from "./auth.js";
import {resolveChatThread,canPostToStream,chatMessageDto} from "./chat.js";
import {canAccessCharacter} from "./character-access.js";
import {findAction} from "./action-lookup.js";
type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];
export class StreamChatError extends Error {
  constructor(readonly status:403|404|409,code:string){super(code);}
}
/** One transactional command for HTTP and authenticated local peers. */
export async function submitStreamChat(db:Database,auth:AuthContext,input:unknown){
  const body=createChatMessageSchema.parse(input);
  return db.transaction(async transaction=>{
    const tx=transaction as unknown as Database;
    // Same campaign fence as local revoke; also serialize HTTP action retries.
    await tx.execute(sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR UPDATE`);
    let thread;
    try{
      thread=await resolveChatThread(tx,auth,body,["TABLE","STORY"]);
      if(thread.type!=="STREAM"||!thread.stream)throw Error("CHAT_THREAD_NOT_FOUND");
      if(!canPostToStream(auth,thread.stream))throw Error("CHAT_THREAD_FORBIDDEN");
    }catch(error){
      const code=error instanceof Error?error.message:"";
      if(!["CHAT_THREAD_NOT_FOUND","CHAT_THREAD_FORBIDDEN","CHAT_STREAM_FORBIDDEN"].includes(code))throw error;
      throw new StreamChatError(code==="CHAT_THREAD_NOT_FOUND"?404:403,code);
    }
    const duplicate=await findAction(tx,auth.campaignId,body.actionId);
    if(duplicate){
      const saved=duplicate.payload as Record<string,unknown>;
      if(duplicate.type!=="chat.created"||duplicate.membershipId!==auth.membershipId||saved.threadId!==thread.id||saved.body!==body.body||saved.visibility!==body.visibility||(saved.characterId??null)!==(body.characterId??null))throw new StreamChatError(409,"ACTION_ID_CONFLICT");
      return {duplicate:true as const};
    }
    let characterId:string|null=null;
    if(body.characterId){
      const [character]=await tx.select().from(characters).where(and(eq(characters.id,body.characterId),eq(characters.campaignId,auth.campaignId))).limit(1);
      if(!character||!await canAccessCharacter(tx,auth,character))throw new StreamChatError(403,"CHARACTER_FORBIDDEN");
      characterId=character.id;
    }
    const [row]=await tx.insert(chatMessages).values({campaignId:auth.campaignId,membershipId:auth.membershipId,characterId,threadId:thread.id,body:body.body,visibility:body.visibility}).returning();
    if(!row)throw Error("MESSAGE_CREATE_FAILED");
    const dto=chatMessageDto(row,auth.displayName,thread.stream);
    const [event]=await tx.insert(gameEvents).values({campaignId:auth.campaignId,actionId:body.actionId,membershipId:auth.membershipId,type:"chat.created",entityType:"chat",entityId:row.id,payload:dto}).returning();
    if(!event)throw Error("EVENT_RECORD_FAILED");
    return {duplicate:false as const,row,dto,event};
  });
}
