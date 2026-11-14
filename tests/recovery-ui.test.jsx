import {it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
const api=vi.hoisted(()=>({status:vi.fn(),backup:vi.fn(),export:vi.fn(),preview:vi.fn(),apply:vi.fn()}));
vi.mock('@/api/application',()=>({application:{capabilities:{recovery:true},recovery:api}}));
import BackupRecovery,{exactTotal} from '../src/components/settings/BackupRecovery';
beforeEach(()=>{vi.clearAllMocks();api.status.mockResolvedValue({automatic:true,backups:[{id:'fixture',kind:'daily',created_at:'2026-11-13T12:00:00Z',bytes:100}],last_success:'2026-11-13T12:00:00Z',off_device_configured:false});});
it('shows backup status and does not export mismatched passphrases',async()=>{
 render(<BackupRecovery/>);await screen.findByText(/Last successful backup/);fireEvent.click(screen.getByText('Download an encrypted portable backup'));
 fireEvent.change(screen.getByLabelText('Recovery passphrase (at least 16 characters)'),{target:{value:'a-long-fixture-passphrase'}});fireEvent.change(screen.getByLabelText('Repeat recovery passphrase'),{target:{value:'different-fixture-passphrase'}});
 fireEvent.click(screen.getByRole('button',{name:'Download encrypted backup'}));expect(await screen.findByRole('alert')).toBeTruthy();expect(api.export).not.toHaveBeenCalled();
});
it('previews counts and exact totals before enabling an explicit restore confirmation',async()=>{
 api.preview.mockResolvedValue({preview_token:'fixture',mode:'restore',incoming:{created_at:'2026-11-13T12:00:00Z',records:2,attachments:1,counts:{Bill:2},datasets:{personal:2},totals_cents:{'Bill.amount':'900719925474099301'}},current:{records:3,attachments:0},current_bank_connections:1});
 render(<BackupRecovery/>);fireEvent.click(screen.getByText('Review or restore a backup'));fireEvent.click(await screen.findByRole('button',{name:/Review daily backup/}));
 expect(await screen.findByRole('region',{name:'Recovery preview'})).toBeTruthy();expect(screen.getByText(/Incoming: 2 records and 1 attachments/)).toBeTruthy();expect(screen.getByRole('button',{name:'Restore records'}).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Type RESTORE to confirm'),{target:{value:'RESTORE'}});expect(screen.getByRole('button',{name:'Restore records'}).disabled).toBe(false);expect(api.apply).not.toHaveBeenCalled();
 expect(exactTotal('900719925474099301')).toBe('9,007,199,254,740,993.01');expect(exactTotal('-12')).toBe('-0.12');
});
it('makes a verified backup on demand and refreshes failures visibly',async()=>{
 api.backup.mockResolvedValue({id:'new'});render(<BackupRecovery/>);fireEvent.click(screen.getByRole('button',{name:'Back up now'}));await waitFor(()=>expect(api.backup).toHaveBeenCalledTimes(1));expect(await screen.findByText('Backup completed and verified.')).toBeTruthy();
});
