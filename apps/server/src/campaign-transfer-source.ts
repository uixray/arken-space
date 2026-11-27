import {transferEncounterEventTypes,validateTransferEncounterEvent} from "./campaign-transfer-encounter-events.js";
import {validateTransferMediaEvent,transferMediaEventTypes,type MediaEventReferences} from "./campaign-transfer-media-events.js";
import {validateTransferControlEvent,transferControlEventTypes,type ControlEventReferences} from "./campaign-transfer-control-events.js";
import {validateTransferMagicAwardEvent,transferMagicAwardEventTypes} from "./campaign-transfer-magic-award-events.js";
import {validateTransferWorldMapEvent,transferWorldMapEventTypes,type WorldMapEventReferences} from "./campaign-transfer-world-map-events.js";
import {validateTransferNarrativeEvent,transferNarrativeEventTypes,type NarrativeReferences} from "./campaign-transfer-narrative-events.js";
import {creationCancellationReceiptSchema} from "@arken/contracts";
import {validateTransferCommerceEvent,transferCommerceEventTypes,transferCreationEventTypes} from "./campaign-transfer-commerce-events.js";
import {validateTransferCharacterEvent,transferCharacterEventTypes,type CharacterEventReferences} from "./campaign-transfer-character-events.js";
import {validateTransferCanvasEvent,transferCanvasEventTypes,type CanvasEventReferences} from "./campaign-transfer-canvas-events.js";
import {assertTransferEventCoverage,type TransferEventGroup} from "./campaign-transfer-event-coverage.js";
import {validateTransferApplicationEvent,transferApplicationEventTypes,type ApplicationTransferReferences} from "./campaign-transfer-application-events.js";
import {validateTransferChatDelivery,transferChatDeliveryTypes,transferInspirationReferences} from "./campaign-transfer-chat-events.js";
import {validateTransferJournalRow,type JournalTransferReferences} from "./campaign-transfer-journal.js";
import {transferWorldHistoryScope,validateTransferWorldHistoryRow,type WorldHistoryReferences} from "./campaign-transfer-world-history.js";
import {creationTransferTables,nonReplayableQuoteTables,type CreationTransferTable,type NonReplayableQuoteTable} from "./campaign-transfer-creation.js";
import {campaignTransferWorldGraph} from "./campaign-transfer-world.js";
import {campaignTransferStickerSelectors} from "./campaign-transfer-stickers.js";
import {resolve} from "node:path";
import {pinCampaignTransferMedia,type CampaignTransferMediaStage,type TransferMediaFile} from "./campaign-transfer-media.js";
import {fullChatVisibilityFilterWithRequests} from "./chat-history.js";
import {sql,type SQL} from "drizzle-orm";
import {z} from "zod";
import {env} from "./env.js";
import type {AuthContext} from "./auth.js";
import {campaignTransferCatalog,type CampaignTransferTable} from "./campaign-transfer-policy.js";
import {campaignTransferSchemaDigest} from "./campaign-transfer-manifest.js";
type Database=ReturnType<typeof import("@arken/db").createDatabase>["db"];
type TransferSourceTransaction=Parameters<Parameters<Database["transaction"]>[0]>[0];
const page=z.object({offset:z.number().int().min(0).max(1000000).default(0),limit:z.number().int().min(1).max(500).default(100)}).strict();
const forbidden=()=>{throw Error("CAMPAIGN_TRANSFER_FORBIDDEN");};

/** Internal source boundary, never a browser-selected SQL table/connection.
 * expectedMigrations must come from the installed application, not request JSON.
 * No package is published here: special-policy handlers and media pinning must
 * complete before a full transfer can be presented to the owner.
 * Optional transaction is server-internal: caller must provide equivalent
 * snapshot consistency (the handoff caller holds all projection table fences). */
export async function withCampaignTransferSnapshot<T>(db:Database,auth:AuthContext,accountUserId:string,expectedMigrations:readonly string[],capture:(source:CampaignTransferSource)=>Promise<T>,selection:{worldArticleIds?:readonly string[];accountProof?:{sessionId:string;passwordHash:string}}={},transaction?:TransferSourceTransaction):Promise<T>{
 const mode=env.DEPLOYMENT_MODE,instanceId=env.LOCAL_INSTANCE_ID;
 if((mode!=="HOSTED"&&mode!=="LOCAL_HOST")||auth.role!=="GM")forbidden();
 const parsedSelection=z.object({worldArticleIds:z.array(z.string().uuid()).max(1000).optional(),accountProof:z.object({sessionId:z.string().uuid(),passwordHash:z.string().min(1).max(512)}).strict().optional()}).strict().parse(selection);
 const worldArticleIds=[...new Set(parsedSelection.worldArticleIds??[])];
 z.string().uuid().parse(accountUserId);z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(4096).parse(expectedMigrations);
 const readSnapshot=async(tx:TransferSourceTransaction)=>{
  await tx.execute(sql`SET LOCAL statement_timeout='30s'`);
  const campaign=await tx.execute(sql`SELECT id FROM campaigns WHERE id=${auth.campaignId} FOR SHARE`);if(!campaign.length)forbidden();
  if(mode==="LOCAL_HOST"){
   if(!instanceId)forbidden();
   const local=await tx.execute(sql`SELECT i.id FROM local_host_instances i JOIN users u ON u.id=i.owner_user_id WHERE i.id=${instanceId} AND i.owner_user_id=${accountUserId} AND u.identity_kind='LOCAL' AND u.local_instance_id=i.id AND u.local_approved_at IS NOT NULL AND u.disabled_at IS NULL AND u.password_change_required=false FOR SHARE OF i,u`);
   if(local.length!==1)forbidden();
  }
  const identity=mode==="HOSTED"
   ? sql`((u.identity_kind='EMAIL' AND u.verified_at IS NOT NULL) OR (u.identity_kind='HOSTED' AND u.hosted_approved_at IS NOT NULL))`
   : sql`(u.identity_kind='LOCAL' AND u.local_instance_id=${instanceId} AND u.local_approved_at IS NOT NULL)`;
  const member=await tx.execute(sql`SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=${auth.membershipId} AND m.campaign_id=${auth.campaignId} AND m.role='GM' AND m.access_revoked_at IS NULL AND u.id=${accountUserId} AND u.disabled_at IS NULL AND u.password_change_required=false AND ${identity} AND NOT EXISTS(SELECT 1 FROM campaign_archive_state a WHERE a.campaign_id=m.campaign_id AND a.archived_at IS NOT NULL) FOR SHARE OF m,u`);
  if(!member.length)forbidden();
  if(parsedSelection.accountProof){
   const proof=parsedSelection.accountProof;
   const current=await tx.execute(sql`SELECT s.id FROM account_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=${proof.sessionId} AND s.user_id=${accountUserId} AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.password_hash=${proof.passwordHash} FOR SHARE OF s`);
   if(!current.length)forbidden();
  }
  const catalog=campaignTransferCatalog();
  const actual=await tx.execute<{tablename:string}>(sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  if(actual.length!==catalog.length||actual.some(row=>!catalog.some(table=>table.name===row.tablename)))throw Error("CAMPAIGN_TRANSFER_SCHEMA_UNREVIEWED");
  const migrations=await tx.execute<{hash:string}>(sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at,id`);
  if(migrations.length!==expectedMigrations.length||migrations.some((row,index)=>row.hash!==expectedMigrations[index]))throw Error("CAMPAIGN_TRANSFER_MIGRATION_MISMATCH");
  const [state]=await tx.execute<{baseline:string;captured_at:Date|string}>(sql`SELECT coalesce(max(sequence),0)::text AS baseline,transaction_timestamp() AS captured_at FROM game_events WHERE campaign_id=${auth.campaignId}`);
  let live=true;
  const read=async<T extends TransferProjection=TransferChatRedaction>(name:CampaignTransferTable,predicate:SQL,input:{offset?:number;limit?:number}={},projection:SQL=sql`to_jsonb(t)`,redactions:SQL=sql`'[]'::jsonb`)=>{
   if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");
   const table=catalog.find(table=>table.name===name);if(!table)throw Error("CAMPAIGN_TRANSFER_TABLE_UNKNOWN");
   if(!table.orderKey.length)throw Error("CAMPAIGN_TRANSFER_ORDER_REQUIRED");
   const query=page.parse(input),order=sql.join(table.orderKey.map(column=>sql.identifier(column)),sql`, `);
   // Return original PostgreSQL JSON text, not parsed/rounded JS numbers.
   const rows=await tx.execute<{row_json:string;redactions:T[]}>(sql`SELECT (${projection})::text AS row_json,${redactions} AS redactions FROM (SELECT * FROM ${sql.identifier(table.name)} WHERE ${predicate} ORDER BY ${order} LIMIT ${query.limit+1} OFFSET ${query.offset}) t`);
   return {rows:rows.slice(0,query.limit).map(row=>row.row_json),nextOffset:rows.length>query.limit?query.offset+query.limit:null,redactions:rows.slice(0,query.limit).flatMap(row=>row.redactions)};
  };
  const visibleThread=sql`campaign_id=${auth.campaignId} AND (type='STREAM' OR participant_a_membership_id=${auth.membershipId} OR participant_b_membership_id=${auth.membershipId})`;
  const messageFilter=sql`campaign_id=${auth.campaignId} AND thread_id IN (SELECT id FROM chat_threads WHERE ${visibleThread}) AND ${fullChatVisibilityFilterWithRequests(auth,sql`(chat_messages.player_request_id IS NULL OR chat_messages.player_request_id IN (SELECT id FROM player_requests WHERE campaign_id=${auth.campaignId}))`)}`;
  const stickerSelectors=campaignTransferStickerSelectors(auth,messageFilter,env.GLOBAL_STICKERS_ENABLED);
  // An existing consent cannot be revoked halfway through this snapshot. This
  // is a snapshot-time lease, not permanent offline consent/revocation sync.
  await tx.execute(sql`SELECT pack_id FROM player_likeness_consents WHERE campaign_id=${auth.campaignId} FOR SHARE`);
  const withheldSticker=sql`(t.sticker_id IS NOT NULL AND t.sticker_id NOT IN (${stickerSelectors.items})) OR (t.global_sticker_id IS NOT NULL AND t.global_sticker_id NOT IN (${stickerSelectors.globalItems}))`;
  await tx.execute(sql`SELECT id FROM global_sticker_packs WHERE id IN (${stickerSelectors.globalPacks}) FOR SHARE`);
  const revokedSticker=sql`EXISTS(SELECT 1 FROM stickers s JOIN sticker_packs p ON p.id=s.pack_id AND p.campaign_id=s.campaign_id JOIN player_likeness_consents c ON c.pack_id=p.id AND c.campaign_id=p.campaign_id WHERE s.id=t.sticker_id AND s.campaign_id=${auth.campaignId} AND p.subject='PLAYER' AND c.status='REVOKED')`;
  const hiddenInspiration=sql`t.inspiration_source_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chat_messages WHERE id=t.inspiration_source_message_id AND ${messageFilter})`;
  let worldReady:Promise<void>|undefined;
  const ensureWorld=()=>{
   if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");
   return worldReady??=(async()=>{
    if(worldArticleIds.length){const found=await tx.execute(sql`SELECT id FROM world_content WHERE id IN (SELECT jsonb_array_elements_text(${JSON.stringify(worldArticleIds)}::jsonb)::uuid)`);if(found.length!==worldArticleIds.length)throw Error("CAMPAIGN_TRANSFER_WORLD_SELECTION_INVALID");}
    await tx.execute(sql`CREATE TEMP TABLE arken_transfer_world_selection(id uuid PRIMARY KEY) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO arken_transfer_world_selection(id) ${campaignTransferWorldGraph(auth.campaignId,worldArticleIds)}`);
    const [count]=await tx.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM arken_transfer_world_selection`);if(count!.count>1000000)throw Error("CAMPAIGN_TRANSFER_WORLD_TOO_LARGE");
   })();
  };
  const worldImages=sql`SELECT cover_asset_id FROM world_content WHERE id IN (SELECT id FROM arken_transfer_world_selection) AND cover_asset_id IS NOT NULL UNION SELECT asset_id FROM world_content_media WHERE world_content_id IN (SELECT id FROM arken_transfer_world_selection)`;
  const readQuote=(name:NonReplayableQuoteTable,input:TransferPage={})=>{
   z.enum(nonReplayableQuoteTables).parse(name);
   return read<TransferProjection>(name,sql`campaign_id=${auth.campaignId}`,input,sql`to_jsonb(t)||jsonb_build_object('transfer_invalidated',true)`,sql`jsonb_build_array(jsonb_build_object('table',${name}::text,'rowId',t.id,'kind','NON_REPLAYABLE_QUOTE'))`);
  };
  const source:CampaignTransferSource={
   campaignId:auth.campaignId,ownerMembershipId:auth.membershipId,baselineSequence:state!.baseline,createdAt:new Date(state!.captured_at).toISOString(),schemaDigest:campaignTransferSchemaDigest(),migrations:migrations.map(row=>row.hash),
   readOwnedRows:async(name,input={})=>{
    if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");
    const table=catalog.find(table=>table.name===name);if(!table)throw Error("CAMPAIGN_TRANSFER_TABLE_UNKNOWN");
    if(table.policy!=="ROOT"&&table.policy!=="CAMPAIGN_ROWS")throw Error("CAMPAIGN_TRANSFER_SPECIAL_POLICY_REQUIRED");
    return read(name,table.policy==="ROOT"?sql`id=${auth.campaignId}`:sql`campaign_id=${auth.campaignId}`,input);
   },
   readParticipants:input=>read("memberships",sql`campaign_id=${auth.campaignId}`,input,sql`to_jsonb(t)||jsonb_build_object('user_id',NULL)`),
   readRelatedRows:async(name,input={})=>{
    const parents={character_catalog_entries:{parent:"characters",foreign:"character_id"},character_controllers:{parent:"characters",foreign:"character_id"},drawings:{parent:"scenes",foreign:"scene_id"},fog_reveals:{parent:"scenes",foreign:"scene_id"},token_controllers:{parent:"token_definitions",foreign:"token_definition_id"},tokens:{parent:"scenes",foreign:"scene_id"}} as const;
    if(!Object.hasOwn(parents,name))throw Error("CAMPAIGN_TRANSFER_SPECIAL_POLICY_REQUIRED");const relation=parents[name];
    return read(name,sql`${sql.identifier(relation.foreign)} IN (SELECT id FROM ${sql.identifier(relation.parent)} WHERE campaign_id=${auth.campaignId})`,input);
   },
   readCreationRows:(name,input={})=>{
    z.enum(creationTransferTables).parse(name);
    if((nonReplayableQuoteTables as readonly string[]).includes(name))return readQuote(name as NonReplayableQuoteTable,input);
    return read<TransferProjection>(name,sql`campaign_id=${auth.campaignId}`,input);
   },
   readNonReplayableQuotes:readQuote,
   readEncounterEvents:async(input={})=>{
    const result=await read("game_events",sql`campaign_id=${auth.campaignId} AND type IN (${sql.join(transferEncounterEventTypes.map(type=>sql`${type}`),sql`, `)})`,input),encounterIds:string[]=[];
    for(const row of result.rows)encounterIds.push(...validateTransferEncounterEvent(JSON.parse(row)).encounterIds);
    const ids=[...new Set(encounterIds)];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM encounters WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_ENCOUNTER_FOREIGN_REFERENCE");}
    return {...result,references:{encounterIds:ids}};
   },
   readMediaEvents:async(input={})=>{
    const result=await read<TransferProjection>("game_events",sql`campaign_id=${auth.campaignId} AND type IN (${sql.join(transferMediaEventTypes.map(type=>sql`${type}`),sql`, `)})`,input,sql`to_jsonb(t)`,sql`CASE WHEN t.type='STORY_ATTACHMENT_DELETE_REQUESTED' THEN jsonb_build_array(jsonb_build_object('table','game_events','rowId',t.sequence::text,'kind','EXCLUDED_UPLOAD_RUNTIME_REFERENCE')) ELSE '[]'::jsonb END`),references:MediaEventReferences={assetIds:[],audioTrackIds:[],campaignIds:[],spriteReceiptKeys:[],deletedAttachments:[]};
    for(const row of result.rows){const refs=validateTransferMediaEvent(JSON.parse(row));for(const key of ["assetIds","audioTrackIds","campaignIds","spriteReceiptKeys"] as const)references[key].push(...refs[key]);references.deletedAttachments.push(...refs.deletedAttachments);}
    for(const key of ["assetIds","audioTrackIds","campaignIds","spriteReceiptKeys"] as const)references[key]=[...new Set(references[key])];references.deletedAttachments=[...new Map(references.deletedAttachments.map(ref=>[ref.uploadId+":"+ref.contentId,ref])).values()];
    if(references.campaignIds.some(id=>id!==auth.campaignId))throw Error("CAMPAIGN_TRANSFER_MEDIA_FOREIGN_REFERENCE");
    for(const [key,table] of [["assetIds","assets"],["audioTrackIds","campaign_audio_tracks"]] as const){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_MEDIA_FOREIGN_REFERENCE");}}
    for(const ref of references.deletedAttachments){const [upload]=await tx.execute<{campaign_id:string;content_id:string}>(sql`SELECT campaign_id,content_id FROM chat_attachment_uploads WHERE id=${ref.uploadId}`);if(upload&&(upload.campaign_id!==auth.campaignId||upload.content_id!==ref.contentId))throw Error("CAMPAIGN_TRANSFER_MEDIA_FOREIGN_REFERENCE");}
    return {...result,references};
   },
   readControlEvents:async(input={})=>{
    const result=await read<TransferProjection>("game_events",sql`campaign_id=${auth.campaignId} AND type IN (${sql.join(transferControlEventTypes.map(type=>sql`${type}`),sql`, `)})`,input,sql`to_jsonb(t)`,sql`CASE WHEN t.entity_type IN ('player_access','invite') THEN jsonb_build_array(jsonb_build_object('table','game_events','rowId',t.sequence::text,'kind','EXCLUDED_AUTH_RUNTIME_REFERENCE','referenceType',CASE WHEN t.entity_type='invite' THEN 'INVITE' ELSE 'PLAYER_ACCESS' END)) ELSE '[]'::jsonb END`);
    const references:ControlEventReferences={campaignIds:[],membershipIds:[],characterIds:[],entryIds:[],actionIds:[],authRuntimeRefs:[]};
    for(const row of result.rows){const refs=validateTransferControlEvent(JSON.parse(row));for(const key of ["campaignIds","membershipIds","characterIds","entryIds","actionIds"] as const)references[key].push(...refs[key]);references.authRuntimeRefs.push(...refs.authRuntimeRefs);}
    for(const key of ["campaignIds","membershipIds","characterIds","entryIds","actionIds"] as const)references[key]=[...new Set(references[key])];references.authRuntimeRefs=[...new Map(references.authRuntimeRefs.map(ref=>[ref.kind+":"+ref.id,ref])).values()];
    if(references.campaignIds.some(id=>id!==auth.campaignId))throw Error("CAMPAIGN_TRANSFER_CONTROL_FOREIGN_REFERENCE");
    for(const ref of references.authRuntimeRefs){const table=ref.kind==='INVITE'?"invites":"player_access_grants";const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id=${ref.id} AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_CONTROL_FOREIGN_REFERENCE");}
    for(const [key,table] of [["membershipIds","memberships"],["characterIds","characters"]] as const){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_CONTROL_FOREIGN_REFERENCE");}}
    if(references.entryIds.length){const foreign=await tx.execute(sql`SELECT e.id FROM character_catalog_entries e JOIN characters c ON c.id=e.character_id WHERE e.id IN (${sql.join(references.entryIds.map(id=>sql`${id}`),sql`, `)}) AND c.campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_CONTROL_FOREIGN_REFERENCE");}
    return {...result,references};
   },
   readMagicAwardEvents:async(input={})=>{
    const result=await read("game_events",sql`campaign_id=${auth.campaignId} AND type IN (${sql.join(transferMagicAwardEventTypes.map(type=>sql`${type}`),sql`, `)})`,input),references:MagicAwardReferences={packIds:[],packVersionIds:[],assignmentIds:[],assignmentVersionIds:[],characterIds:[],instanceIds:[],achievementHistoryIds:[]};
    for(const text of result.rows){const event=validateTransferMagicAwardEvent(JSON.parse(text));const p=event.payload as Record<string,any>;
     if(event.entity_type==='SPELL_PACK'){
      const [version]=await tx.execute<{pack_id:string;version:number;lifecycle:string}>(sql`SELECT pack_id,version,lifecycle FROM spell_pack_versions WHERE campaign_id=${auth.campaignId} AND id=${p.targetVersionId}`);
      if(!version||version.pack_id!==event.entity_id||version.version!==p.targetVersion||version.lifecycle!==p.lifecycle)throw Error("CAMPAIGN_TRANSFER_SPELL_VERSION_REQUIRED");references.packIds.push(version.pack_id);references.packVersionIds.push(p.targetVersionId);
      if(p.previousVersionId){const [previous]=await tx.execute<{version:number;lifecycle:string}>(sql`SELECT version,lifecycle FROM spell_pack_versions WHERE campaign_id=${auth.campaignId} AND pack_id=${event.entity_id} AND id=${p.previousVersionId}`);if(!previous||previous.version!==p.expectedVersion||previous.lifecycle!==p.previousLifecycle)throw Error("CAMPAIGN_TRANSFER_SPELL_PREVIOUS_VERSION_REQUIRED");references.packVersionIds.push(p.previousVersionId);}
     }else if(event.entity_type==='CHARACTER_SPELL_ASSIGNMENT'){
      const [version]=await tx.execute<Record<string,any>>(sql`SELECT * FROM character_spell_assignment_versions WHERE campaign_id=${auth.campaignId} AND id=${p.assignmentVersionId}`);
      if(!version||version.assignment_id!==event.entity_id||version.version!==p.targetVersion||version.character_id!==p.characterId||version.pack_id!==p.packId||version.pack_version_id!==p.packVersionId||version.kind!==p.kind||version.school_id!==p.schoolId||version.node_id!==p.nodeId||version.rank!==p.rank||version.override_reason!==p.overrideReason||version.assigned_by_membership_id!==event.membership_id)throw Error("CAMPAIGN_TRANSFER_SPELL_ASSIGNMENT_REQUIRED");references.assignmentIds.push(event.entity_id!);references.assignmentVersionIds.push(p.assignmentVersionId);references.characterIds.push(p.characterId);references.packIds.push(p.packId);references.packVersionIds.push(p.packVersionId);
      if(p.previousAssignmentVersionId){const [previous]=await tx.execute<{version:number}>(sql`SELECT version FROM character_spell_assignment_versions WHERE campaign_id=${auth.campaignId} AND assignment_id=${event.entity_id} AND id=${p.previousAssignmentVersionId}`);if(!previous||previous.version!==p.targetVersion-1)throw Error("CAMPAIGN_TRANSFER_ASSIGNMENT_PREVIOUS_VERSION_REQUIRED");references.assignmentVersionIds.push(p.previousAssignmentVersionId);}
     }else if(event.type==='achievement.command'){
      const rows=await tx.execute<{id:string}>(sql`SELECT id FROM achievement_history WHERE campaign_id=${auth.campaignId} AND actor_membership_id=${event.membership_id} AND payload->>'actionId'=${event.action_id} AND (payload->>'entityId') IS NOT DISTINCT FROM ${event.entity_id}::text`);if(rows.length!==1)throw Error("CAMPAIGN_TRANSFER_ACHIEVEMENT_HISTORY_REQUIRED");references.achievementHistoryIds.push(rows[0]!.id);
     }else{
      const rows=await tx.execute(sql`SELECT action_id FROM world_content_instance_actions WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} AND actor_membership_id=${event.membership_id} AND entity_id=${event.entity_id} AND type='world_content_instance.bindings'`);if(rows.length!==1)throw Error("CAMPAIGN_TRANSFER_BINDING_HISTORY_REQUIRED");references.instanceIds.push(event.entity_id!);
     }
    }
    for(const key of Object.keys(references) as (keyof MagicAwardReferences)[])references[key]=[...new Set(references[key])];
    for(const [key,table] of [["packIds","spell_packs"],["packVersionIds","spell_pack_versions"],["assignmentIds","character_spell_assignments"],["assignmentVersionIds","character_spell_assignment_versions"],["characterIds","characters"],["instanceIds","world_content_instances"]] as const){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_MAGIC_FOREIGN_REFERENCE");}}
    return {...result,references};
   },
   readWorldMapEvents:async(input={})=>{
    const result=await read("game_events",sql`campaign_id=${auth.campaignId} AND type IN (${sql.join(transferWorldMapEventTypes.map(type=>sql`${type}`),sql`, `)})`,input),references:WorldMapEventReferences={mapIds:[],locationIds:[],sceneIds:[],assetIds:[]};
    for(const row of result.rows){const refs=validateTransferWorldMapEvent(JSON.parse(row));for(const key of Object.keys(references) as (keyof WorldMapEventReferences)[])references[key].push(...refs[key]);
     if(refs.locationIds.length){const mismatch=await tx.execute(sql`SELECT id FROM world_map_locations WHERE id=${refs.locationIds[0]} AND map_id<>${refs.mapIds[0]} LIMIT 1`);if(mismatch.length)throw Error("CAMPAIGN_TRANSFER_WORLD_MAP_LOCATION_MISMATCH");}
    }
    for(const key of Object.keys(references) as (keyof WorldMapEventReferences)[])references[key]=[...new Set(references[key])];
    for(const [key,table] of [["mapIds","world_maps"],["locationIds","world_map_locations"],["sceneIds","scenes"],["assetIds","assets"]] as const){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_WORLD_MAP_FOREIGN_REFERENCE");}}
    return {...result,references};
   },
   readNarrativeEvents:async(input={})=>{
    const result=await read("game_events",sql`campaign_id=${auth.campaignId} AND type IN (${sql.join(transferNarrativeEventTypes.map(type=>sql`${type}`),sql`, `)})`,input);
    const references:NarrativeReferences={postIds:[],requestIds:[],threadIds:[],membershipIds:[],contentIds:[],links:[]};
    for(const row of result.rows){const refs=validateTransferNarrativeEvent(JSON.parse(row));for(const key of ["postIds","requestIds","threadIds","membershipIds","contentIds"] as const)references[key].push(...refs[key]);references.links.push(...refs.links);}
    for(const key of ["postIds","requestIds","threadIds","membershipIds","contentIds"] as const)references[key]=[...new Set(references[key])];references.links=[...new Map(references.links.map(link=>[link.kind+":"+link.entityId,link])).values()];
    const domains={postIds:"story_posts",requestIds:"player_requests",threadIds:"chat_threads",membershipIds:"memberships"} as const;
    for(const [key,table] of Object.entries(domains) as [keyof typeof domains,string][]){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_NARRATIVE_FOREIGN_REFERENCE");}}
    if(references.threadIds.length){const privateThreads=await tx.execute(sql`SELECT id FROM chat_threads WHERE id IN (${sql.join(references.threadIds.map(id=>sql`${id}`),sql`, `)}) AND NOT (${visibleThread}) LIMIT 1`);if(privateThreads.length)throw Error("CAMPAIGN_TRANSFER_NARRATIVE_THREAD_FORBIDDEN");}
    const linkTables={WORLD_MAP:"world_maps",LOCATION:"world_map_locations",SCENE:"scenes",CHRONICLE:"story_posts"} as const;
    for(const link of references.links){if(link.kind==='WORLD_ENTITY')continue;const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(linkTables[link.kind])} WHERE id=${link.entityId} AND campaign_id<>${auth.campaignId}`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_NARRATIVE_FOREIGN_REFERENCE");}
    if(references.contentIds.length){const foreign=await tx.execute(sql`SELECT content_id FROM chat_attachment_uploads WHERE content_id IN (${sql.join(references.contentIds.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_NARRATIVE_FOREIGN_REFERENCE");}
    return {...result,references};
   },
   readCommerceEvents:async(input={})=>{
    const result=await read("game_events",sql`campaign_id=${auth.campaignId} AND type IN (${sql.join(transferCommerceEventTypes.map(type=>sql`${type}`),sql`, `)})`,input);
    const references:CommerceTransferReferences={creationActionIds:[],purchaseIds:[],quoteIds:[],characterIds:[],instanceIds:[],merchantIds:[],offerIds:[]};
    for(const text of result.rows){const event=validateTransferCommerceEvent(JSON.parse(text));
     if(event.entity_type==='creation'){
      const [action]=await tx.execute<{type:string;actor_membership_id:string;request_hash:string;receipt:unknown}>(sql`SELECT type,actor_membership_id,request_hash,receipt FROM creation_actions WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id}`);
      if(!action||action.actor_membership_id!==event.membership_id||action.request_hash!==event.payload.requestHash)throw Error("CAMPAIGN_TRANSFER_CREATION_ACTION_REQUIRED");
      const cancelled=creationCancellationReceiptSchema.safeParse(action.receipt);
      if(event.type==='creation.action.cancelled'){if(!cancelled.success||cancelled.data.actionId!==event.action_id||cancelled.data.type!==action.type||!(transferCreationEventTypes as readonly string[]).includes(action.type)||action.type==='creation.action.cancelled')throw Error("CAMPAIGN_TRANSFER_CREATION_CANCELLATION_INVALID");}
      else if(action.type!==event.type||cancelled.success)throw Error("CAMPAIGN_TRANSFER_CREATION_ACTION_REQUIRED");references.creationActionIds.push(event.action_id);
     }else if(event.type==='economy.config'){if(event.entity_id!==auth.campaignId)throw Error("CAMPAIGN_TRANSFER_ECONOMY_FOREIGN_REFERENCE");}
     else if(event.type==='economy.merchant'||event.type==='economy.offer'){
      const table=event.type==='economy.merchant'?"economy_merchants":"economy_offers",foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id=${event.entity_id} AND campaign_id<>${auth.campaignId}`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_ECONOMY_FOREIGN_REFERENCE");(event.type==='economy.merchant'?references.merchantIds:references.offerIds).push(event.entity_id!);
     }else{
      const [purchase]=await tx.execute<{id:string;actor_membership_id:string;quote_id:string;receipt:{actionId:string;quoteId:string;inventoryInstanceId:string;characterId:string}}>(sql`SELECT id,actor_membership_id,quote_id,receipt FROM economy_purchases WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id}`);
      if(!purchase||purchase.actor_membership_id!==event.membership_id||purchase.receipt?.actionId!==event.action_id||purchase.receipt.quoteId!==purchase.quote_id||purchase.receipt.inventoryInstanceId!==event.entity_id)throw Error("CAMPAIGN_TRANSFER_ECONOMY_PURCHASE_REQUIRED");
      z.string().uuid().parse(purchase.receipt.characterId);
      const [instanceAction]=await tx.execute<{payload:{requestHash?:string}}>(sql`SELECT payload FROM world_content_instance_actions WHERE campaign_id=${auth.campaignId} AND action_id=${event.action_id} AND type='economy.purchase' AND entity_id=${event.entity_id} AND actor_membership_id=${event.membership_id}`);if(instanceAction?.payload?.requestHash!==event.payload.requestHash)throw Error("CAMPAIGN_TRANSFER_ECONOMY_PURCHASE_REQUIRED");
      references.purchaseIds.push(purchase.id);references.quoteIds.push(purchase.quote_id);references.characterIds.push(purchase.receipt.characterId);references.instanceIds.push(event.entity_id!);
     }
    }
    for(const key of Object.keys(references) as (keyof CommerceTransferReferences)[])references[key]=[...new Set(references[key])];
    for(const [key,table] of [["quoteIds","economy_quotes"],["characterIds","characters"],["instanceIds","world_content_instances"]] as const){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_ECONOMY_FOREIGN_REFERENCE");}}
    return {...result,references};
   },
   readCharacterEvents:async(input={})=>{
    const result=await read("game_events",sql`campaign_id=${auth.campaignId} AND type IN (${sql.join(transferCharacterEventTypes.map(type=>sql`${type}`),sql`, `)}) AND (type<>'character.inspiration' OR ((payload->>'sourceMessageId' IS NULL OR payload->>'sourceMessageId' IN (SELECT id::text FROM chat_messages WHERE ${messageFilter})) AND (payload->'result'->>'messageId' IS NULL OR payload->'result'->>'messageId' IN (SELECT id::text FROM chat_messages WHERE ${messageFilter}))))`,input);
    const references:CharacterEventReferences={campaignIds:[],characterIds:[],membershipIds:[],assetIds:[],mediaIds:[],catalogEntryIds:[],entryIds:[],requestIds:[],messageIds:[]};
    for(const row of result.rows){const refs=validateTransferCharacterEvent(JSON.parse(row));for(const key of Object.keys(references) as (keyof CharacterEventReferences)[])references[key].push(...refs[key]);}
    for(const key of Object.keys(references) as (keyof CharacterEventReferences)[])references[key]=[...new Set(references[key])];if(references.campaignIds.some(id=>id!==auth.campaignId))throw Error("CAMPAIGN_TRANSFER_CHARACTER_FOREIGN_REFERENCE");
    const domains={characterIds:"characters",membershipIds:"memberships",assetIds:"assets",mediaIds:"character_media",catalogEntryIds:"catalog_entries",requestIds:"player_requests",messageIds:"chat_messages"} as const;
    for(const [key,table] of Object.entries(domains) as [keyof typeof domains,string][]){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_CHARACTER_FOREIGN_REFERENCE");}}
    if(references.entryIds.length){const foreign=await tx.execute(sql`SELECT e.id FROM character_catalog_entries e JOIN characters c ON c.id=e.character_id WHERE e.id IN (${sql.join(references.entryIds.map(id=>sql`${id}`),sql`, `)}) AND c.campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_CHARACTER_FOREIGN_REFERENCE");}
    return {...result,references};
   },
   readCanvasEvents:async(input={})=>{
    const result=await read("game_events",sql`campaign_id=${auth.campaignId} AND type IN (${sql.join(transferCanvasEventTypes.map(type=>sql`${type}`),sql`, `)})`,input);
    const references:CanvasEventReferences={sceneIds:[],tokenIds:[],drawingIds:[],fogIds:[],definitionIds:[],assetIds:[],characterIds:[],membershipIds:[]},journalSequences:string[]=[];
    for(const text of result.rows){const event=JSON.parse(text);let validationEvent=event;
     if(event.type==='canvas.undo'||event.type==='canvas.redo'){
      const [journal]=await tx.execute<{row_json:string;sequence:string}>(sql`SELECT to_jsonb(j)::text AS row_json,j.sequence::text AS sequence FROM action_journal j JOIN game_events e ON e.campaign_id=j.campaign_id AND e.payload->>'journalSequence'=j.sequence::text AND e.entity_id=j.target_id AND e.entity_type=lower(j.target_type) WHERE e.campaign_id=${auth.campaignId} AND e.action_id=${event.action_id}`);
      if(!journal)throw Error("CAMPAIGN_TRANSFER_CANVAS_JOURNAL_REQUIRED");validationEvent={...event,payload:{...event.payload,journalSequence:journal.sequence}};journalSequences.push(journal.sequence);const refs=validateTransferJournalRow(JSON.parse(journal.row_json));for(const key of Object.keys(refs) as (keyof typeof refs)[])references[key].push(...refs[key]);
     }
     const found=validateTransferCanvasEvent(validationEvent);for(const key of Object.keys(references) as (keyof CanvasEventReferences)[])references[key].push(...found[key]);
    }
    for(const key of Object.keys(references) as (keyof CanvasEventReferences)[])references[key]=[...new Set(references[key])];
    for(const [key,table] of Object.entries({sceneIds:"scenes",definitionIds:"token_definitions",assetIds:"assets",characterIds:"characters",membershipIds:"memberships"}) as ["sceneIds"|"definitionIds"|"assetIds"|"characterIds"|"membershipIds",string][]){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_CANVAS_FOREIGN_REFERENCE");}}
    for(const [key,table] of [["tokenIds","tokens"],["drawingIds","drawings"],["fogIds","fog_reveals"]] as const){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT t.id FROM ${sql.identifier(table)} t JOIN scenes s ON s.id=t.scene_id WHERE t.id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND s.campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_CANVAS_FOREIGN_REFERENCE");}}
    return {...result,references,journalSequences:[...new Set(journalSequences)]};
   },
   assertEventCoverage:async()=>{
    if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");
    const groups=await tx.execute<TransferEventGroup>(sql`SELECT type,entity_type AS "entityType",count(*)::text AS count FROM game_events WHERE campaign_id=${auth.campaignId} GROUP BY type,entity_type ORDER BY type,entity_type`);
    return assertTransferEventCoverage(groups);
   },
   readApplicationEvents:async(input={})=>{
    const predicate=sql`campaign_id=${auth.campaignId} AND entity_type='chat' AND type IN (${sql.join(transferApplicationEventTypes.map(type=>sql`${type}`),sql`, `)}) AND entity_id IN (SELECT id FROM chat_messages WHERE ${messageFilter}) AND (type<>'entry.undo' OR payload->>'originalMessageId' IN (SELECT id::text FROM chat_messages WHERE ${messageFilter}))`;
    const result=await read("game_events",predicate,input);
    const references:ApplicationTransferReferences={messageIds:[],characterIds:[],entryIds:[],catalogEntryIds:[],objectIds:[],instanceIds:[],sceneIds:[],membershipIds:[]};
    for(const row of result.rows){const event=JSON.parse(row),found=validateTransferApplicationEvent(event);for(const key of Object.keys(references) as (keyof ApplicationTransferReferences)[])references[key].push(...found[key]);
     for(const id of transferInspirationReferences(event.payload)){const visible=await tx.execute(sql`SELECT id FROM chat_messages WHERE id=${id} AND ${messageFilter}`);if(!visible.length)throw Error("CAMPAIGN_TRANSFER_APPLICATION_INSPIRATION_FORBIDDEN");}
    }
    for(const key of Object.keys(references) as (keyof ApplicationTransferReferences)[])references[key]=[...new Set(references[key])];
    const domains={characterIds:"characters",objectIds:"creation_objects",instanceIds:"world_content_instances",sceneIds:"scenes",membershipIds:"memberships"} as const;
    for(const [key,table] of Object.entries(domains) as [keyof typeof domains,string][]){const ids=references[key];if(ids.length){const foreign=await tx.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)}) AND campaign_id<>${auth.campaignId} LIMIT 1`);if(foreign.length)throw Error("CAMPAIGN_TRANSFER_APPLICATION_FOREIGN_REFERENCE");}}
    return {...result,references};
   },
   readChatDeliveryEvents:async(input={})=>{
    const predicate=sql`campaign_id=${auth.campaignId} AND entity_type='chat' AND type IN (${sql.join(transferChatDeliveryTypes.map(type=>sql`${type}`),sql`, `)}) AND entity_id IN (SELECT id FROM chat_messages WHERE ${messageFilter})`;
    const raw=await read("game_events",predicate,input);
    // Bind each immutable delivery DTO to the separately ACL-authorized message;
    // an event pointing at an allowed id cannot smuggle another thread's DTO.
    for(const text of raw.rows){
     const event=JSON.parse(text),dto=validateTransferChatDelivery(event.payload);
     const [message]=await tx.execute<{thread_id:string;membership_id:string;body:string;visibility:string;inspiration_source_message_id:string|null}>(sql`SELECT thread_id,membership_id,body,visibility,inspiration_source_message_id FROM chat_messages WHERE campaign_id=${auth.campaignId} AND id=${event.entity_id}`);
     if(dto.id!==event.entity_id||dto.threadId!==message?.thread_id||dto.membershipId!==message?.membership_id||dto.body!==message?.body||dto.visibility!==message?.visibility)throw Error("CAMPAIGN_TRANSFER_CHAT_EVENT_IDENTITY");
     const inspiration=transferInspirationReferences(dto);
     for(const id of inspiration){const found=await tx.execute(sql`SELECT id FROM chat_messages WHERE id=${id} AND ${messageFilter}`);if(!found.length){const elsewhere=transferInspirationReferences({...dto,dice:dto.dice?{...dto.dice,inspiration:undefined}:null});if(dto.dice?.inspiration?.sourceMessageId!==id||message?.inspiration_source_message_id!==id||elsewhere.includes(id))throw Error("CAMPAIGN_TRANSFER_CHAT_EVENT_INSPIRATION_FORBIDDEN");}}
    }
    const withheld=sql`(t.payload->>'stickerId' IS NOT NULL AND t.payload->>'stickerId' NOT IN (SELECT id::text FROM stickers WHERE id IN (${stickerSelectors.items}))) OR (t.payload->>'globalStickerId' IS NOT NULL AND t.payload->>'globalStickerId' NOT IN (SELECT id::text FROM global_stickers WHERE id IN (${stickerSelectors.globalItems})))`;
    const hidden=sql`EXISTS(SELECT 1 FROM chat_messages m WHERE m.id=t.entity_id AND m.campaign_id=${auth.campaignId} AND m.inspiration_source_message_id IS NOT NULL AND m.inspiration_source_message_id NOT IN (SELECT id FROM chat_messages WHERE ${messageFilter}))`;
    const payload=sql`CASE WHEN ${hidden} THEN t.payload #- '{dice,inspiration}' ELSE t.payload END`;
    return read<TransferProjection>("game_events",predicate,input,sql`to_jsonb(t)||jsonb_build_object('payload',${payload}||CASE WHEN ${withheld} THEN jsonb_build_object('stickerId',NULL,'globalStickerId',NULL,'stickerPresentation',NULL,'body',CASE WHEN t.payload->>'body'='' THEN '[Sticker unavailable]' ELSE (t.payload->>'body')||' [Sticker unavailable]' END) ELSE '{}'::jsonb END)`,sql`CASE WHEN ${withheld} THEN jsonb_build_array(jsonb_build_object('table','game_events','rowId',t.sequence::text,'kind','WITHHELD_CHAT_EVENT_STICKER')) ELSE '[]'::jsonb END||CASE WHEN ${hidden} THEN jsonb_build_array(jsonb_build_object('table','game_events','rowId',t.sequence::text,'kind','HIDDEN_CHAT_EVENT_INSPIRATION')) ELSE '[]'::jsonb END`);
   },
   readActionJournal:async(input={})=>{
    const result=await read("action_journal",sql`campaign_id=${auth.campaignId}`,input);
    const references:JournalTransferReferences={sceneIds:[],assetIds:[],definitionIds:[],characterIds:[],membershipIds:[]};
    for(const row of result.rows){const found=validateTransferJournalRow(JSON.parse(row));for(const key of Object.keys(references) as (keyof JournalTransferReferences)[])references[key].push(...found[key]);}
    for(const key of Object.keys(references) as (keyof JournalTransferReferences)[])references[key]=[...new Set(references[key])];
    return {...result,references};
   },
   readWorldHistory:async(input={})=>{
    await ensureWorld();
    const external=sql`t.actor_membership_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.id=t.actor_membership_id AND m.campaign_id=${auth.campaignId})`;
    const result=await read<TransferProjection>("world_content_actions",transferWorldHistoryScope,input,sql`to_jsonb(t)||CASE WHEN ${external} THEN jsonb_build_object('actor_membership_id',NULL) ELSE '{}'::jsonb END`,sql`CASE WHEN ${external} THEN jsonb_build_array(jsonb_build_object('table','world_content_actions','rowId',t.sequence::text,'kind','EXTERNAL_MEMBERSHIP_REFERENCE')) ELSE '[]'::jsonb END`);
    const references:WorldHistoryReferences={articleIds:[],imageIds:[]};
    for(const row of result.rows){const found=validateTransferWorldHistoryRow(JSON.parse(row));references.articleIds.push(...found.articleIds);references.imageIds.push(...found.imageIds);}
    return {...result,references:{articleIds:[...new Set(references.articleIds)],imageIds:[...new Set(references.imageIds)]}};
   },
   readWorldRows:async(name,input={})=>{
    await ensureWorld();
    switch(name){
     case "world_content":return read(name,sql`id IN (SELECT id FROM arken_transfer_world_selection)`,input);
     case "world_content_media":return read(name,sql`world_content_id IN (SELECT id FROM arken_transfer_world_selection)`,input);
     case "world_content_relations":return read(name,sql`from_world_content_id IN (SELECT id FROM arken_transfer_world_selection) AND to_world_content_id IN (SELECT id FROM arken_transfer_world_selection)`,input);
     case "world_content_images":return read(name,sql`id IN (${worldImages})`,input);
     default:throw Error("CAMPAIGN_TRANSFER_SPECIAL_POLICY_REQUIRED");
    }
   },
   captureWorldImage:async(imageId,stage)=>{
    z.string().uuid().parse(imageId);await ensureWorld();
    const [image]=await tx.execute<{storage_key:string;mime_type:string;size_bytes:number}>(sql`SELECT storage_key,mime_type,size_bytes FROM world_content_images WHERE id=${imageId} AND id IN (${worldImages}) AND mime_type IN ('image/png','image/jpeg','image/webp')`);if(!image)throw Error("CAMPAIGN_TRANSFER_MEDIA_FORBIDDEN");if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");
    const pin=await pinCampaignTransferMedia(resolve(env.MEDIA_ROOT),{storageKey:image.storage_key,mimeType:image.mime_type,sizeBytes:image.size_bytes});try{if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");return await stage.copy(pin);}finally{await pin.close();}
   },
   readStickerRows:async(name,input={})=>{
    switch(name){
     case "sticker_packs":case "sticker_pack_entitlements":case "player_likeness_consents":return read<TransferProjection>(name,sql`campaign_id=${auth.campaignId}`,input);
     case "stickers":return read<TransferProjection>(name,sql`campaign_id=${auth.campaignId} AND id IN (${stickerSelectors.items})`,input);
     case "sticker_media":return read<TransferProjection>(name,sql`campaign_id=${auth.campaignId} AND id IN (${stickerSelectors.media})`,input);
     case "global_stickers":{
      const external=sql`NOT EXISTS(SELECT 1 FROM global_sticker_packs WHERE id=t.pack_id AND creator_membership_id=${auth.membershipId}) AND t.source_reference IS NOT NULL`;
      return read<TransferProjection>(name,sql`id IN (${stickerSelectors.globalItems})`,input,sql`to_jsonb(t)||CASE WHEN ${external} THEN jsonb_build_object('source_reference',NULL) ELSE '{}'::jsonb END`,sql`CASE WHEN ${external} THEN jsonb_build_array(jsonb_build_object('table','global_stickers','rowId',t.id,'kind','EXTERNAL_CATALOG_METADATA')) ELSE '[]'::jsonb END`);
     }
     case "global_sticker_packs":case "global_sticker_media":{
      const column=name==="global_sticker_packs"?"creator_membership_id":"uploaded_by_membership_id",scope=name==="global_sticker_packs"?stickerSelectors.globalPacks:stickerSelectors.globalMedia,external=sql`${sql.identifier("t")}.${sql.identifier(column)} IS NOT NULL AND ${sql.identifier("t")}.${sql.identifier(column)} NOT IN (SELECT id FROM memberships WHERE campaign_id=${auth.campaignId})`;
      return read<TransferProjection>(name,sql`id IN (${scope})`,input,sql`to_jsonb(t)||CASE WHEN ${external} THEN jsonb_build_object(${column}::text,NULL) ELSE '{}'::jsonb END`,sql`CASE WHEN ${external} THEN jsonb_build_array(jsonb_build_object('table',${name}::text,'rowId',t.id,'kind','EXTERNAL_MEMBERSHIP_REFERENCE')) ELSE '[]'::jsonb END`);
     }
     default:throw Error("CAMPAIGN_TRANSFER_SPECIAL_POLICY_REQUIRED");
    }
   },
   captureStickerMedia:async(stickerId,stage,scope="campaign")=>{
    if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");z.string().uuid().parse(stickerId);z.enum(["campaign","global"]).parse(scope);
    const query=scope==="campaign"?sql`SELECT m.storage_key,m.mime_type,m.size_bytes,m.sha256 FROM stickers s JOIN sticker_media m ON m.id=s.media_id AND m.campaign_id=s.campaign_id WHERE s.campaign_id=${auth.campaignId} AND s.id=${stickerId} AND s.id IN (${stickerSelectors.items})`:sql`SELECT m.storage_key,m.mime_type,m.size_bytes,m.sha256 FROM global_stickers s JOIN global_sticker_media m ON m.id=s.media_id WHERE s.id=${stickerId} AND s.id IN (${stickerSelectors.globalItems})`;
    const [media]=await tx.execute<{storage_key:string;mime_type:string;size_bytes:number;sha256:string}>(query);if(!media)throw Error("CAMPAIGN_TRANSFER_MEDIA_FORBIDDEN");
    const pin=await pinCampaignTransferMedia(resolve(env.MEDIA_ROOT),{storageKey:media.storage_key,mimeType:media.mime_type,sizeBytes:media.size_bytes,sha256:media.sha256});try{if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");return await stage.copy(pin);}finally{await pin.close();}
   },
   captureAssetMedia:async(assetId,stage,variant="original")=>{
    if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");z.string().uuid().parse(assetId);z.enum(["original","poster"]).parse(variant);
    const [asset]=await tx.execute<{storage_key:string|null;mime_type:string;size_bytes:number|null}>(sql`SELECT CASE WHEN ${variant}='poster' THEN poster_storage_key ELSE storage_key END AS storage_key,CASE WHEN ${variant}='poster' THEN 'image/webp' ELSE mime_type END AS mime_type,CASE WHEN ${variant}='poster' THEN poster_size_bytes ELSE size_bytes END AS size_bytes FROM assets WHERE id=${assetId} AND campaign_id=${auth.campaignId}`);
    if(!asset||!asset.storage_key||!asset.size_bytes)throw Error("CAMPAIGN_TRANSFER_MEDIA_FORBIDDEN");if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");
    const pin=await pinCampaignTransferMedia(resolve(env.MEDIA_ROOT),{storageKey:asset.storage_key,mimeType:asset.mime_type,sizeBytes:asset.size_bytes});try{if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");return await stage.copy(pin);}finally{await pin.close();}
   },
   captureChatAttachmentMedia:async(contentId,stage)=>{
    if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");z.string().uuid().parse(contentId);
    const [content]=await tx.execute<{storage_key:string;mime_type:string;size_bytes:number}>(sql`SELECT storage_key,mime_type,size_bytes FROM chat_attachment_uploads WHERE campaign_id=${auth.campaignId} AND content_id=${contentId} AND status='CLAIMED' AND content_id IN (SELECT content_id FROM chat_attachments WHERE campaign_id=${auth.campaignId} AND message_id IN (SELECT id FROM chat_messages WHERE ${messageFilter}))`);
    if(!content)throw Error("CAMPAIGN_TRANSFER_MEDIA_FORBIDDEN");if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");
    const pin=await pinCampaignTransferMedia(resolve(env.MEDIA_ROOT),{storageKey:content.storage_key,mimeType:content.mime_type,sizeBytes:content.size_bytes});try{if(!live)throw Error("CAMPAIGN_TRANSFER_SNAPSHOT_CLOSED");return await stage.copy(pin);}finally{await pin.close();}
   },
   readChatMessages:async(input)=>{const result=await read("chat_messages",messageFilter,input,
    sql`to_jsonb(t)||CASE WHEN (${revokedSticker}) OR (${withheldSticker}) THEN jsonb_build_object('sticker_id',NULL,'global_sticker_id',NULL,'sticker_presentation',NULL,'body',CASE WHEN t.body='' THEN '[Sticker unavailable]' ELSE t.body||' [Sticker unavailable]' END) ELSE '{}'::jsonb END||CASE WHEN ${hiddenInspiration} THEN jsonb_build_object('inspiration_source_message_id',NULL,'dice',CASE WHEN jsonb_typeof(t.dice)='object' THEN t.dice-'inspiration' ELSE t.dice END) ELSE '{}'::jsonb END`,
    sql`CASE WHEN ${revokedSticker} THEN jsonb_build_array(jsonb_build_object('messageId',t.id,'kind','REVOKED_STICKER')) WHEN ${withheldSticker} THEN jsonb_build_array(jsonb_build_object('messageId',t.id,'kind','WITHHELD_STICKER')) ELSE '[]'::jsonb END||CASE WHEN ${hiddenInspiration} THEN jsonb_build_array(jsonb_build_object('messageId',t.id,'kind','HIDDEN_INSPIRATION')) ELSE '[]'::jsonb END`);
    for(const text of result.rows){const row=JSON.parse(text);for(const id of transferInspirationReferences(row.dice)){const visible=await tx.execute(sql`SELECT id FROM chat_messages WHERE id=${id} AND ${messageFilter}`);if(!visible.length)throw Error("CAMPAIGN_TRANSFER_CHAT_INSPIRATION_FORBIDDEN");}}
    return result;
   },
   readChatAttachments:async(input={})=>{
    const result=await read("chat_attachments",sql`campaign_id=${auth.campaignId} AND message_id IN (SELECT id FROM chat_messages WHERE ${messageFilter})`,input);
    const ids=result.rows.map(row=>z.object({content_id:z.string().uuid()}).passthrough().parse(JSON.parse(row)).content_id);
    if(!ids.length)return {...result,contents:[]};
    const contents=await tx.execute<TransferAttachmentContent&{status:string}>(sql`SELECT content_id AS "contentId",campaign_id AS "campaignId",uploaded_by_membership_id AS "uploadedByMembershipId",file_name AS "fileName",storage_key AS "storageKey",mime_type AS "mimeType",size_bytes AS "sizeBytes",width,height,created_at AS "createdAt",status FROM chat_attachment_uploads WHERE campaign_id=${auth.campaignId} AND content_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`, `)})`);
    if(contents.length!==ids.length||contents.some(row=>row.status!=="CLAIMED"))throw Error("CAMPAIGN_TRANSFER_ATTACHMENT_STATE_INVALID");
    return {...result,contents:contents.map(({status:_,...row})=>({...row,createdAt:new Date(row.createdAt).toISOString()}))};
   },
   readMemberRows:async(name,input={})=>{
    switch(name){
     case "character_private_notebooks":return read(name,sql`campaign_id=${auth.campaignId} AND author_membership_id=${auth.membershipId}`,input);
     case "chat_threads":return read(name,visibleThread,input);
     case "chat_read_cursors":return read(name,sql`campaign_id=${auth.campaignId} AND membership_id=${auth.membershipId} AND thread_id IN (SELECT id FROM chat_threads WHERE ${visibleThread})`,input);
     case "player_requests":return read(name,sql`campaign_id=${auth.campaignId}`,input); // Current source is independently verified GM.
     default:throw Error("CAMPAIGN_TRANSFER_SPECIAL_POLICY_REQUIRED");
    }
   },
  };
  try{const result=await capture(source);if(worldReady)await tx.execute(sql`DROP TABLE pg_temp.arken_transfer_world_selection`);return result;}finally{live=false;}
 };
 return transaction?readSnapshot(transaction):db.transaction(readSnapshot,{isolationLevel:"repeatable read"});
}

export interface CampaignTransferSource{
 readonly campaignId:string;
 readonly ownerMembershipId:string;
 readonly baselineSequence:string;
 readonly createdAt:string;
 readonly schemaDigest:string;
 readonly migrations:readonly string[];
 /** Only already-reviewed tenant-owned data; private/history/identity/licence
  * and global-library reads require separate ACL/closure implementations. */
 readOwnedRows(name:CampaignTransferTable,input?:TransferPage):Promise<TransferRows>;
 /** Stable membership IDs/roles, but no source account binding or credentials.
  * Target importer must bind only the verified owner to the local host owner. */
 readParticipants(input?:TransferPage):Promise<TransferRows>;
 readRelatedRows(name:"character_catalog_entries"|"character_controllers"|"drawings"|"fog_reveals"|"token_controllers"|"tokens",input?:TransferPage):Promise<TransferRows>;
 /** Redactions are transfer projections, never user edits to replay to cloud. */
 readCreationRows(name:CreationTransferTable,input?:TransferPage):Promise<TransferRows&{redactions:TransferProjection[]}>;
 /** Delivery DTO events only; entry/area receipts require their own handlers. */
 /** Mandatory full-package gate; supported types still require row validation and ACL filtering. */
 assertEventCoverage():Promise<ReturnType<typeof assertTransferEventCoverage>>;
 readEncounterEvents(input?:TransferPage):Promise<TransferRows&{references:{encounterIds:string[]}}>;
 readMediaEvents(input?:TransferPage):Promise<TransferRows&{references:MediaEventReferences;redactions:TransferProjection[]}>;
 readControlEvents(input?:TransferPage):Promise<TransferRows&{references:ControlEventReferences;redactions:TransferProjection[]}>;
 readMagicAwardEvents(input?:TransferPage):Promise<TransferRows&{references:MagicAwardReferences}>;
 readWorldMapEvents(input?:TransferPage):Promise<TransferRows&{references:WorldMapEventReferences}>;
 readNarrativeEvents(input?:TransferPage):Promise<TransferRows&{references:NarrativeReferences}>;
 readCommerceEvents(input?:TransferPage):Promise<TransferRows&{references:CommerceTransferReferences}>;
 readCharacterEvents(input?:TransferPage):Promise<TransferRows&{references:CharacterEventReferences}>;
 readCanvasEvents(input?:TransferPage):Promise<TransferRows&{references:CanvasEventReferences;journalSequences:string[]}>;
 readApplicationEvents(input?:TransferPage):Promise<TransferRows&{references:ApplicationTransferReferences}>;
 readChatDeliveryEvents(input?:TransferPage):Promise<TransferRows&{redactions:TransferProjection[]}>;
 readActionJournal(input?:TransferPage):Promise<TransferRows&{references:JournalTransferReferences}>;
 readWorldHistory(input?:TransferPage):Promise<TransferRows&{redactions:TransferProjection[];references:WorldHistoryReferences}>;
 readNonReplayableQuotes(name:NonReplayableQuoteTable,input?:TransferPage):Promise<TransferRows&{redactions:TransferProjection[]}>;
 readWorldRows(name:"world_content"|"world_content_media"|"world_content_relations"|"world_content_images",input?:TransferPage):Promise<TransferRows>;
 captureWorldImage(imageId:string,stage:CampaignTransferMediaStage):Promise<TransferMediaFile>;
 readStickerRows(name:"sticker_packs"|"sticker_pack_entitlements"|"player_likeness_consents"|"stickers"|"sticker_media"|"global_sticker_packs"|"global_stickers"|"global_sticker_media",input?:TransferPage):Promise<TransferRows&{redactions:TransferProjection[]}>;
 captureStickerMedia(stickerId:string,stage:CampaignTransferMediaStage,scope?:"campaign"|"global"):Promise<TransferMediaFile>;
 captureAssetMedia(assetId:string,stage:CampaignTransferMediaStage,variant?:"original"|"poster"):Promise<TransferMediaFile>;
 captureChatAttachmentMedia(contentId:string,stage:CampaignTransferMediaStage):Promise<TransferMediaFile>;
 readChatMessages(input?:TransferPage):Promise<TransferRows&{redactions:TransferChatRedaction[]}>;
 /** storageKey is internal to the source media reader; the package writer must
  * replace it with content-addressed bytes, not export the upload runtime row. */
 readChatAttachments(input?:TransferPage):Promise<TransferRows&{contents:TransferAttachmentContent[]}>;
 readMemberRows(name:"character_private_notebooks"|"chat_threads"|"chat_read_cursors"|"player_requests",input?:TransferPage):Promise<TransferRows>;
}

export type TransferPage={offset?:number;limit?:number};
export type TransferRows={rows:string[];nextOffset:number|null};

export type TransferChatRedaction={messageId:string;kind:"REVOKED_STICKER"|"HIDDEN_INSPIRATION"|"WITHHELD_STICKER"};
export type TransferAttachmentContent={contentId:string;campaignId:string;uploadedByMembershipId:string;fileName:string;storageKey:string;mimeType:string;sizeBytes:number;width:number|null;height:number|null;createdAt:string};

export type TransferProjection={table:"game_events";rowId:string;kind:"EXCLUDED_UPLOAD_RUNTIME_REFERENCE"}|{table:"game_events";rowId:string;kind:"EXCLUDED_AUTH_RUNTIME_REFERENCE";referenceType:"INVITE"|"PLAYER_ACCESS"}|{table:"game_events";rowId:string;kind:"WITHHELD_CHAT_EVENT_STICKER"|"HIDDEN_CHAT_EVENT_INSPIRATION"}|{table:NonReplayableQuoteTable;rowId:string;kind:"NON_REPLAYABLE_QUOTE"}|{table:"global_stickers";rowId:string;kind:"EXTERNAL_CATALOG_METADATA"}|TransferChatRedaction|{table:"global_sticker_packs"|"global_sticker_media"|"world_content_actions";rowId:string;kind:"EXTERNAL_MEMBERSHIP_REFERENCE"};

export type CommerceTransferReferences={creationActionIds:string[];purchaseIds:string[];quoteIds:string[];characterIds:string[];instanceIds:string[];merchantIds:string[];offerIds:string[]};

export type MagicAwardReferences={packIds:string[];packVersionIds:string[];assignmentIds:string[];assignmentVersionIds:string[];characterIds:string[];instanceIds:string[];achievementHistoryIds:string[]};
