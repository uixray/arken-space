import {z} from "zod";
import {createSceneSchema,gridSchema} from "@arken/contracts";
/** Distinguish command intent from the derived frame (which can be narrower
 * than an explicitly supplied frame for extremely wide map images). */
export const sceneCreateEventSchema=z.object({sceneId:z.string().uuid(),command:createSceneSchema.omit({actionId:true}).extend({grid:gridSchema.strict()}).strict(),backgroundFrame:z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().positive(),height:z.number().finite().positive()}).strict()}).strict();
