import {expect,it} from "vitest";
import {isSecureCloudSyncTransport} from "./cloud-sync-transport.js";
const request=(remoteAddress:string,forwarded:unknown,encrypted=false)=>({raw:{socket:{remoteAddress,encrypted}},headers:{"x-forwarded-proto":forwarded,"x-forwarded-for":"127.0.0.1"},protocol:"https",ip:"127.0.0.1"}) as any;
it("trusts real TLS or an explicitly configured TCP peer, not forwarded identity",()=>{
 expect(isSecureCloudSyncTransport(request("203.0.113.1","https"),[])).toBe(false);
 expect(isSecureCloudSyncTransport(request("203.0.113.1","https"),["127.0.0.1"])).toBe(false);
 expect(isSecureCloudSyncTransport(request("127.0.0.1","https"),["127.0.0.1"])).toBe(true);
 expect(isSecureCloudSyncTransport(request("::ffff:127.0.0.1","https"),["127.0.0.1"])).toBe(true);
 expect(isSecureCloudSyncTransport(request("::1","https"),["::1"])).toBe(true);
 expect(isSecureCloudSyncTransport(request("203.0.113.1",undefined,true),[])).toBe(true);
 for(const header of [undefined,"http","https,http",["https"]])expect(isSecureCloudSyncTransport(request("127.0.0.1",header),["127.0.0.1"])).toBe(false);
});
