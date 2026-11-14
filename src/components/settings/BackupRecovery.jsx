import { useEffect,useRef,useState } from 'react';
import { resetWorkspaceSelection } from '@/lib/mode';
import { application } from '@/api/application';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SettingSection from './SettingSection';
const time=value=>value?new Date(value).toLocaleString():'Not yet';
export const exactTotal=cents=>{const value=BigInt(cents),absolute=value<0n?-value:value;return `${value<0n?'-':''}${(absolute/100n).toLocaleString('en-US')}.${String(absolute%100n).padStart(2,'0')}`;};
const saveFile=(name,base64)=>{
 const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const messages={RECOVERY_KEY_MISSING:'The original installation recovery key is missing or unreadable. Restore it from your separate secure copy. Portable passphrase exports remain available.',RECOVERY_KEY_INVALID:'The recovery key changed or is invalid. Restore the original key. Portable passphrase exports remain available.',BACKUP_CONFIGURATION_FAILED:'Automatic backups need a writable private folder and a separate recovery key. Check the installation settings; your finances remain available.',BACKUP_STORAGE_LIMIT:'Backup storage is full. Free disk space or ask your installation administrator to increase the configured limit.',BACKUP_FAILED:'The last backup failed. Check disk space and permissions, then run a backup again.',RETENTION_FAILED:'Recovery completed, but older backups could not be removed. Check storage permissions before the next backup.',OFF_DEVICE_COPY_FAILED:'The local backup succeeded, but its off-device copy failed. Check that the selected drive is connected.'};
export default function BackupRecovery(){
 const [status,setStatus]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
 const [phrase,setPhrase]=useState(''),[repeat,setRepeat]=useState('');
 const [upload,setUpload]=useState(null),[unlock,setUnlock]=useState(''),[mode,setMode]=useState('restore'),[preview,setPreview]=useState(null),[confirmation,setConfirmation]=useState('');
 const fileRef=useRef(null),active=useRef(true);
 useEffect(()=>{active.current=true;if(application.capabilities?.recovery)application.recovery.status().then(data=>{if(active.current)setStatus(data);}).catch(()=>{if(active.current)setError('Backup status could not be loaded. Please retry.');});return()=>{active.current=false;};},[]);
 if(!application.capabilities?.recovery)return null;
 const run=async(name,action)=>{
  if(busy)return;setBusy(name);setError('');setNotice('');
  try{await action();}catch(e){if(active.current)setError(e.message||'This recovery operation failed. Your current data has been kept.');}
  finally{if(active.current)setBusy('');}
 };
 const refresh=async()=>{const data=await application.recovery.status();if(active.current)setStatus(data);};
 const resetPreview=()=>{setPreview(null);setConfirmation('');};
 const payload=()=>preview?.clear_bank_history?{clear_bank_history:true}:upload?{archive_base64:upload.bytes,passphrase:unlock,mode}:{backup_id:preview?.backup_id};
 const reviewSaved=id=>run('preview',async()=>{const data=await application.recovery.preview({backup_id:id,mode:'restore'});if(active.current){setUpload(null);setUnlock('');setMode('restore');setPreview({...data,backup_id:id});setConfirmation('');}});
 const readFile=event=>{
  resetPreview();setError('');setUpload(null);const file=event.target.files?.[0];if(!file)return;
  if(file.size>32*1024*1024){setError('Choose a file no larger than 32 MiB.');return;}
  const reader=new FileReader();reader.onload=()=>{if(active.current)setUpload({name:file.name,bytes:String(reader.result).split(',')[1]});};reader.onerror=()=>setError('This file could not be read.');reader.readAsDataURL(file);
 };
 const exportBackup=()=>run('export',async()=>{
  if(phrase.normalize('NFC')!==repeat.normalize('NFC'))throw Error('The recovery passphrases do not match.');
  if([...phrase.normalize('NFC')].length<16)throw Error('Use a recovery passphrase of at least 16 characters.');
  const result=await application.recovery.export(phrase);if(active.current){saveFile(result.file_name,result.archive_base64);setPhrase('');setRepeat('');setNotice('Encrypted backup downloaded. Keep its recovery passphrase separately from the file.');}
 });
 const review=()=>run('preview',async()=>{if(!upload)throw Error('Choose a backup or prepared migration file.');const data=await application.recovery.preview(payload());if(active.current){setPreview(data);setConfirmation('');}});
 const apply=()=>run('apply',async()=>{
  const result=await application.recovery.apply({...payload(),preview_token:preview.preview_token,confirmation});
  if(!result.restored)throw Error('Restoration was not confirmed.');
  setUnlock('');setUpload(null);resetPreview();
  // Server revokes all sessions after a restore. A full reload discards every dataset/form cache.
  resetWorkspaceSelection();window.location.assign('/login?returnTo=%2F');
 });
 return <SettingSection title="Backups & recovery" description="Protect all of your account’s personal and saved sample records.">
  <div className="space-y-6">
   <div className="rounded-xl border border-border bg-surface-subtle p-4">
    <h3 className="font-semibold text-foreground">Automatic backups</h3>
    <p className="mt-2 text-sm text-muted-foreground">Daily while Avera is running. Seven daily and four weekly copies are kept, plus three manual and three recovery safety copies. Backups are encrypted with this installation’s recovery key. Account passwords and bank authorizations are not included.</p>
    {status?.storage==='postgres'&&<p className="mt-2 text-sm text-muted-foreground">These account archives complement your host’s database backups. Your administrator must also protect the credential vault and configure hosted disaster recovery.</p>}
    <dl className="mt-3 space-y-1 text-sm"><div><dt className="inline font-medium">Last successful backup: </dt><dd className="inline">{time(status?.last_success)}</dd></div><div><dt className="inline font-medium">Off-device copying: </dt><dd className="inline">{status?.off_device_configured?'Configured by your administrator':'Not configured — download a portable backup to a separate drive'}</dd></div></dl>
    {status?.last_error&&<p role="alert" className="mt-3 text-danger-text">{messages[status.last_error]||'The last backup or recovery operation failed. Your stored data remains available; review it and retry.'}</p>}
    {status?.copy_error&&<p role="alert" className="mt-3 text-danger-text">{messages.OFF_DEVICE_COPY_FAILED}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={Boolean(busy)} onClick={()=>run('backup',async()=>{await application.recovery.backup();await refresh();setNotice('Backup completed and verified.');})}>Back up now</Button><Button variant="ghost" className="min-h-11" disabled={Boolean(busy)} onClick={()=>run('status',refresh)}>Refresh backup status</Button></div>
   </div>
   <details><summary className="min-h-11 cursor-pointer py-3 font-semibold text-foreground">Download an encrypted portable backup</summary>
    <p className="mb-3 text-sm text-muted-foreground">Includes records and retained attachments. Passwords, provider secrets and bank authorizations are excluded. Choose a unique passphrase; Avera cannot recover it. Store the file off this computer and keep the passphrase separately.</p>
    <div className="space-y-3"><div><Label htmlFor="backup-passphrase">Recovery passphrase (at least 16 characters)</Label><Input id="backup-passphrase" type="password" autoComplete="new-password" value={phrase} onChange={e=>setPhrase(e.target.value)} disabled={Boolean(busy)}/></div><div><Label htmlFor="backup-repeat">Repeat recovery passphrase</Label><Input id="backup-repeat" type="password" autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)} disabled={Boolean(busy)}/></div><Button className="min-h-11" disabled={Boolean(busy)} onClick={exportBackup}>Download encrypted backup</Button></div>
   </details>
   {status?.restored_bank_history>0&&<div className="rounded-xl border border-border p-4"><h3 className="font-semibold text-foreground">Review restored bank history</h3><p className="mt-2 text-sm text-muted-foreground">{status.restored_bank_history} restored bank records are kept offline. Reconnecting is blocked to prevent overlapping imports. To replace them with fresh bank data, review a plan that removes only those historical bank records. Manual records stay in place, and a verified safety copy is saved first.</p><Button variant="outline" className="mt-3 min-h-11" disabled={Boolean(busy)} onClick={()=>run('preview',async()=>{const data=await application.recovery.preview({clear_bank_history:true,mode:'restore'});setUpload(null);setUnlock('');setMode('restore');setPreview(data);setConfirmation('');})}>Review bank history cleanup</Button><p className="mt-2 text-sm text-muted-foreground">Open the recovery section below to review the plan. Nothing changes until you confirm.</p></div>}
   <details><summary className="min-h-11 cursor-pointer py-3 font-semibold text-foreground">Review or restore a backup</summary>
    <p className="mb-3 text-sm text-muted-foreground">Restore replaces this account’s personal and sample financial records. A verified safety copy is saved first. Local test-bank links will be deactivated. Remote authorization removal can be completed in Bank connections when online. Your password and other accounts are kept; bank authorization is not restored.</p>
    <ul className="mb-4 space-y-2">{status?.backups?.map(item=><li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"><span className="text-sm">{item.kind==='safety'?'Before recovery':item.kind==='weekly'?'Weekly':item.kind==='manual'?'Manual':'Daily'} · {time(item.created_at)}</span><Button variant="outline" className="min-h-11" disabled={Boolean(busy)} onClick={()=>reviewSaved(item.id)} aria-label={`Review ${item.kind} backup from ${time(item.created_at)}`}>Review</Button></li>)}</ul>
    <div className="space-y-3"><div><Label htmlFor="recovery-kind">File type</Label><select id="recovery-kind" className="block min-h-11 w-full rounded-xl border border-border bg-surface p-2 text-foreground" value={mode} disabled={Boolean(busy)} onChange={e=>{setMode(e.target.value);setUnlock('');resetPreview();}}><option value="restore">Encrypted Avera backup</option><option value="import">Prepared migration JSON (empty account only)</option></select></div>
     <div><Label htmlFor="recovery-file">Choose a backup or migration file (maximum 32 MiB)</Label><Input ref={fileRef} id="recovery-file" type="file" accept={mode==='import'?'.json':'.avera'} onChange={readFile} disabled={Boolean(busy)}/></div>
     {mode==='restore'&&<div><Label htmlFor="recovery-unlock">Backup recovery passphrase</Label><Input id="recovery-unlock" type="password" autoComplete="off" value={unlock} onChange={e=>{setUnlock(e.target.value);resetPreview();}} disabled={Boolean(busy)}/></div>}
     {mode==='import'&&<p className="text-sm text-muted-foreground">Use the migration preparation tool with your authorized export first. Imports require an empty account, validate every relationship and reconcile counts and money totals before committing. Passwords and bank tokens are not migrated.</p>}
     <Button variant="outline" className="min-h-11" disabled={Boolean(busy)||!upload} onClick={review}>Preview selected file</Button>
    </div>
    {preview&&<section aria-label="Recovery preview" className="mt-5 space-y-3 rounded-xl border border-border bg-surface-subtle p-4">
     <h3 className="font-semibold text-foreground">{preview.clear_bank_history?'Review removal of restored bank history':preview.mode==='import'?'Review before importing':'Review before restoring'}</h3>
     <p className="text-sm">Backup date: {time(preview.incoming.created_at)}. Incoming: {preview.incoming.records} records and {preview.incoming.attachments} attachments. Current: {preview.current.records} records and {preview.current.attachments} attachments.</p>
     {preview.current_bank_connections>0&&<p className="text-sm text-danger-text">{preview.current_bank_connections} local bank links will be deactivated. Complete remote removal in Bank connections when online. They are not restored from this file.</p>}
     <p className="text-sm">Datasets: {Object.entries(preview.incoming.datasets).map(([name,count])=>`${name}: ${count}`).join(', ')||'empty'}.</p>
     <dl className="text-sm">{Object.entries(preview.incoming.counts).map(([name,count])=><div key={name} className="flex justify-between gap-4"><dt>{name}</dt><dd>{String(count)}</dd></div>)}</dl>
     <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Reconciled money totals</summary><dl className="space-y-1 text-sm">{Object.entries(preview.incoming.totals_cents).map(([name,cents])=><div key={name} className="flex flex-wrap justify-between gap-2"><dt className="break-all">{name}</dt><dd>{exactTotal(cents)}</dd></div>)}</dl><p className="mt-2 text-xs text-muted-foreground">Validation totals compare saved numeric values, not a financial forecast. Currency amounts retain their saved units.</p></details>
     <p className="text-sm text-muted-foreground">This preview expires in ten minutes. Any intervening changes require a fresh preview. All sessions will end after a successful recovery; sign in again with this account’s current password.</p>
     <Label htmlFor="recovery-confirm">Type {preview.mode==='import'?'IMPORT':'RESTORE'} to confirm</Label><Input id="recovery-confirm" autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={Boolean(busy)}/>
     <Button variant="destructive" className="min-h-11" disabled={Boolean(busy)||confirmation!==(preview.mode==='import'?'IMPORT':'RESTORE')} onClick={apply}>{preview.mode==='import'?'Import records':'Restore records'}</Button>
    </section>}
   </details>
   {busy&&<p role="status" className="text-muted-foreground">{busy==='apply'?'Verifying the safety backup and applying recovery…':'Working on your backup…'}</p>}
   {error&&<p role="alert" className="text-danger-text">{error}</p>}{notice&&<p role="status" className="text-success-text">{notice}</p>}
  </div>
 </SettingSection>;
}
