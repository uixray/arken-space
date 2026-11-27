/** Source inventory, not a proof of historical payload compatibility. Never
 * evaluates application command producers or connects to a database. */
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {inventoryEventProducers} from './campaign-event-inventory.mjs';
import {inspectTransferEventCoverage} from '../../apps/server/src/campaign-transfer-event-coverage.js';
const inventory=await inventoryEventProducers(resolve('apps/server/src'));
const groups=[...new Map(inventory.producers.flatMap(p=>p.typeCandidates&&p.entityCandidates?p.typeCandidates.flatMap(type=>p.entityCandidates!.map(entityType=>[type+'|'+entityType,{type,entityType,count:'0'}] as const)):[])).values()];
const coverage=inspectTransferEventCoverage(groups);
const report={scope:'STATIC_FINITE_EXPRESSION_PAIRS_ONLY',producerCount:inventory.producerCount,literalTypes:inventory.literalTypes,literalPairs:groups.length,unsupported:coverage.unsupported,unresolved:inventory.producers.filter(p=>!p.typeCandidates||!p.entityCandidates||p.spread||!p.objectLiteral)};
if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2));
console.log(JSON.stringify({scope:report.scope,producerCount:report.producerCount,literalPairs:report.literalPairs,unsupported:report.unsupported.length,unresolved:report.unresolved.length}));
if(report.unsupported.length)process.exitCode=1;
