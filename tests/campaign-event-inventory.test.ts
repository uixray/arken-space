import {it,expect} from 'vitest';
import {inspectEventProducers} from '../scripts/qa/campaign-event-inventory.mjs';
it('inventories literal, conditional, template and opaque event producers without evaluating code',()=>{
 const source="tx.insert(gameEvents).values({type:'chat.created',entityType:'chat'}); tx.insert(gameEvents).values({type:flag?'entry.roll':'entry.shared',entityType:'chat'}); tx.insert(gameEvents).values({type:`canvas.${direction}`,entityType:'scene'});tx.insert(gameEvents).values(event);";
 const rows=inspectEventProducers(source);expect(rows).toHaveLength(4);expect(rows[0].type).toBe('chat.created');expect(rows[1].type).toBeNull();expect(rows[2].typeExpression).toContain('${direction}');expect(rows[3].objectLiteral).toBe(false);
});
it('does not confuse nested payload type or other tables with the actual event type',()=>{
 const source="tx.insert(other).values({type:'ignore'});tx.insert(gameEvents).values([{type:'a',payload:{type:'secret'}},{...event,type:'b'}]);";const rows=inspectEventProducers(source);expect(rows.map(row=>row.type)).toEqual(['a','b']);expect(rows[1].spread).toBe(true);
});
it('tracks database import aliases and shorthand fields as unresolved expressions',()=>{
 const source="import {gameEvents as history} from '@arken/db';import * as schema from '@arken/db';tx.insert(history).values({type,entityType});tx.insert(schema.gameEvents).values({type:'ENCOUNTER_STARTED',entityType:'ENCOUNTER'});";
 const rows=inspectEventProducers(source);expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({type:null,typeExpression:'type',entityType:null,entityExpression:'entityType'});expect(rows[1].type).toBe('ENCOUNTER_STARTED');
});
it('does not treat unrelated namespace tables as imported database events',()=>{
 const rows=inspectEventProducers("import * as other from 'unrelated';tx.insert(other.gameEvents).values({type:'ignore'});");expect(rows).toEqual([]);
});
it('resolves finite nested conditional strings without executing conditions',()=>{
 const [row]=inspectEventProducers("tx.insert(gameEvents).values({type:mode==='EXECUTE'?'entry.roll':(flag?'entry.shared':'entry.undo'),entityType:'chat'});");expect(row.typeCandidates).toEqual(['entry.roll','entry.shared','entry.undo']);expect(row.entityCandidates).toEqual(['chat']);expect(row.type).toBeNull();
});
it('keeps mixed dynamic conditionals unresolved rather than dropping a branch',()=>{
 const [row]=inspectEventProducers("tx.insert(gameEvents).values({type:flag?'known':runtime,entityType:'chat'});");expect(row.typeCandidates).toBeNull();
});
it('resolves earlier lexical const values and respects parameter shadowing',()=>{
 const source="const type='outer';function a(){const type=flag?'a':'b';tx.insert(gameEvents).values({type,entityType:'chat'});}function b(type){tx.insert(gameEvents).values({type,entityType:'chat'});}";
 const rows=inspectEventProducers(source);expect(rows[0].typeCandidates).toEqual(['a','b']);expect(rows[1].typeCandidates).toBeNull();
});
it('keeps mutable and forward declarations unresolved',()=>{
 const rows=inspectEventProducers("let type='a';tx.insert(gameEvents).values({type,entityType:'chat'});function f(){tx.insert(gameEvents).values({type:later,entityType:'chat'});const later='b';}");expect(rows.every(row=>row.typeCandidates===null)).toBe(true);
});
