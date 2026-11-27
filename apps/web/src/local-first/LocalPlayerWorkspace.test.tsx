// @vitest-environment jsdom
vi.mock("./player-copy-runtime",()=>({installPlayerCopyRuntime:mocks.copy}));
import {beforeEach,expect,it,vi} from "vitest";
import {fireEvent,renderComponent,screen,waitFor,act} from "../test-support/render";
import {LocalPlayerWorkspace} from "./LocalPlayerWorkspace";
import {playerSnapshot} from "../test-support/game-snapshot-fixtures";
const mocks=vi.hoisted(()=>({open:vi.fn(),install:vi.fn(),bind:vi.fn(),save:vi.fn(),forget:vi.fn(),close:vi.fn(),dispose:vi.fn(),peerClose:vi.fn(),list:vi.fn(),copy:vi.fn(),peerOptions:vi.fn()}));
vi.mock("../App",()=>({App:()=> <div>Игровой стол</div>}));
vi.mock("./player-snapshot-cache",()=>({openPlayerSnapshotCache:mocks.open,listPlayerCopySummaries:mocks.list}));
vi.mock("./player-runtime",()=>({installLocalPlayerRuntime:mocks.install}));
vi.mock("./session-channel",async()=>{const original=await vi.importActual<typeof import("./session-channel")>("./session-channel");return {...original,bindLocalPlayerChannel:mocks.bind};});
vi.mock("./manual-peer",async()=>{const original=await vi.importActual<typeof import("./manual-peer")>("./manual-peer");return {...original,createManualPeer:(options:any)=>(mocks.peerOptions(options),{close:mocks.peerClose,answer:async()=>{queueMicrotask(()=>options.onChannel({}));return {type:"answer",sdp:"answer"};}})};});
const id=(tail:string)=>`10000000-0000-4000-8000-${tail.padStart(12,"0")}`;
const authority={campaignId:id("1"),hostId:id("2"),sessionId:id("3"),epoch:1},deviceId=id("4");
const offer=JSON.stringify({version:1,pairing:{version:1,authority,deviceId,token:"s".repeat(43)},description:{type:"offer",sdp:"synthetic"}});
let snapshot:ReturnType<typeof playerSnapshot>;
beforeEach(()=>{
  vi.clearAllMocks();snapshot=playerSnapshot();snapshot.campaign.id=authority.campaignId;snapshot.me.id=id("5");
  mocks.save.mockResolvedValue(undefined);mocks.forget.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue({save:mocks.save,forget:mocks.forget,close:mocks.close});
  mocks.bind.mockResolvedValue({authority,membershipId:snapshot.me.id,request:async()=>({authority,snapshot}),close:vi.fn()});
  mocks.install.mockReturnValue({dispose:mocks.dispose});mocks.copy.mockReturnValue({dispose:mocks.dispose});mocks.list.mockResolvedValue([]);
});
async function connect(optIn:boolean){
  renderComponent(<LocalPlayerWorkspace/>);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  if(optIn)fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByRole("textbox",{name:"Сетевой код мастера"}),{target:{value:offer}});
  fireEvent.click(screen.getByRole("button",{name:"Подготовить ответ мастеру"}));
  await screen.findByText("Игровой стол");
}
it("keeps persistence opt-in and opens it only after authenticated scope confirmation",async()=>{
  await connect(false);expect(mocks.open).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
it("saves initial and subsequent authorized projections and deletes the copy without disconnect",async()=>{
  await connect(true);expect(mocks.open).toHaveBeenCalledWith({authority,membershipId:snapshot.me.id,deviceId});expect(mocks.save).toHaveBeenCalledWith(snapshot);
  const onSnapshot=mocks.install.mock.calls[0]![2].onSnapshot;
  await act(async()=>{await onSnapshot({...snapshot,snapshotVersion:2});});expect(mocks.save).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button",{name:"Удалить локальную копию"}));await screen.findByText("Локальная копия удалена.");
  await act(async()=>{await onSnapshot(snapshot);});expect(mocks.save).toHaveBeenCalledTimes(2);expect(mocks.forget).toHaveBeenCalledOnce();expect(mocks.dispose).not.toHaveBeenCalled();
});
it("continues the game when persistent storage is unavailable",async()=>{
  mocks.open.mockRejectedValueOnce(Error("PRIVATE QUOTA"));await connect(true);
  expect(screen.getByText("Локальное сохранение недоступно.")).toBeInTheDocument();expect(screen.queryByText(/PRIVATE QUOTA/)).not.toBeInTheDocument();expect(mocks.install).toHaveBeenCalledOnce();
});
it("retains the retry-delete control but disables saving after failed deletion",async()=>{
  await connect(true);mocks.forget.mockRejectedValueOnce(Error("PRIVATE DISK"));
  fireEvent.click(screen.getByRole("button",{name:"Удалить локальную копию"}));await screen.findByText("Не удалось удалить локальную копию. Повторите удаление.");
  await act(async()=>{await mocks.install.mock.calls[0]![2].onSnapshot(snapshot);});expect(mocks.save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"Удалить локальную копию"}));await waitFor(()=>expect(mocks.forget).toHaveBeenCalledTimes(2));
});

it("opens a local copy only after an explicit inventory action",async()=>{
 const scope={authority,membershipId:snapshot.me.id,deviceId};mocks.list.mockResolvedValue([{scope,name:"Сохранённая кампания",player:"Игрок",savedAt:1,legacy:false}]);mocks.open.mockResolvedValue({loadBundle:async()=>({snapshot,media:new Map()}),close:mocks.close,forget:mocks.forget});
 renderComponent(<LocalPlayerWorkspace/>);expect(mocks.list).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Открыть сохранённую копию"}));await screen.findByRole("button",{name:/Сохранённая кампания · Игрок/});
 fireEvent.click(screen.getByRole("button",{name:/Сохранённая кампания · Игрок/}));await screen.findByText("Локальная копия — только просмотр");
 expect(mocks.open).toHaveBeenCalledWith(scope,true);expect(mocks.copy).toHaveBeenCalledOnce();expect(mocks.bind).not.toHaveBeenCalled();
});

it("clears the opted-in copy on logout and prevents later capture",async()=>{
 await connect(true);const options=mocks.install.mock.calls[0]![2];await act(async()=>{await options.onLogout();});
 expect(mocks.forget).toHaveBeenCalledOnce();expect(mocks.close).toHaveBeenCalled();await act(async()=>{await options.onSnapshot(snapshot,new Map());});expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("removes the previous copy when updating it fails",async()=>{
 await connect(true);mocks.save.mockRejectedValueOnce(Error("PRIVATE QUOTA"));await act(async()=>{await mocks.install.mock.calls[0]![2].onSnapshot(snapshot,new Map());});
 expect(mocks.forget).toHaveBeenCalledOnce();expect(screen.getByText("Сохранение остановлено. Прежняя копия удалена после ошибки обновления.")).toBeInTheDocument();
});
it("reports failed cleanup and leaves a retry control after a save failure",async()=>{
 await connect(true);mocks.save.mockRejectedValueOnce(Error("PRIVATE QUOTA"));mocks.forget.mockRejectedValueOnce(Error("PRIVATE STORAGE"));
 await act(async()=>{await mocks.install.mock.calls[0]![2].onSnapshot(snapshot,new Map());});
 expect(screen.getByText("Сохранение остановлено. Прежнюю копию удалить не удалось; повторите удаление.")).toBeInTheDocument();expect(screen.getByRole("button",{name:"Удалить локальную копию"})).toBeInTheDocument();
});

it('closes the live table and stops persistence when the host channel closes',async()=>{
 await connect(true);const onSnapshot=mocks.install.mock.calls[0]![2].onSnapshot;
 await act(async()=>{mocks.peerOptions.mock.calls[0]![0].onClosed();});
 expect(screen.queryByText('Игровой стол')).toBeNull();
 expect(screen.queryByText('Прямой канал мастера')).toBeNull();
 expect(screen.getByText(/Для возвращения за стол получите новый код/)).toBeInTheDocument();
 expect(mocks.dispose).toHaveBeenCalled();expect(mocks.close).toHaveBeenCalled();
 await act(async()=>{await onSnapshot(snapshot,new Map());});expect(mocks.save).toHaveBeenCalledTimes(1);
 expect(mocks.forget).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Открыть сохранённую копию'})).toBeInTheDocument();
});
