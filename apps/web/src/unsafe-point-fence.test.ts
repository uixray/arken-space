import {it,expect,vi} from 'vitest';import {fenceUnsafePointEvents} from './unsafe-point-fence';import type {GameSocket} from './realtime';
it('requests one exact canonical resync instead of applying rounded point identities',()=>{
 const handlers=new Map<string,Function>(),emit=vi.fn();const socket={on:(event:string,fn:Function)=>{handlers.set(event,fn);return socket;},emit} as unknown as GameSocket;
 fenceUnsafePointEvents(socket);const point=vi.fn(),full=vi.fn();socket.on('character:updated',point);socket.on('game:snapshot',full);
 handlers.get('character:updated')!({sequence:9007199254743016});handlers.get('character:updated')!({sequence:9007199254743018});expect(point).not.toHaveBeenCalled();expect(emit).toHaveBeenCalledTimes(1);
 handlers.get('game:snapshot')!({});handlers.get('character:updated')!({sequence:9007199254743018});expect(emit).toHaveBeenCalledTimes(2);
 handlers.get('character:updated')!({sequence:12});expect(point).toHaveBeenCalledOnce();
});
