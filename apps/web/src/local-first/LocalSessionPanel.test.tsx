// @vitest-environment jsdom
import { beforeEach,expect,it,vi } from "vitest";
import { fireEvent,renderComponent,screen,waitFor } from "../test-support/render";
import { LocalSessionPanel } from "./LocalSessionPanel";
const request=vi.hoisted(()=>vi.fn());
vi.mock("../api",()=>({api:request,formatApiError:(e:Error)=>e.message}));
const campaignId="10000000-0000-4000-8000-000000000001",gm="10000000-0000-4000-8000-000000000002",player="10000000-0000-4000-8000-000000000003";
const authority={campaignId,sessionId:"10000000-0000-4000-8000-000000000004",hostId:"10000000-0000-4000-8000-000000000005",epoch:1};
const members=[{id:gm,role:"GM" as const,displayName:"Мастер",revision:0,characterId:null},{id:player,role:"PLAYER" as const,displayName:"Игрок",revision:0,characterId:null}];
let active=false;
beforeEach(()=>{
  active=false;window.localStorage.clear();window.sessionStorage.clear();request.mockReset();
  request.mockImplementation(async(path:string)=>{
    if(path.endsWith("/cloud/status"))return {state:"UNAVAILABLE",target:null,expiresAt:null};
    if(path.endsWith("/status"))return {active,lastEpoch:active?1:0,...(active?{authority}:{})};
    if(path.endsWith("/start")){active=true;return authority;}
    if(path.endsWith("/stop")){active=false;return {ok:true};}
    if(path.endsWith("/pairings"))return {authority,pairingId:crypto.randomUUID(),token:"s".repeat(43),expiresInSeconds:300};
    return {ok:true};
  });
});
async function open(){
  renderComponent(<LocalSessionPanel campaignId={campaignId} membershipId={gm} members={members}/>);
  expect(request).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Автономная сессия"}));
  await screen.findByText("Локальная сессия остановлена");
}
async function start(){await open();fireEvent.click(screen.getByRole("button",{name:"Запустить локальную сессию"}));await screen.findByText(/Локальная сессия запущена/);}
it("loads only on demand and binds requests to campaign and membership",async()=>{
  await open();const init=request.mock.calls[0]![1] as RequestInit;
  expect(new Headers(init.headers).get("x-arken-membership-id")).toBe(gm);
  expect(new Headers(init.headers).get("x-arken-campaign-id")).toBe(campaignId);
});
it("creates a scoped private code and clears it on close without persistent storage",async()=>{
  await start();fireEvent.click(screen.getByRole("button",{name:"Создать одноразовое подключение"}));
  const code=await screen.findByRole("textbox",{name:"Код подключения"});
  expect(JSON.parse((code as HTMLTextAreaElement).value)).toMatchObject({authority,token:"s".repeat(43)});
  expect(window.localStorage.length).toBe(0);expect(window.sessionStorage.length).toBe(0);
  fireEvent.click(screen.getByRole("button",{name:/^Закрыть/}));
  await waitFor(()=>expect(screen.queryByRole("textbox",{name:"Код подключения"})).not.toBeInTheDocument());
});
it("requires confirmation before revoking the entire session",async()=>{
  await start();fireEvent.click(screen.getByRole("button",{name:"Остановить и отозвать подключения"}));
  expect(request.mock.calls.some(([path])=>path.endsWith("/stop"))).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Подтвердить остановку"}));
  await screen.findByText("Локальная сессия остановлена");
  expect(request.mock.calls.find(([path])=>path.endsWith("/stop"))![1].body).toBe(JSON.stringify({expectedEpoch:1}));
});
it("does not expose a secret from a delayed response after closing",async()=>{
  await start();let resolve!:(v:unknown)=>void;
  request.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  fireEvent.click(screen.getByRole("button",{name:"Создать одноразовое подключение"}));
  fireEvent.click(screen.getByRole("button",{name:/^Закрыть/}));
  resolve({authority,pairingId:crypto.randomUUID(),token:"x".repeat(43),expiresInSeconds:300});
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(document.body.textContent).not.toContain("x".repeat(43));
});

it("shows only an owner aggregate and explicit pending delivery status",async()=>{
 const original=request.getMockImplementation()!;
 request.mockImplementation(async(path:string,...args:unknown[])=>path.endsWith("/status")?{active:false,lastEpoch:0,outbox:{pendingEvents:7,limited:false,delivery:"NOT_CONFIGURED"}}:original(path,...args));
 await open();expect(screen.getByText("События, сохранённые на этом мастере: 7.")).toBeTruthy();
 expect(screen.getByText(/Автоматическая передача в облако ещё не настроена/)).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Обновить очередь"}));
 await waitFor(()=>expect(request.mock.calls.filter(call=>String(call[0]).endsWith("/status")).length).toBe(2));
});
