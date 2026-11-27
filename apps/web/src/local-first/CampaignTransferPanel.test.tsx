// @vitest-environment jsdom
import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,renderComponent,screen,waitFor} from '../test-support/render';
import {CampaignTransferPanel} from './CampaignTransferPanel';
const mocked=vi.hoisted(()=>({api:vi.fn()}));vi.mock('../api',()=>({api:mocked.api}));
const id='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{mocked.api.mockReset();localStorage.clear();sessionStorage.clear();});
async function open(){renderComponent(<CampaignTransferPanel campaignId={id} csrfToken="synthetic-csrf"/>);const details=screen.getByText('Сохранить файл кампании').closest('details')!;details.open=true;fireEvent(details,new Event('toggle'));await screen.findByLabelText('Пароль файла');return details;}
function fill(){fireEvent.change(screen.getByLabelText('Пароль учётной записи'),{target:{value:'synthetic-account-password'}});for(const label of ['Пароль файла','Повтор пароля файла'])fireEvent.change(screen.getByLabelText(label),{target:{value:'synthetic-file-password'}});}
it('prepares a download without putting passwords in URLs or storage and clears fields',async()=>{
 mocked.api.mockResolvedValue({id,state:'READY',bytes:2048,expiresAt:new Date(Date.now()+600000).toISOString()});await open();fill();fireEvent.click(screen.getByRole('button',{name:'Подготовить файл кампании'}));
 const link=await screen.findByRole('link',{name:'Скачать файл кампании'});expect(link.getAttribute('href')).toBe(`/api/account/campaigns/${id}/transfer-exports/${id}/download`);
 const options=mocked.api.mock.calls[0]![1];expect(options.headers['x-csrf-token']).toBe('synthetic-csrf');expect(JSON.parse(options.body)).toEqual({accountPassword:'synthetic-account-password',archivePassword:'synthetic-file-password'});
 expect((screen.getByLabelText('Пароль файла') as HTMLInputElement).value).toBe('');expect((screen.getByLabelText('Пароль учётной записи') as HTMLInputElement).value).toBe('');expect(localStorage.length+sessionStorage.length).toBe(0);
});
it('rejects mismatched passwords locally and hides backend details',async()=>{
 await open();fill();fireEvent.change(screen.getByLabelText('Повтор пароля файла'),{target:{value:'different'}});fireEvent.click(screen.getByRole('button',{name:'Подготовить файл кампании'}));await screen.findByText(/Задайте пароль файла/);expect(mocked.api).not.toHaveBeenCalled();
 mocked.api.mockRejectedValue(Error('PRIVATE_BACKEND_DETAIL'));fill();fireEvent.click(screen.getByRole('button',{name:'Подготовить файл кампании'}));await screen.findByText(/Не удалось подготовить файл/);expect(document.body.textContent).not.toContain('PRIVATE_BACKEND_DETAIL');
});
it('discards late responses when closed',async()=>{
 let done!:(value:unknown)=>void;mocked.api.mockImplementation(()=>new Promise(resolve=>{done=resolve;}));const details=await open();fill();fireEvent.click(screen.getByRole('button',{name:'Подготовить файл кампании'}));await waitFor(()=>expect(mocked.api).toHaveBeenCalledTimes(1));details.open=false;fireEvent(details,new Event('toggle'));await waitFor(()=>expect(screen.queryByLabelText('Пароль файла')).toBeNull());done({id,state:'READY',bytes:100,expiresAt:new Date(Date.now()+600000).toISOString()});await Promise.resolve();expect(screen.queryByRole('link')).toBeNull();
});
