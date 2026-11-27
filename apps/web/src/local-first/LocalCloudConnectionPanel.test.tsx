// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from "vitest";
import {fireEvent,renderComponent,screen,waitFor} from "../test-support/render";
import {LocalCloudConnectionPanel} from "./LocalCloudConnectionPanel";
const mocked=vi.hoisted(()=>({api:vi.fn()}));vi.mock("../api",()=>({api:mocked.api}));
const id="11111111-1111-4111-8111-111111111111",authority={hostId:id,campaignId:id,sessionId:id,epoch:1};
const disconnected={state:"DISCONNECTED",target:"https://cloud.example.invalid",expiresAt:null};
beforeEach(()=>{mocked.api.mockReset().mockImplementation(async()=>disconnected);localStorage.clear();sessionStorage.clear();});
it("shows the configured target and clears invalid pasted secrets without diagnostics or storage",async()=>{
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);await screen.findByText("Ключ подключения не сохранён.");
 const field=screen.getByLabelText("Ключ подключения облака");fireEvent.change(field,{target:{value:"TOP-SECRET-NOT-JSON"}});fireEvent.click(screen.getByRole("button",{name:"Сохранить ключ облака"}));
 expect((field as HTMLInputElement).value).toBe("");expect(screen.getByRole("alert").textContent).toBe("Некорректный ключ подключения.");expect(mocked.api).toHaveBeenCalledTimes(1);expect(localStorage.length+sessionStorage.length).toBe(0);
});
it("clears a submitted secret and masks backend exceptions",async()=>{
 mocked.api.mockImplementation(async(path:string)=>{if(path.endsWith("/save"))throw Error("PRIVATE-KEY-IN-ERROR");return disconnected;});
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);await screen.findByText("Ключ подключения не сохранён.");
 const field=screen.getByLabelText("Ключ подключения облака");fireEvent.change(field,{target:{value:JSON.stringify({token:"PRIVATE"})}});fireEvent.click(screen.getByRole("button",{name:"Сохранить ключ облака"}));
 await waitFor(()=>expect(screen.getByRole("alert").textContent).not.toContain("PRIVATE"));expect((field as HTMLInputElement).value).toBe("");
});

it("sends only an empty owner command and distinguishes stored from applied",async()=>{
 const ready={...disconnected,state:"READY",expiresAt:new Date(Date.now()+3600000).toISOString(),storedThrough:null as string|null};
 mocked.api.mockImplementation(async(path:string)=>{if(path.endsWith("/send")){ready.storedThrough="7";return {state:"STORED_ONLY",sentEvents:2,storedThrough:"7"};}return {...ready};});
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);
 await screen.findByText("Ключ сохранён средствами защиты Windows.");
 fireEvent.click(screen.getByRole("button",{name:"Отправить пакет текущей сессии"}));
 await screen.findByText("Облако сохранило событий: 2. Игровые изменения ещё не применены.");
 await screen.findByText("Подтверждено облачное хранение до события 7 текущей сессии.");
 const sent=mocked.api.mock.calls.find(([path])=>path.endsWith("/send"));expect(JSON.parse(sent?.[1].body)).toEqual({scope:authority});expect(localStorage.length+sessionStorage.length).toBe(0);
});
it("shows an empty batch without implying application",async()=>{
 mocked.api.mockImplementation(async(path:string)=>path.endsWith("/send")?{state:"EMPTY",sentEvents:0,storedThrough:null}:{...disconnected,state:"READY",expiresAt:new Date(Date.now()+3600000).toISOString()});
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);await screen.findByText("Ключ сохранён средствами защиты Windows.");
 fireEvent.click(screen.getByRole("button",{name:"Отправить пакет текущей сессии"}));await screen.findByText("Новых событий текущей сессии для отправки нет.");
});

it("includes the immutable import baseline in the readonly descriptor without browser persistence",async()=>{const transferProof={manifestSha256:"a".repeat(64),baselineSequence:"9007199254740993",schemaDigest:"b".repeat(64)};renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id} transferProof={transferProof}/>);const field=await screen.findByLabelText("Данные локальной сессии для облака");expect((field as HTMLInputElement).readOnly).toBe(true);expect(JSON.parse((field as HTMLInputElement).value)).toEqual({...authority,transferProof});expect(localStorage.length+sessionStorage.length).toBe(0);});

it("checks campaign-wide coverage with an empty body and exact large sequence",async()=>{
 mocked.api.mockImplementation(async(path:string)=>path.endsWith('/preflight')?{status:'COVERED',checkedEvents:130,baselineSequence:'9007199254740993',throughSequence:'9007199254741253'}:disconnected);
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id} historical/>);await screen.findByText("Ключ подключения не сохранён.");
 fireEvent.click(screen.getByRole('button',{name:'Проверить полноту очереди кампании'}));
 await screen.findByText('На момент проверки в очереди сохранены все события после импорта. Проверено: 130.');
 expect(screen.getByText(/Проверено до события 9007199254741253/)).toBeTruthy();
 const sent=mocked.api.mock.calls.find(([path])=>path.endsWith('/preflight'));expect(JSON.parse(sent![1].body)).toEqual({});expect(sent![1].headers['x-arken-campaign-id']).toBe(id);
 expect(localStorage.length+sessionStorage.length).toBe(0);
 fireEvent.click(screen.getByRole('button',{name:'Обновить подключение'}));await waitFor(()=>expect(screen.queryByLabelText('Результат проверки очереди')).toBeNull());
});
it.each([
 ['BUSY','Кампания сейчас изменяется'],['NOT_IMPORTED','нет исходного архива'],['BASELINE_UNKNOWN','исходная точка переноса'],['MISSING_EVENTS','отсутствует событие 9007199254740995'],['INTEGRITY_CONFLICT','отличаются от журнала'],['EVENT_TOO_LARGE','превышает размер пакета'],['LIMIT_REACHED','Полнота очереди пока не подтверждена'],
])("explains coverage state %s without claiming readiness",async(status,text)=>{
 const result=['BUSY','NOT_IMPORTED','BASELINE_UNKNOWN'].includes(status)?{status,checkedEvents:0}:{status,checkedEvents:1,baselineSequence:'9007199254740993',throughSequence:'9007199254740995',firstProblemSequence:'9007199254740995'};
 mocked.api.mockImplementation(async(path:string)=>path.endsWith('/preflight')?result:disconnected);
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);await screen.findByText("Ключ подключения не сохранён.");fireEvent.click(screen.getByRole('button',{name:'Проверить полноту очереди кампании'}));
 await screen.findByText(new RegExp(text));expect(screen.queryByText(/На момент проверки в очереди/)).toBeNull();
});
it("rejects malformed coverage and masks backend details",async()=>{
 mocked.api.mockImplementation(async(path:string)=>path.endsWith('/preflight')?{status:'COVERED',checkedEvents:1}:disconnected);
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);await screen.findByText("Ключ подключения не сохранён.");fireEvent.click(screen.getByRole('button',{name:'Проверить полноту очереди кампании'}));
 await screen.findByText('Не удалось проверить очередь. Повторите проверку через несколько секунд.');expect(screen.queryByLabelText('Результат проверки очереди')).toBeNull();
});

it("checks applied progress with an empty scoped command and refreshes durable status",async()=>{
 let applied=false;mocked.api.mockImplementation(async(path:string)=>path.endsWith('/check')?(applied=true,{state:'APPLIED',appliedEvents:2,appliedThrough:'9007199254740995'}):{...disconnected,state:'READY',storedThrough:'9007199254740995',...(applied?{appliedThrough:'9007199254740995'}:{})});
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);await screen.findByText('Ключ сохранён средствами защиты Windows.');fireEvent.click(screen.getByRole('button',{name:'Проверить применение пакета'}));await screen.findByText('Подтверждено применение событий: 2.');await screen.findByText('Подтверждено применение до события 9007199254740995 текущей сессии.');
 const request=mocked.api.mock.calls.find(([path])=>path.endsWith('/check'));expect(JSON.parse(request![1].body)).toEqual({scope:authority});expect(localStorage.length+sessionStorage.length).toBe(0);
});

it("keeps staged packets distinct from application and masks failed confirmation reads",async()=>{
 let fail=false;mocked.api.mockImplementation(async(path:string)=>{if(path.endsWith('/check')){if(fail)throw Error('PRIVATE_REMOTE_DETAIL');return {state:'WAITING',appliedEvents:0,appliedThrough:null};}return {...disconnected,state:'READY'};});
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);await screen.findByText('Ключ сохранён средствами защиты Windows.');fireEvent.click(screen.getByRole('button',{name:'Проверить применение пакета'}));await screen.findByText('Пакет сохранён в облаке и ожидает применения к кампании.');expect(screen.queryByText(/Подтверждено применение до события/)).toBeNull();
 fail=true;fireEvent.click(screen.getByRole('button',{name:'Проверить применение пакета'}));await screen.findByText('Не удалось получить подтверждение применения. Проверьте подключение и повторите запрос.');expect(document.body.textContent).not.toContain('PRIVATE_REMOTE_DETAIL');
});

it("keeps saved proof history visible with an expired key and pages without reconnecting",async()=>{
 const entry={streamId:id,originId:id,target:'https://old-cloud.example.invalid',appliedThrough:'9007199254740993'},next='22222222-2222-4222-8222-222222222222';
 mocked.api.mockImplementation(async(path:string)=>path.endsWith('/history')?{entries:[{...entry,streamId:next,appliedThrough:'9007199254740995'}],next:null}:{...disconnected,state:'RECONNECT_REQUIRED',history:{entries:[entry],next}});
 renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);await screen.findByText('Подключение требует нового ключа.');await screen.findByText('Сохранено подтверждение применения до события 9007199254740993.');expect(screen.getByRole('button',{name:'Проверить применение пакета'}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Следующие подтверждения'}));await screen.findByText('Сохранено подтверждение применения до события 9007199254740995.');expect(screen.queryByText('Сохранено подтверждение применения до события 9007199254740993.')).toBeNull();const call=mocked.api.mock.calls.find(([path])=>path.endsWith('/history'))!;expect(JSON.parse(call[1].body)).toEqual({scope:authority,after:next});expect(localStorage.length+sessionStorage.length).toBe(0);
});

it("allows confirmation checks but disables sending with a read-only grant",async()=>{
 mocked.api.mockResolvedValue({...disconnected,state:'READY',canSend:false});renderComponent(<LocalCloudConnectionPanel authority={authority} membershipId={id}/>);await screen.findByText('Ключ предназначен для чтения подтверждений закрытой сессии.');expect(screen.getByRole('button',{name:'Отправить пакет текущей сессии'}).hasAttribute('disabled')).toBe(true);expect(screen.getByRole('button',{name:'Проверить применение пакета'}).hasAttribute('disabled')).toBe(false);
});
