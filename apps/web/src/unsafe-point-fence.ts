import type {GameSocket} from './realtime';
/** Old point-event wire fields are numbers. Never infer an int64 identity from
 * rounded bytes: request one canonical snapshot carrying snapshotSequence. */
export function fenceUnsafePointEvents(socket:GameSocket){
 const original=socket.on.bind(socket);let pending=false;
 socket.on=((event,listener)=>original(event,((...args:unknown[])=>{
  if(event==='game:snapshot')pending=false;
  const payload=args[0];
  if(payload&&typeof payload==='object'&&'sequence' in payload&&typeof payload.sequence==='number'&&!Number.isSafeInteger(payload.sequence)){
   if(!pending){pending=true;socket.emit('game:resync');}return;
  }
  (listener as (...args:unknown[])=>void)(...args);
 }) as never)) as GameSocket['on'];
}
