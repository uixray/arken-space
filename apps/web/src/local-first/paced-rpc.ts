/** Leave margin below the host's 20 requests/second bound, including media chunks. */
export function createPacedRpc(rpc:{request<T=unknown>(input:unknown):Promise<T>},signal:AbortSignal){
  let busy=false,lastStart=-Infinity;
  return async function request<T=unknown>(input:unknown):Promise<T>{
    signal.throwIfAborted();if(busy)throw Error("CHANNEL_REQUEST_PENDING");busy=true;
    try{
      const wait=Math.max(0,60-(performance.now()-lastStart));
      if(wait)await new Promise<void>((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(signal.reason);};
        const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},wait);
        signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
      });
      signal.throwIfAborted();lastStart=performance.now();return await rpc.request<T>(input);
    }finally{busy=false;}
  };
}
