/** Bounded, reliable RPC framing. An open channel is NOT proof of host identity. */
const CHUNK=8192,MAX_FRAME=16000,MAX_REQUEST=32768,MAX_RESPONSE=8*1024*1024;
type Kind="REQUEST"|"RESPONSE";
type Frame={v:1;id:string;kind:Kind;bytes:number;index:number;parts:number;data:string};
type Assembly={id:string;kind:Kind;bytes:Uint8Array;offset:number;next:number;parts:number};
type Pending={id:string;resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
const encode=(bytes:Uint8Array)=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(""));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bindDataChannelRpc(channel:RTCDataChannel,options:{
  role:"CLIENT"|"HOST";
  /** Trusted host adapter must authenticate every request, including retries. */
  handle?:(request:unknown,signal:AbortSignal)=>Promise<unknown>;
  onClose?:()=>void;
}){
  if(!channel.ordered||channel.maxRetransmits!==null||channel.maxPacketLifeTime!==null)throw Error("RELIABLE_CHANNEL_REQUIRED");
  let closed=false,busy=false,assembly:Assembly|null=null,pending:Pending|null=null,windowStart=performance.now(),requestCount=0;
  const encoder=new TextEncoder(),decoder=new TextDecoder("utf-8",{fatal:true});
  const controller=new AbortController();
  channel.bufferedAmountLowThreshold=65536;
  const finish=(error?:Error,value?:unknown)=>{const p=pending;pending=null;if(p){clearTimeout(p.timer);if(error)p.reject(error);else p.resolve(value);}};
  const close=()=>{if(closed)return;closed=true;assembly=null;controller.abort();finish(Error("CHANNEL_CLOSED_RESULT_UNCERTAIN"));
    channel.removeEventListener("message",receive);channel.removeEventListener("close",close);channel.removeEventListener("error",close);channel.close();options.onClose?.();};
  const writable=async()=>{
    if(closed||channel.readyState!=="open")throw Error("CHANNEL_NOT_READY");
    if(channel.bufferedAmount<=262144)return;
    await new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);channel.removeEventListener("bufferedamountlow",low);controller.signal.removeEventListener("abort",abort);};
      const low=()=>{cleanup();resolve();},abort=()=>{cleanup();reject(Error("CHANNEL_CLOSED"));};
      const timer=setTimeout(()=>{cleanup();reject(Error("CHANNEL_BACKPRESSURE"));},5000);
      channel.addEventListener("bufferedamountlow",low);controller.signal.addEventListener("abort",abort,{once:true});
      if(closed)abort();else if(channel.bufferedAmount<=65536)low();
    });
  };
  const send=async(id:string,kind:Kind,value:unknown)=>{
    const bytes=encoder.encode(JSON.stringify(value));
    if(!bytes.length||bytes.length>(kind==="REQUEST"?MAX_REQUEST:MAX_RESPONSE))throw Error("CHANNEL_PAYLOAD_LIMIT");
    const parts=Math.ceil(bytes.length/CHUNK);
    for(let index=0;index<parts;index++){
      await writable();if(closed)throw Error("CHANNEL_CLOSED");
      const frame:Frame={v:1,id,kind,bytes:bytes.length,index,parts,data:encode(bytes.subarray(index*CHUNK,(index+1)*CHUNK))};
      channel.send(JSON.stringify(frame));
    }
  };
  const deliver=async(id:string,value:unknown)=>{
    if(options.role==="CLIENT"){
      const result=value as {ok?:unknown;value?:unknown};
      if(!result||typeof result!=="object"||result.ok!==true)finish(Error("PEER_REQUEST_REJECTED"));
      else finish(undefined,result.value);
      return;
    }
    try{
      const result=await options.handle!(value,controller.signal);
      if(!closed)await send(id,"RESPONSE",{ok:true,value:result});
    }catch{
      // SQL, credentials, request payload and exception text never cross here.
      if(!closed)try{await send(id,"RESPONSE",{ok:false});}catch{close();}
    }finally{busy=false;}
  };
  function receive(event:MessageEvent){
    if(closed)return;
    try{
      if(typeof event.data!=="string"||event.data.length>MAX_FRAME)throw Error();
      const f=JSON.parse(event.data) as Frame;
      const expected:Kind=options.role==="CLIENT"?"RESPONSE":"REQUEST";
      const limit=expected==="REQUEST"?MAX_REQUEST:MAX_RESPONSE;
      if(!f||Object.keys(f).length!==7||f.v!==1||f.kind!==expected||typeof f.id!=="string"||!uuid.test(f.id)||
        !Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>limit||!Number.isSafeInteger(f.parts)||f.parts!==Math.ceil(f.bytes/CHUNK)||
        !Number.isSafeInteger(f.index)||f.index<0||f.index>=f.parts||typeof f.data!=="string"||f.data.length>Math.ceil(CHUNK/3)*4)throw Error();
      if(options.role==="CLIENT"&&f.id!==pending?.id)throw Error();
      if(!assembly){
        if(f.index!==0||busy)throw Error();
        if(options.role==="HOST"){
          const now=performance.now();if(now-windowStart>=1000){windowStart=now;requestCount=0;}
          if(!options.handle||++requestCount>20)throw Error();
        }
        assembly={id:f.id,kind:f.kind,bytes:new Uint8Array(f.bytes),offset:0,next:0,parts:f.parts};
      }
      const a=assembly;
      if(a.id!==f.id||a.kind!==f.kind||a.bytes.length!==f.bytes||a.parts!==f.parts||a.next!==f.index)throw Error();
      const binary=atob(f.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      if(encode(bytes)!==f.data||bytes.length!==Math.min(CHUNK,a.bytes.length-a.offset))throw Error();
      a.bytes.set(bytes,a.offset);a.offset+=bytes.length;a.next++;
      if(a.next===a.parts){
        if(a.offset!==a.bytes.length)throw Error();
        const value=JSON.parse(decoder.decode(a.bytes));assembly=null;
        busy=options.role==="HOST";void deliver(a.id,value);
      }
    }catch{close();}
  }
  channel.addEventListener("message",receive);channel.addEventListener("close",close);channel.addEventListener("error",close);
  return {
    request<T=unknown>(value:unknown,timeoutMs=15000):Promise<T>{
      if(options.role!=="CLIENT"||closed||channel.readyState!=="open")return Promise.reject(Error("CHANNEL_NOT_READY"));
      if(pending)return Promise.reject(Error("CHANNEL_REQUEST_PENDING"));
      if(!Number.isFinite(timeoutMs)||timeoutMs<100||timeoutMs>30000)return Promise.reject(Error("INVALID_TIMEOUT"));
      return new Promise<T>((resolve,reject)=>{
        const id=crypto.randomUUID(),timer=setTimeout(()=>{finish(Error("CHANNEL_TIMEOUT_RESULT_UNCERTAIN"));close();},timeoutMs);
        pending={id,resolve:result=>resolve(result as T),reject,timer};
        void send(id,"REQUEST",value).catch(()=>close());
      });
    },close,
  };
}
