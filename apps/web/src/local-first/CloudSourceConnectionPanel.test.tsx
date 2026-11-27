// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from "vitest";
import {fireEvent,renderComponent,screen,waitFor} from "../test-support/render";
import {CloudSourceConnectionPanel} from "./CloudSourceConnectionPanel";
const mocked=vi.hoisted(()=>({api:vi.fn()}));vi.mock("../api",()=>({api:mocked.api}));
const id="11111111-1111-4111-8111-111111111111",scope={campaignId:id,hostId:id,sessionId:id,epoch:1};
const grant={grantId:id,originId:id,origin:scope,token:"t".repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString(),scope:"STAGING_ONLY"};
beforeEach(()=>{mocked.api.mockReset().mockImplementation(async(path:string)=>path.endsWith("/connect")?{originId:id,mode:"INBOX_ONLY"}:path.endsWith("/revoke")?{ok:true}:grant);localStorage.clear();sessionStorage.clear();});
async function open(){const view=renderComponent(<CloudSourceConnectionPanel campaignId={id} csrfToken="csrf"/>);const details=screen.getByText("Подключить автономную сессию").closest("details")!;details.open=true;fireEvent(details,new Event("toggle"));await screen.findByLabelText("Данные локальной сессии");return {view,details};}
it("registers a bounded scope, displays a private key and clears it on revoke and close",async()=>{
 const {details}=await open();fireEvent.change(screen.getByLabelText("Данные локальной сессии"),{target:{value:JSON.stringify(scope)}});fireEvent.click(screen.getByRole("button",{name:"Получить новый ключ сессии"}));
 const output=await screen.findByLabelText("Секретный ключ для локальной установки");expect(output.getAttribute("data-private")).toBe("true");expect(screen.getByRole("textbox",{name:"Секретный ключ для локальной установки"})).toBe(output);expect((output as HTMLTextAreaElement).value).toContain(grant.token);
 expect(mocked.api.mock.calls[0]![1].headers["x-csrf-token"]).toBe("csrf");expect(JSON.parse(mocked.api.mock.calls[0]![1].body)).toEqual({campaignId:id,origin:scope});expect(localStorage.length+sessionStorage.length).toBe(0);
 fireEvent.click(screen.getByRole("button",{name:"Отозвать ключ сессии"}));await screen.findByText("Ключ этой локальной сессии отозван.");expect(screen.queryByLabelText("Секретный ключ для локальной установки")).toBeNull();
 details.open=false;fireEvent(details,new Event("toggle"));await waitFor(()=>expect(screen.queryByLabelText("Данные локальной сессии")).toBeNull());
});
it("rejects another campaign before requesting and masks backend errors",async()=>{
 await open();const input=screen.getByLabelText("Данные локальной сессии");fireEvent.change(input,{target:{value:JSON.stringify({...scope,campaignId:"22222222-2222-4222-8222-222222222222"})}});fireEvent.click(screen.getByRole("button",{name:"Получить новый ключ сессии"}));await screen.findByText(/Не удалось выполнить действие/);expect(mocked.api).not.toHaveBeenCalled();
 mocked.api.mockRejectedValue(Error("PRIVATE_SECRET"));fireEvent.change(input,{target:{value:JSON.stringify(scope)}});fireEvent.click(screen.getByRole("button",{name:"Получить новый ключ сессии"}));await screen.findByText(/Не удалось выполнить действие/);expect(document.body.textContent).not.toContain("PRIVATE_SECRET");
});
it("discards a late key response after closing",async()=>{
 let resolve!:(value:unknown)=>void;mocked.api.mockImplementation(async(path:string)=>path.endsWith("/connect")?{originId:id,mode:"INBOX_ONLY"}:new Promise(done=>{resolve=done;}));
 const {details}=await open();fireEvent.change(screen.getByLabelText("Данные локальной сессии"),{target:{value:JSON.stringify(scope)}});fireEvent.click(screen.getByRole("button",{name:"Получить новый ключ сессии"}));await waitFor(()=>expect(mocked.api).toHaveBeenCalledTimes(2));details.open=false;fireEvent(details,new Event("toggle"));await waitFor(()=>expect(screen.queryByLabelText("Данные локальной сессии")).toBeNull());resolve(grant);await Promise.resolve();expect(screen.queryByLabelText("Секретный ключ для локальной установки")).toBeNull();
});

it("passes the imported archive proof without treating it as grant authority fields",async()=>{await open();const transferProof={manifestSha256:"a".repeat(64),baselineSequence:"9007199254740993",schemaDigest:"b".repeat(64)};fireEvent.change(screen.getByLabelText("Данные локальной сессии"),{target:{value:JSON.stringify({...scope,transferProof})}});fireEvent.click(screen.getByRole("button",{name:"Получить новый ключ сессии"}));await screen.findByLabelText("Секретный ключ для локальной установки");expect(JSON.parse(mocked.api.mock.calls[0]![1].body)).toEqual({campaignId:id,origin:{...scope,transferProof}});expect(screen.getByRole("status").textContent).toContain("Архив переноса распознан");expect(localStorage.length+sessionStorage.length).toBe(0);});

it("shows actual stored/applied metadata and keeps pagination source-bound",async()=>{
 const snapshot={originId:id,writer:{mode:'LOCAL',revision:'9007199254740993',isSelectedSource:true},source:{closed:false,archiveRecognized:true,receivedThrough:'9007199254740995',appliedThrough:'9007199254740994'},receipts:[{receiptId:id,batchHash:'a'.repeat(64),lastSequence:'9007199254740994',state:'APPLIED'},{receiptId:'22222222-2222-4222-8222-222222222222',batchHash:'b'.repeat(64),lastSequence:'9007199254740995',state:'STORED_ONLY'}],next:{lastSequence:'9007199254740995',receiptId:id}};
 mocked.api.mockImplementation(async(path:string)=>path.endsWith('/connect')?{originId:id,mode:'INBOX_ONLY'}:path.endsWith('/status')?snapshot:grant);
 await open();fireEvent.change(screen.getByLabelText('Данные локальной сессии'),{target:{value:JSON.stringify(scope)}});fireEvent.click(screen.getByRole('button',{name:'Получить новый ключ сессии'}));await screen.findByLabelText('Секретный ключ для локальной установки');
 fireEvent.click(screen.getByRole('button',{name:'Показать состояние синхронизации'}));await screen.findByText('Право записи: эта локальная сессия.');await screen.findByText('Пакет до события 9007199254740994: применён к кампании.');await screen.findByText('Пакет до события 9007199254740995: сохранён, ожидает применения.');
 expect(screen.queryByLabelText('Секретный ключ для локальной установки')).toBeNull();expect(localStorage.length+sessionStorage.length).toBe(0);
 fireEvent.click(screen.getByRole('button',{name:'Следующие пакеты'}));await waitFor(()=>expect(mocked.api.mock.calls.filter(([p])=>p.endsWith('/status'))).toHaveLength(2));const call=mocked.api.mock.calls.at(-1)!;expect(JSON.parse(call[1].body)).toEqual({campaignId:id,after:snapshot.next});
 fireEvent.change(screen.getByLabelText('Данные локальной сессии'),{target:{value:'changed'}});expect(screen.queryByLabelText('Состояние синхронизации локальной сессии')).toBeNull();
});

it("rejects a status response bound to a different source",async()=>{
 mocked.api.mockImplementation(async(path:string)=>path.endsWith('/connect')?{originId:id,mode:'INBOX_ONLY'}:path.endsWith('/status')?{originId:'22222222-2222-4222-8222-222222222222',writer:{mode:'HOSTED',revision:'0',isSelectedSource:false},source:{closed:false,archiveRecognized:false,receivedThrough:null,appliedThrough:null},receipts:[],next:null}:grant);
 await open();fireEvent.change(screen.getByLabelText('Данные локальной сессии'),{target:{value:JSON.stringify(scope)}});fireEvent.click(screen.getByRole('button',{name:'Получить новый ключ сессии'}));await screen.findByLabelText('Секретный ключ для локальной установки');fireEvent.click(screen.getByRole('button',{name:'Показать состояние синхронизации'}));await screen.findByText(/Не удалось выполнить действие/);expect(screen.queryByLabelText('Состояние синхронизации локальной сессии')).toBeNull();
});

it("recovers only a read-receipts key directly from the closed-session descriptor",async()=>{
 mocked.api.mockImplementation(async()=>({...grant,scope:'READ_RECEIPTS_ONLY'}));await open();fireEvent.change(screen.getByLabelText('Данные локальной сессии'),{target:{value:JSON.stringify(scope)}});fireEvent.click(screen.getByRole('button',{name:'Получить ключ подтверждений закрытой сессии'}));await screen.findByLabelText('Секретный ключ для локальной установки');expect(screen.getByRole('status').textContent).toContain('Ключ читает подтверждения закрытой сессии');expect(mocked.api).toHaveBeenCalledTimes(1);expect(mocked.api.mock.calls[0]![0]).toBe('/api/account/cloud-sync/receipt-read-grant');expect(JSON.parse(mocked.api.mock.calls[0]![1].body)).toEqual({campaignId:id,origin:scope});expect(localStorage.length+sessionStorage.length).toBe(0);
});
