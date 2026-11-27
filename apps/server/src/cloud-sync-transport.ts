import type {FastifyRequest} from "fastify";
import {isIP} from "node:net";
function normalized(ip:string){
 if(ip.startsWith("::ffff:")&&isIP(ip.slice(7))===4)return ip.slice(7);
 if(isIP(ip)===6)return new URL(`http://[${ip}]`).hostname;
 return ip;
}
/** Never use request.ip/protocol or forwarded-for as evidence of the TCP peer.
 * Configured TLS terminators must overwrite, not append/forward, client XFP. */
export function isSecureCloudSyncTransport(request:Pick<FastifyRequest,"raw"|"headers">,trustedPeers:readonly string[]){
 const socket=request.raw.socket as typeof request.raw.socket&{encrypted?:boolean};
 if(socket.encrypted===true)return true;
 if(!socket.remoteAddress||request.headers["x-forwarded-proto"]!=="https")return false;
 const remote=normalized(socket.remoteAddress);
 return trustedPeers.some(peer=>isIP(peer)!==0&&normalized(peer)===remote);
}
