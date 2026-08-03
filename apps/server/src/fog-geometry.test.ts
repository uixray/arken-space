import { describe, expect, it } from "vitest";
import { canonicalizeFogGeometry, FogGeometryError } from "./fog-geometry.js";
import { evaluateFogCoverage, fogGeometryContains } from "@arken/contracts";
describe("canonicalizeFogGeometry",()=>{
 it("uses actual shape coverage and ordered COVER override",()=>{const circle={type:"CIRCLE" as const,center:{x:10,y:10},radius:5};expect(fogGeometryContains(circle,{x:6,y:6})).toBe(false);expect(evaluateFogCoverage([{operation:"REVEAL",geometry:circle,sequence:1},{operation:"COVER",geometry:{type:"RECT",x:9,y:9,width:2,height:2},sequence:2}],{x:10,y:10})).toBe(false)});
 it("clamps legacy RECT",()=>{expect(canonicalizeFogGeometry({type:"RECT",x:-5,y:-5,width:20,height:20},{width:10,height:10},true)).toEqual({geometry:{type:"RECT",x:0,y:0,width:10,height:10},bbox:{x:0,y:0,width:10,height:10}})});
 it("rejects out-of-scene non-RECT",()=>{expect(()=>canonicalizeFogGeometry({type:"CIRCLE",center:{x:2,y:2},radius:5},{width:10,height:10})).toThrow(FogGeometryError)});
 it("canonicalizes and caps a brush",()=>{const points=Array.from({length:1000},(_,i)=>({x:3+i/10,y:50+(i%2)}));const result=canonicalizeFogGeometry({type:"BRUSH",points,radius:2},{width:200,height:200});expect(result.geometry.type).toBe("BRUSH");if(result.geometry.type==="BRUSH")expect(result.geometry.points.length).toBeLessThanOrEqual(256)});
});

