// @vitest-environment jsdom
import {it,expect,vi} from "vitest";
import type {GameSnapshot} from "@arken/contracts";
import {renderComponent} from "./test-support/render";
import {GameReadOnlyProvider} from "./game-read-only";
import {useEntryApplication} from "./use-entry-application";
import {api} from "./api";
vi.mock("./api",()=>({api:vi.fn(),formatApiError:(e:Error)=>e.message}));
it("blocks recovery, cancellation and new execution in a read-only copy before network or storage writes",async()=>{
 let application:ReturnType<typeof useEntryApplication>|undefined;
 const snapshot={campaign:{id:"10000000-0000-4000-8000-000000000001"},me:{id:"10000000-0000-4000-8000-000000000002"}} as GameSnapshot;
 function Probe(){application=useEntryApplication(snapshot,vi.fn());return null;}
 const view=renderComponent(<GameReadOnlyProvider value><Probe/></GameReadOnlyProvider>);
 const before=JSON.stringify({...localStorage});
 try{await expect(application!.recover()).rejects.toThrow("только для чтения");await expect(application!.cancel()).rejects.toThrow("только для чтения");await expect(application!.submit({characterId:"c",entryId:"e",label:"Read only",body:{}})).rejects.toThrow("только для чтения");expect(api).not.toHaveBeenCalled();expect(JSON.stringify({...localStorage})).toBe(before);}finally{view.unmount();}
});
