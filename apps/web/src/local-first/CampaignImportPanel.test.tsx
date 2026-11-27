// @vitest-environment jsdom
import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,renderComponent,screen,waitFor} from '../test-support/render';
import {CampaignImportPanel} from './CampaignImportPanel';
const mocked=vi.hoisted(()=>({api:vi.fn()}));vi.mock('../api',()=>({api:mocked.api}));
const id='11111111-1111-4111-8111-111111111111',result={state:'IMPORTED',id,campaignId:id,ownerMembershipId:id};
beforeEach(()=>{mocked.api.mockReset();localStorage.clear();sessionStorage.clear();});
async function open(refresh=vi.fn().mockResolvedValue(undefined),onOpen=vi.fn()){
 renderComponent(<CampaignImportPanel csrfToken="synthetic-csrf" onRefresh={refresh} onOpen={onOpen}/>);const details=screen.getByText('Перенести кампанию из файла').closest('details')!;details.open=true;fireEvent(details,new Event('toggle'));await screen.findByLabelText('Файл кампании');return {details,refresh,onOpen};
}
function fill(){fireEvent.change(screen.getByLabelText('Файл кампании'),{target:{files:[new File(['synthetic encrypted bytes'],'synthetic.arken')]}});fireEvent.change(screen.getByLabelText('Пароль местной учётной записи'),{target:{value:'synthetic-account-password'}});fireEvent.change(screen.getByLabelText('Пароль переносимого файла'),{target:{value:'synthetic-file-password'}});}
it('streams a File through FormData, clears secrets and opens the confirmed campaign',async()=>{
 mocked.api.mockResolvedValue(result);const {refresh,onOpen}=await open();fill();fireEvent.click(screen.getByRole('button',{name:'Импортировать кампанию'}));await screen.findByRole('button',{name:'Открыть перенесённую кампанию'});
 const [path,options]=mocked.api.mock.calls[0]!;expect(path).toBe('/api/account/campaign-transfers/import');expect(options.headers['x-csrf-token']).toBe('synthetic-csrf');expect(options.body).toBeInstanceOf(FormData);expect(options.body.get('accountPassword')).toBe('synthetic-account-password');expect(options.body.get('archivePassword')).toBe('synthetic-file-password');expect(options.body.get('archive')).toBeInstanceOf(File);
 expect((screen.getByLabelText('Пароль местной учётной записи') as HTMLInputElement).value).toBe('');expect((screen.getByLabelText('Пароль переносимого файла') as HTMLInputElement).value).toBe('');expect(localStorage.length+sessionStorage.length).toBe(0);expect(refresh).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Открыть перенесённую кампанию'}));expect(onOpen).toHaveBeenCalledWith(id);
});
it('requires refresh before retrying an unconfirmed result and hides internal details',async()=>{
 mocked.api.mockRejectedValue(Error('PRIVATE_SERVER_DETAIL'));const {refresh}=await open();fill();fireEvent.click(screen.getByRole('button',{name:'Импортировать кампанию'}));await screen.findByText(/Результат переноса не подтверждён/);expect(document.body.textContent).not.toContain('PRIVATE_SERVER_DETAIL');expect((screen.getByLabelText('Файл кампании') as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Обновить список кампаний'}));await screen.findByText(/Список обновлён/);expect(refresh).toHaveBeenCalledTimes(1);expect((screen.getByLabelText('Файл кампании') as HTMLInputElement).disabled).toBe(false);
});
it('ignores late import results after closing the form',async()=>{
 let resolve!:(value:unknown)=>void;mocked.api.mockImplementation(()=>new Promise(done=>{resolve=done;}));const {details,refresh}=await open();fill();fireEvent.click(screen.getByRole('button',{name:'Импортировать кампанию'}));await waitFor(()=>expect(mocked.api).toHaveBeenCalledTimes(1));details.open=false;fireEvent(details,new Event('toggle'));await waitFor(()=>expect(screen.queryByLabelText('Файл кампании')).toBeNull());resolve(result);await Promise.resolve();expect(refresh).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Открыть перенесённую кампанию'})).toBeNull();
});
it('explicitly requests media-only repair and offers the confirmed campaign',async()=>{
 mocked.api.mockResolvedValue({state:'MEDIA_REPAIRED',id,campaignId:id,campaignAvailable:true,filesChecked:2,filesRestored:1});const {onOpen}=await open();
 fireEvent.click(screen.getByRole('button',{name:'Восстановление файлов'}));expect(screen.getByRole('button',{name:'Восстановление файлов'}).getAttribute('aria-pressed')).toBe('true');fill();
 fireEvent.click(screen.getByRole('button',{name:'Восстановить файлы кампании'}));await screen.findByText(/Файлы проверены: 2. Восстановлены: 1/);expect(mocked.api.mock.calls[0]![1].body.get('operation')).toBe('REPAIR');
 fireEvent.click(screen.getByRole('button',{name:'Открыть восстановленную кампанию'}));expect(onOpen).toHaveBeenCalledWith(id);
});
it('keeps independent media repair separate from reopening a deleted campaign',async()=>{
 mocked.api.mockResolvedValue({state:'MEDIA_REPAIRED',id,campaignId:id,campaignAvailable:false,filesChecked:1,filesRestored:1});await open();fireEvent.click(screen.getByRole('button',{name:'Восстановление файлов'}));fill();fireEvent.click(screen.getByRole('button',{name:'Восстановить файлы кампании'}));await screen.findByText(/Файлы проверены/);expect(screen.queryByRole('button',{name:'Открыть восстановленную кампанию'})).toBeNull();
});

it('explains a confirmed busy repair and permits selecting the same archive again',async()=>{
 mocked.api.mockRejectedValue({code:'TRANSFER_REPAIR_FILE_BUSY'});await open();
 fireEvent.click(screen.getByRole('button',{name:'Восстановление файлов'}));fill();fireEvent.click(screen.getByRole('button',{name:'Восстановить файлы кампании'}));
 await screen.findByText(/Файл занят открытой кампанией/);
 expect((screen.getByLabelText('Файл кампании') as HTMLInputElement).disabled).toBe(false);
 expect(screen.queryByRole('button',{name:'Обновить список кампаний'})).toBeNull();
 expect((screen.getByLabelText('Пароль местной учётной записи') as HTMLInputElement).value).toBe('');
});
