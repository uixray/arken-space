import {spawn} from "node:child_process";
import {join} from "node:path";
export interface LocalSecretProtector {protect(data:Uint8Array,context:string):Promise<Uint8Array>;unprotect(data:Uint8Array,context:string):Promise<Uint8Array>;}
const command=`$ErrorActionPreference='Stop';try { Add-Type -AssemblyName System.Security; $r=[Console]::In.ReadToEnd()|ConvertFrom-Json; $b=[Convert]::FromBase64String($r.data); $e=[Text.Encoding]::UTF8.GetBytes($r.context); $s=[Security.Cryptography.DataProtectionScope]::CurrentUser; if($r.operation -eq 'protect'){$o=[Security.Cryptography.ProtectedData]::Protect($b,$e,$s)}elseif($r.operation -eq 'unprotect'){$o=[Security.Cryptography.ProtectedData]::Unprotect($b,$e,$s)}else{throw 'invalid'}; [Console]::Out.Write([Convert]::ToBase64String($o)); exit 0 }catch{[Console]::Error.Write('SECRET_OPERATION_FAILED');exit 1}`;
/** OS adapter, no plaintext or home-grown wrapping-key fallback. Secrets travel
 * over bounded stdin, never command-line arguments or diagnostic output. */
export function createWindowsSecretProtector():LocalSecretProtector{
 const invoke=(operation:"protect"|"unprotect",data:Uint8Array,context:string):Promise<Uint8Array>=>{
  if(process.platform!=="win32"||!process.env.SystemRoot||data.byteLength>32768||context.length>2048)return Promise.reject(Error("LOCAL_SECRET_STORE_UNAVAILABLE"));
  return new Promise((resolve,reject)=>{
   const child=spawn(join(process.env.SystemRoot!,"System32","WindowsPowerShell","v1.0","powershell.exe"),["-NoLogo","-NoProfile","-NonInteractive","-Command",command],{windowsHide:true,stdio:["pipe","pipe","ignore"]});
   let done=false,size=0;const output:Buffer[]=[];
   const finish=(failed:boolean)=>{if(done)return;done=true;clearTimeout(timer);if(failed){child.kill();reject(Error("LOCAL_SECRET_OPERATION_FAILED"));return;}
    const value=Buffer.concat(output).toString("utf8");if(!value||!/^[A-Za-z0-9+/]+={0,2}$/.test(value)){reject(Error("LOCAL_SECRET_OPERATION_FAILED"));return;}
    const bytes=Buffer.from(value,"base64");if(bytes.toString("base64")!==value){reject(Error("LOCAL_SECRET_OPERATION_FAILED"));return;}resolve(bytes);
   };
   const timer=setTimeout(()=>finish(true),10000);
   child.on("error",()=>finish(true));child.stdin.on("error",()=>finish(true));
   child.stdout.on("data",part=>{size+=part.length;if(size>65536){finish(true);return;}output.push(Buffer.from(part));});
   child.once("close",code=>finish(code!==0));
   child.stdin.end(JSON.stringify({operation,data:Buffer.from(data).toString("base64"),context}));
  });
 };
 return {protect:(data,context)=>invoke("protect",data,context),unprotect:(data,context)=>invoke("unprotect",data,context)};
}
