// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from "vitest";
import {fireEvent,renderComponent,screen,waitFor} from "../test-support/render";
import {LocalCloudSessionSelector} from "./LocalCloudSessionSelector";
const mocked=vi.hoisted(()=>({api:vi.fn()}));vi.mock("../api",()=>({api:mocked.api}));
const id="11111111-1111-4111-8111-111111111111",old={campaignId:id,hostId:id,sessionId:id,epoch:1},current={...old,sessionId:"22222222-2222-4222-8222-222222222222",epoch:2};
beforeEach(()=>{mocked.api.mockReset();});
it("shows a stopped historical session and sends every command with its scope",async()=>{
 mocked.api.mockImplementation(async(path:string)=>path.endsWith("/scopes")?{scopes:[{authority:old,pendingEvents:3,limited:false}],next:null}:path.endsWith("/send")?{state:"STORED_ONLY",sentEvents:3,storedThrough:"7"}:{state:"READY",target:"https://cloud.example.invalid",expiresAt:new Date(Date.now()+3600000).toISOString()});
 renderComponent(<LocalCloudSessionSelector campaignId={id} membershipId={id}/>);await screen.findByText("Ключ сохранён средствами защиты Windows.");
 fireEvent.click(screen.getByRole("button",{name:"Отправить пакет выбранной сессии"}));await screen.findByText("Облако сохранило событий: 3. Игровые изменения ещё не применены.");
 expect(JSON.parse(mocked.api.mock.calls.find(([path])=>path.endsWith("/send"))?.[1].body)).toEqual({scope:old});
});
it("pages historical sessions and clears a pasted secret on scope change",async()=>{
 mocked.api.mockImplementation(async(path:string,options:any)=>path.endsWith("/scopes")?JSON.parse(options.body).after?{scopes:[{authority:old,pendingEvents:3,limited:false}],next:null}:{scopes:[],next:{epoch:2,sessionId:current.sessionId}}:{state:"DISCONNECTED",target:null,expiresAt:null});
 renderComponent(<LocalCloudSessionSelector campaignId={id} membershipId={id} current={current}/>);await screen.findByText("Ключ подключения не сохранён.");fireEvent.change(screen.getByLabelText("Ключ подключения облака"),{target:{value:"PRIVATE"}});
 fireEvent.click(screen.getByRole("button",{name:"Показать более ранние сессии"}));await waitFor(()=>expect(screen.queryByRole("button",{name:"Показать более ранние сессии"})).toBeNull());
 fireEvent.click(screen.getByRole("combobox",{name:"Сессия для отправки"}));fireEvent.click(await screen.findByRole("option",{name:/Сохранённая сессия/}));
 await waitFor(()=>expect((screen.getByLabelText("Ключ подключения облака") as HTMLInputElement).value).toBe(""));expect(JSON.parse((screen.getByLabelText("Данные локальной сессии для облака") as HTMLInputElement).value)).toEqual(old);
});
