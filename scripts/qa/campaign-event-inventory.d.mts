export type EventProducer={file:string;line:number;type:string|null;typeExpression:string|null;typeCandidates:string[]|null;entityType:string|null;entityExpression:string|null;entityCandidates:string[]|null;spread:boolean;objectLiteral:boolean};
export function inspectEventProducers(source:string,file?:string):EventProducer[];
export function inventoryEventProducers(root:string):Promise<{producerCount:number;literalTypes:string[];dynamic:EventProducer[];producers:EventProducer[]}>;
