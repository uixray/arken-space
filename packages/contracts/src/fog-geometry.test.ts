import { describe, expect, it } from "vitest";
import { evaluateFogCoverage, fogGeometryContains, simplifyFogBrush, validateFogPolygon } from "./fog-geometry.js";
describe("fog geometry",()=>{
 it("evaluates shape coverage instead of bbox and later COVER wins",()=>{const circle={type:"CIRCLE" as const,center:{x:10,y:10},radius:5};expect(fogGeometryContains(circle,{x:6,y:6})).toBe(false);expect(evaluateFogCoverage([{operation:"REVEAL",geometry:circle,sequence:1},{operation:"COVER",geometry:{type:"RECT",x:9,y:9,width:2,height:2},sequence:2}],{x:10,y:10})).toBe(false);expect(evaluateFogCoverage([{operation:"COVER",geometry:{type:"RECT",x:9,y:9,width:2,height:2},sequence:2},{operation:"REVEAL",geometry:circle,sequence:3}],{x:10,y:10})).toBe(true)});
 it("rejects degenerate and self-intersecting polygons",()=>{expect(validateFogPolygon([{x:0,y:0},{x:1,y:1},{x:2,y:2}])).toBe(false);expect(validateFogPolygon([{x:0,y:0},{x:4,y:4},{x:0,y:4},{x:4,y:0}])).toBe(false);expect(validateFogPolygon([{x:0,y:0},{x:4,y:0},{x:0,y:4}])).toBe(true)});
 it("simplifies brush deterministically to its canonical cap",()=>{const points=Array.from({length:1000},(_,i)=>({x:i,y:i%2}));expect(simplifyFogBrush(points,1)).toEqual(simplifyFogBrush(points,1));expect(simplifyFogBrush(points,1).length).toBeLessThanOrEqual(256)});
});
