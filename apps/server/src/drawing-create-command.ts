import {and,eq} from "drizzle-orm";import {z} from "zod";import {createDrawingSchema} from "@arken/contracts";import {actionJournal,assets,drawings,gameEvents,scenes} from "@arken/db";import type {AuthContext} from "./auth.js";import {canvasLayerLevel} from "./isometric-layers.js";import {invalidateRedoBranch} from "./canvas-history.js";import {isHiddenStamp} from "./drawing-kinds.js";import {CAMPAIGN_IMAGE_STAMP_PACK_ID,stampCatalog,textureCatalog} from "./terrain-stamp-routes.js";
type Transaction=import("./campaign-pause-guard.js").CampaignCanvasTransaction;
export async function commitDrawingCreate(tx:Transaction,auth:AuthContext,inputBody:unknown,options?:{id?:string;createdAt?:Date;updatedAt?:Date}){
 const body=createDrawingSchema.parse(inputBody),{actionId,...input}=body;
 const scene=await tx.select({id:scenes.id}).from(scenes).where(and(eq(scenes.id,body.sceneId),eq(scenes.campaignId,auth.campaignId))).limit(1);if(!scene.length)throw Error("SCENE_NOT_FOUND");
 if(body.kind==="STAMP"||body.kind==="TEXTURE"){
  if(auth.role!=="GM")throw Error("STAMP_FORBIDDEN");
  if(body.packId===CAMPAIGN_IMAGE_STAMP_PACK_ID){const rows=await tx.select({id:assets.id}).from(assets).where(and(eq(assets.id,body.assetKey),eq(assets.campaignId,auth.campaignId),eq(assets.kind,"IMAGE"))).limit(1);if(!rows.length)throw Error("STAMP_IMAGE_NOT_FOUND");}
  else if(!(body.kind==="STAMP"?stampCatalog():textureCatalog()).has(body.assetKey))throw Error("STAMP_TEMPLATE_UNKNOWN");
 }
    const drawingInput =
      input.kind === "STAMP"
        ? {
            sceneId: input.sceneId,
            authorMembershipId: auth.membershipId,
            points: [] as number[],
            color: "#ffffff",
            strokeWidth: 3,
            x: input.x,
            y: input.y,
            kind: "STAMP",
            stampAssetKey: input.assetKey,
            stampPackId: input.packId,
            stampSize: input.size,
            stampRotation: input.rotation,
            stampLayer: input.layer,
          }
        : input.kind === "TEXTURE"
          ? {
              sceneId: input.sceneId,
              authorMembershipId: auth.membershipId,
              points: input.points,
              color: "#ffffff",
              strokeWidth: input.brushWidth,
              x: input.x,
              y: input.y,
              kind: "TEXTURE",
              stampAssetKey: input.assetKey,
              stampPackId: input.packId,
              stampSize: input.size,
              stampRotation: 0,
              stampLayer: input.layer,
            }
          : {
              ...input,
              authorMembershipId: auth.membershipId,
              kind: "FREEHAND" as const,
            };
      const levelId = await canvasLayerLevel(tx, auth.campaignId, body.sceneId, "levelId" in body ? body.levelId : undefined, auth.role);
      await invalidateRedoBranch(tx, auth, body.sceneId);
      const [drawing] = await tx
        .insert(drawings)
        .values({ ...drawingInput, levelId,...(options?.id?{id:z.string().uuid().parse(options.id)}:{}),...(options?.createdAt?{createdAt:options.createdAt}:{}),...(options?.updatedAt?{updatedAt:options.updatedAt}:{}) })
        .returning();
      if (!drawing) throw new Error("DRAWING_CREATE_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "drawing.created",
          entityType: "drawing",
          entityId: drawing.id,
          entityRevision: 0,
          payload: drawing,
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: body.sceneId,
        actorMembershipId: auth.membershipId,
        actionId,
        type: "DRAWING_CREATE",
        targetType: "DRAWING",
        targetId: drawing.id,
        scope: isHiddenStamp(drawing) ? "GM" : "PUBLIC",
        before: null,
        after: drawing,
        afterRevision: 0,
        currentRevision: 0,
      });
      return { drawing, event };

}
