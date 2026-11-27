import {it,expect} from 'vitest';
import {inspectTransferEventCoverage,assertTransferEventCoverage} from './campaign-transfer-event-coverage.js';
it('rejects an unknown type or known type with another entity domain',()=>{for(const group of [{type:'future.secret',entityType:'chat',count:'1'},{type:'chat.created',entityType:'character',count:'1'}])expect(()=>assertTransferEventCoverage([group])).toThrow('HANDLER_REQUIRED');});
it('counts arbitrary PostgreSQL bigints without rounding and does not equate coverage with validation',()=>{expect(inspectTransferEventCoverage([{type:'chat.created',entityType:'chat',count:'9007199254740993'},{type:'entry.undo',entityType:'chat',count:'2'}]).totalRows).toBe('9007199254740995');});
it('rejects malformed counts',()=>{for(const count of ['-1','1.2','1e3','01'])expect(()=>assertTransferEventCoverage([{type:'chat.created',entityType:'chat',count}])).toThrow('COUNT_INVALID');});
