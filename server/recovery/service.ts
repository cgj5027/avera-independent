import { DatabaseSync } from 'node:sqlite';
import { legacyFiles } from './installation.ts';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,rename,unlink,mkdtemp,rm,open,lstat,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join,relative,isAbsolute,dirname } from 'node:path';
import type { Database,Transaction } from '../database.ts';
import { sqliteDatabase } from '../database.ts';
import { RecordStore } from '../store.ts';
import { ApiError,invalid } from '../errors.ts';
import { encryptArchive,decryptArchive,sha,fromBase64,MAX_ARCHIVE_BYTES } from './archive.ts';
import { snapshot,consistentSnapshot,validateSnapshot,summary,stateFingerprint,bankState,applySnapshot,RECOVERY_SCHEMA } from './records.ts';
import type { Snapshot } from './records.ts';
export type RecoveryOptions={directory:string;keyPath:string;copyDirectory?:string;maxBytes?:number;now?:()=>number;schedule?:boolean;filesPath?:string};
const day=86400000;
const inside=(root:string,target:string)=>{const r=relative(root,target);return !r||(!r.startsWith('..')&&!isAbsolute(r));};
export function recoveryOptions(env:Record<string,string|undefined>,databasePath?:string):RecoveryOptions{
 const base=databasePath?dirname(resolve(databasePath)):resolve('data');
 const maximum=Number(env.AVERA_BACKUP_MAX_BYTES??512*1024*1024);
 if(!Number.isSafeInteger(maximum)||maximum<MAX_ARCHIVE_BYTES||maximum>10*1024*1024*1024)throw Error('AVERA_BACKUP_MAX_BYTES must be between 32 MiB and 10 GiB.');
 const directory=env.AVERA_BACKUP_DIR??join(base,'backups'),keyPath=env.AVERA_BACKUP_KEY_PATH??join(base,'backup.key'),filesPath=env.AVERA_FILES_PATH??'data/files';
 if([resolve(directory),resolve(keyPath),...(databasePath?[resolve(databasePath)]:[])].some(path=>inside(resolve(filesPath),path)))throw Error('Private files must not contain the database, backup directories or backup key.');
 if([resolve('dist'),resolve('dist-local')].some(root=>inside(root,resolve(directory))))throw Error('Backups must be outside public web assets.');
 return {directory,keyPath,copyDirectory:env.AVERA_BACKUP_COPY_DIR||undefined,maxBytes:maximum,filesPath};
}
async function existingArchive(directory:string):Promise<string|null>{
 let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 for(const entry of entries){if(entry.isFile()&&entry.name.endsWith('.avera'))return join(directory,entry.name);if(entry.isDirectory()&&(/^[a-f0-9]{64}$/.test(entry.name)||entry.name==='installation')){const found=await existingArchive(join(directory,entry.name));if(found)return found;}}return null;
}
export async function recoveryKey(options:RecoveryOptions){
 const dir=resolve(options.directory),file=resolve(options.keyPath);
 if(inside(dir,file)||options.copyDirectory&&(inside(resolve(options.copyDirectory),file)||inside(dir,resolve(options.copyDirectory))||inside(resolve(options.copyDirectory),dir)))throw new ApiError(503,'BACKUP_CONFIGURATION_FAILED','Keep the backup key and copy directory outside archive directories.');
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 const prior=await existingArchive(dir);let key:Buffer;
 try{if(!(await lstat(file)).isFile()||(await lstat(file)).isSymbolicLink())throw Error();key=await readFile(file);}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT'||prior)throw new ApiError(503,'RECOVERY_KEY_MISSING','The installation recovery key is missing or unreadable. Restore the original key; portable passphrase exports remain available.');
  key=randomBytes(32);await writeFile(file,key,{flag:'wx',mode:0o600});
 }
 if(key.length!==32)throw new ApiError(503,'RECOVERY_KEY_INVALID','Restore the original installation recovery key.');
 const fingerprint=sha(key);let known='';try{known=(await readFile(file+'.id','utf8')).trim();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(known&&known!==fingerprint)throw new ApiError(503,'RECOVERY_KEY_INVALID','The installation recovery key changed. Restore the original key.');
 if(!known){if(prior){try{await decryptArchive(await readFile(prior),key.toString('base64'));}catch{throw new ApiError(503,'RECOVERY_KEY_INVALID','The recovery key does not unlock existing archives.');}}await writeFile(file+'.id',fingerprint,{flag:'wx',mode:0o600});}
 return key.toString('base64');
}

export async function atomicWrite(file:string,bytes:Buffer){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 const temporary=file+'.'+randomUUID()+'.partial';
 try{const out=await open(temporary,'wx',0o600);try{await out.writeFile(bytes);await out.sync();}finally{await out.close();}await rename(temporary,file);}catch(e){await unlink(temporary).catch(()=>{});throw e;}
}
/** A pre-upgrade snapshot of SQLite using the native online-backup API, never a live-file copy. */
export async function beforeUpgrade(db:Database,options:RecoveryOptions){
 if(db.dialect!=='sqlite'||!db.snapshot)return;
 const tables=await db.transaction(tx=>tx.query("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"));
 if(!tables.length)return;
 const version=await db.transaction(tx=>tx.query('SELECT MAX(version) AS version FROM schema_migrations'));
 if(Number(version[0]?.version??0)>=RECOVERY_SCHEMA)return;
 const key=await recoveryKey(options);await mkdir(options.directory,{recursive:true,mode:0o700});
 const working=await mkdtemp(join(resolve(options.directory),'.working-'));
 try{
  const target=join(working,'records.sqlite');await db.snapshot(target);
  const check=new DatabaseSync(target,{readOnly:true});try{const integrity=check.prepare('PRAGMA integrity_check').all();if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw new ApiError(503,'UPGRADE_BACKUP_FAILED','The pre-upgrade SQLite snapshot failed verification.');}finally{check.close();}
  const bytes=await readFile(target);if(bytes.length>20*1024*1024)throw new ApiError(413,'UPGRADE_BACKUP_TOO_LARGE','Take an operator SQLite backup before upgrading this installation; its database exceeds the automatic upgrade archive limit.');
  const archive=await encryptArchive({format:'avera-installation-sqlite',version:1,created_at:new Date().toISOString(),schema_version:Number(version[0].version),files:await legacyFiles(options.filesPath),database_base64:bytes.toString('base64')},key);
  const destination=join(resolve(options.directory),'installation','pre-upgrade-'+randomUUID()+'.avera');
  await atomicWrite(destination,archive);
  if(sha(await readFile(destination))!==sha(archive))throw new ApiError(503,'UPGRADE_BACKUP_FAILED','The pre-upgrade archive failed verification.');
 }finally{await rm(working,{recursive:true,force:true});}
}
export class RecoveryService {
 store:RecordStore; options:RecoveryOptions; private key:string; private keyProblem=''; private now:()=>number;
 private timer?:ReturnType<typeof setInterval>; private running?:Promise<void>;
 private previews=new Map<string,{owner:string;fileHash:string;state:string;expires:number;banks:string;mode:'restore'|'import'}>();
 private active=new Set<string>();
 private constructor(store:RecordStore,options:RecoveryOptions,key:string){this.store=store;this.options=options;this.key=key;this.now=options.now??Date.now;}
 static async create(store:RecordStore,options:RecoveryOptions){let key='',problem='';try{await mkdir(options.directory,{recursive:true,mode:0o700});key=await recoveryKey(options);}catch(error){problem=error instanceof ApiError?error.code:'BACKUP_CONFIGURATION_FAILED';}const service=new RecoveryService(store,options,key);service.keyProblem=problem;return service;}
 start(){this.timer=setInterval(()=>{void this.daily();},60000);this.timer.unref();void this.daily();}
 async close(){if(this.timer)clearInterval(this.timer);await this.running;}
 private folder(owner:string,copy=false){return join(resolve(copy?this.options.copyDirectory!:this.options.directory),sha(owner));}
 private file(owner:string,id:string,copy=false){if(!/^[a-f0-9-]{36}$/.test(id))invalid('Invalid backup identifier.');return join(this.folder(owner,copy),id+'.avera');}
 private async capture(owner:string){
  // SQLite snapshots are consistent with concurrent WAL activity. Only this owner is then exported.
  if(this.store.db.snapshot){const working=await mkdtemp(join(tmpdir(),'avera-private-snapshot-'));let clone:Database|undefined;
   try{const file=join(working,'snapshot.sqlite');await this.store.db.snapshot(file);clone=sqliteDatabase(file);return await consistentSnapshot(new RecordStore(clone),owner);}finally{await clone?.close();await rm(working,{recursive:true,force:true});}
  }
  return consistentSnapshot(this.store,owner);
 }
 private async state(owner:string,success:boolean,error='',copyError=''){
  const now=new Date(this.now()).toISOString();await this.store.db.transaction(tx=>tx.query(`INSERT INTO recovery_status(owner_id,last_success,last_attempt,last_error,copy_error) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(owner_id) DO UPDATE SET last_success=CASE WHEN $2 IS NULL THEN recovery_status.last_success ELSE $2 END,last_attempt=$3,last_error=$4,copy_error=$5`,[owner,success?now:null,now,error,copyError]));
 }
 private async prune(owner:string){
  const rows=await this.store.db.transaction(tx=>tx.query('SELECT * FROM recovery_backups WHERE owner_id=$1 ORDER BY created_at DESC,id DESC',[owner]));
  for(const kind of ['daily','weekly','safety','manual']){
   const keep=kind==='daily'?7:kind==='weekly'?4:3;
   for(const row of rows.filter(r=>r.kind===kind).slice(keep)){
    await unlink(this.file(owner,row.id)).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(this.options.copyDirectory)await unlink(this.file(owner,row.id,true)).catch(()=>{});
    await this.store.db.transaction(tx=>tx.query('DELETE FROM recovery_backups WHERE owner_id=$1 AND id=$2',[owner,row.id]));
   }
  }
 }
 private async checkKey(){
  if(this.keyProblem||!this.key)throw new ApiError(503,this.keyProblem||'RECOVERY_KEY_MISSING','Automatic recovery is unavailable. Restore the original backup key or fix backup folder permissions. Portable passphrase exports remain available.');
  try{if(sha(await readFile(this.options.keyPath))!==sha(Buffer.from(this.key,'base64')))throw Error();}catch{throw new ApiError(503,'RECOVERY_KEY_MISSING','The original recovery key file is missing or changed. Restore it before automatic backup or recovery.');}
 }
 private async save(tx:Transaction|undefined,owner:string,document:Snapshot,kind:string){
  await this.checkKey();
  const bytes=await encryptArchive(document,this.key),id=randomUUID(),file=this.file(owner,id),at=new Date(this.now()).toISOString();
  const query=(sql:string,params:any[])=>tx?tx.query(sql,params):this.store.db.transaction(t=>t.query(sql,params));
  const usage=await query('SELECT COALESCE(SUM(bytes),0) AS bytes FROM recovery_backups',[]);
  if(Number(usage[0].bytes)+bytes.length>(this.options.maxBytes??512*1024*1024))throw new ApiError(507,'BACKUP_STORAGE_LIMIT','Backup storage is full. Free space or increase the configured backup limit; no records were replaced.');
  await atomicWrite(file,bytes);
  try{const verified=validateSnapshot(await decryptArchive(await readFile(file),this.key));if(summary(verified).digest!==summary(document).digest)throw new ApiError(503,'BACKUP_VERIFICATION_FAILED','The backup could not be verified.');await query('INSERT INTO recovery_backups(id,owner_id,kind,created_at,bytes) VALUES($1,$2,$3,$4,$5)',[id,owner,kind,at,bytes.length]);}catch(e){await unlink(file).catch(()=>{});throw e;}
  let copyError='';
  if(this.options.copyDirectory){try{await atomicWrite(this.file(owner,id,true),bytes);if(sha(await readFile(this.file(owner,id,true)))!==sha(bytes))throw Error();}catch{copyError='OFF_DEVICE_COPY_FAILED';}}
  return {id,kind,created_at:at,bytes:bytes.length,copy_error:copyError};
 }
 async createBackup(owner:string,kind='manual'){
  if(this.active.has(owner))throw new ApiError(409,'BACKUP_BUSY','A backup is already running. Please retry shortly.');
  this.active.add(owner);
  try{await this.prune(owner);const doc=await this.capture(owner);const saved=await this.save(undefined,owner,doc,kind);await this.prune(owner);await this.state(owner,true,'',saved.copy_error);return saved;}
  catch(error){await this.state(owner,false,error instanceof ApiError?error.code:'BACKUP_FAILED').catch(()=>{});throw error;}
  finally{this.active.delete(owner);}
 }
 async daily(){
  if(this.running)return this.running;
  this.running=(async()=>{
   const users=await this.store.db.transaction(tx=>tx.query("SELECT id FROM users WHERE id NOT LIKE 'sample:%'"));
   for(const user of users){
    const now=this.now(),today=new Date(now).toISOString().slice(0,10);
    const rows=await this.store.db.transaction(tx=>tx.query('SELECT kind,created_at FROM recovery_backups WHERE owner_id=$1',[user.id]));
    try{
     if(!rows.some(r=>r.kind==='daily'&&r.created_at.slice(0,10)===today))await this.createBackup(user.id,'daily');
     if(!rows.some(r=>r.kind==='weekly'&&Math.floor(Date.parse(r.created_at)/(7*day))===Math.floor(now/(7*day))))await this.createBackup(user.id,'weekly');
    }catch{/* Failure is recorded by createBackup; never log financial contents. */}
   }
  })().catch(()=>{}).finally(()=>{this.running=undefined;});return this.running;
 }
 async status(owner:string){
  const [rows,states]=await Promise.all([this.store.db.transaction(tx=>tx.query('SELECT id,kind,created_at,bytes FROM recovery_backups WHERE owner_id=$1 ORDER BY created_at DESC,id DESC',[owner])),this.store.db.transaction(tx=>tx.query('SELECT last_success,last_attempt,last_error,copy_error FROM recovery_status WHERE owner_id=$1',[owner]))]);
  const pending=await this.store.db.transaction(tx=>tx.query('SELECT COUNT(*) AS n FROM recovery_bank_rows h JOIN records r ON r.owner_id=h.owner_id AND r.collection=h.collection AND r.id=h.id WHERE h.owner_id=$1 AND r.deleted_at IS NULL',[owner]));
  return {storage:this.store.db.dialect,restored_bank_history:Number(pending[0].n),automatic:this.options.schedule!==false,retention:{daily:7,weekly:4,safety:3,manual:3},max_archive_bytes:MAX_ARCHIVE_BYTES,off_device_configured:!!this.options.copyDirectory,backups:rows,...states[0],last_error:this.keyProblem||states[0]?.last_error||''};
 }
 async export(owner:string,passphrase:unknown){const doc=await this.capture(owner);return {file_name:'avera-'+new Date(this.now()).toISOString().slice(0,10)+'.avera',archive_base64:(await encryptArchive(doc,passphrase)).toString('base64'),summary:summary(doc)};}
 private async input(owner:string,input:any):Promise<{doc:Snapshot;hash:string}>{
  if(input.clear_bank_history===true){
   const current=await this.capture(owner),rows=await this.store.db.transaction(tx=>tx.query('SELECT collection,id FROM recovery_bank_rows WHERE owner_id=$1',[owner]));
   const removed=new Set(rows.map(row=>row.collection+':'+row.id));
   const doc=validateSnapshot({...current,records:current.records.filter(row=>!removed.has(row.collection+':'+row.id)),attachments:current.attachments.filter(file=>!removed.has(file.record_collection+':'+file.record_id))});
   return {doc,hash:summary(doc).digest};
  }
  if(input.backup_id){await this.checkKey();const id=input.backup_id;if(typeof id!=='string')invalid();const rows=await this.store.db.transaction(tx=>tx.query('SELECT id FROM recovery_backups WHERE owner_id=$1 AND id=$2',[owner,id]));if(!rows.length)throw new ApiError(404,'BACKUP_NOT_FOUND','Backup not found.');
   let bytes;try{const file=this.file(owner,id);if(!(await lstat(file)).isFile())throw Error();bytes=await readFile(file);}catch{throw new ApiError(404,'BACKUP_NOT_FOUND','The backup file is missing.');}
   return {doc:validateSnapshot(await decryptArchive(bytes,this.key)),hash:sha(bytes)};
  }
  const bytes=fromBase64(input.archive_base64);
  if(input.mode==='import'){
   let doc;try{doc=JSON.parse(bytes.toString('utf8'));}catch{invalid('Choose a prepared migration JSON file.');}
   return {doc:validateSnapshot(doc),hash:sha(bytes)};
  }
  return {doc:validateSnapshot(await decryptArchive(bytes,input.passphrase)),hash:sha(bytes)};
 }
 async preview(owner:string,input:any){
  for(const [id,p]of this.previews)if(p.expires<this.now())this.previews.delete(id);
  if(this.previews.size>=30)throw new ApiError(429,'RECOVERY_BUSY','Too many recovery previews. Please retry later.');
  if(input.mode!==undefined&&!['restore','import'].includes(input.mode))invalid('Choose restore or import.');
  const mode=input.mode??'restore',{doc,hash}=await this.input(owner,input),current=await this.capture(owner);
  if(mode==='import'&&(current.records.length||current.attachments.length))throw new ApiError(409,'IMPORT_NOT_EMPTY','Use an empty account for migration to avoid duplicate financial totals.');
  const banks=await this.store.db.transaction(tx=>bankState(tx,owner));
  const token=randomBytes(32).toString('base64url');this.previews.set(token,{owner,fileHash:hash,state:stateFingerprint(current),expires:this.now()+10*60000,banks:banks.digest,mode});
  return {preview_token:token,expires_at:new Date(this.now()+10*60000).toISOString(),incoming:summary(doc),current:summary(current),current_bank_connections:banks.active,mode,clear_bank_history:input.clear_bank_history===true};
 }
 async apply(owner:string,input:any){
  const preview=this.previews.get(input.preview_token);
  if(!preview||preview.owner!==owner||preview.expires<this.now())throw new ApiError(409,'PREVIEW_EXPIRED','Preview this backup again before applying it.');
  if(input.confirmation!==(preview.mode==='restore'?'RESTORE':'IMPORT'))invalid('Enter the confirmation word shown in the preview.');
  const {doc,hash}=await this.input(owner,{...input,mode:preview.mode});if(hash!==preview.fileHash)throw new ApiError(409,'BACKUP_CHANGED','The selected backup changed. Preview it again.');
  // Create and verify a safety archive before the transaction that replaces any records.
  // Capture/compare again under write locks so concurrent writes cannot be lost silently.
  let safety:any;
  try{
   this.previews.delete(input.preview_token);
   const result=await this.store.db.transaction(async tx=>{
    if(this.store.db.dialect==='postgres')await tx.query('LOCK TABLE records,owner_files,sample_workspaces,recovery_bank_rows IN SHARE ROW EXCLUSIVE MODE');
    const connections=await bankState(tx,owner);if(connections.digest!==preview.banks)throw new ApiError(409,'DATA_CHANGED','Your bank connections changed since preview. Preview again.');
    const current=await snapshot(tx,owner);if(stateFingerprint(current)!==preview.state)throw new ApiError(409,'DATA_CHANGED','Your records changed since preview. Preview again; no records were replaced.');
    const receipt=await tx.query('SELECT * FROM recovery_imports WHERE owner_id=$1 AND fingerprint=$2',[owner,hash]);if(preview.mode==='import'&&receipt.length)throw new ApiError(409,'ALREADY_IMPORTED','This migration was already imported.');
    // Safety file is durable before replacement. Catalog is committed together with restored records.
    safety=await this.save(tx,owner,current,'safety');
    const checked=await decryptArchive(await readFile(this.file(owner,safety.id)),this.key);if(summary(validateSnapshot(checked)).digest!==summary(current).digest)throw new ApiError(409,'SAFETY_BACKUP_FAILED','The safety backup could not be verified. No records were replaced.');
    const reconciliation=await applySnapshot(tx,this.store,owner,doc,preview.mode);
    if(preview.mode==='import')await tx.query('INSERT INTO recovery_imports(owner_id,fingerprint,applied_at) VALUES($1,$2,$3)',[owner,hash,new Date(this.now()).toISOString()]);
    // Revoke every existing browser session after recovery; credentials are never imported.
    await tx.query('DELETE FROM sessions WHERE user_id=$1',[owner]);await tx.query('UPDATE mcp_grants SET revoked=1 WHERE owner_id=$1',[owner]);await tx.query('UPDATE mcp_requests SET used=1 WHERE owner_id=$1',[owner]);return {restored:true,safety_backup_id:safety.id,reconciliation};
   });
   let warning='';await this.prune(owner).catch(()=>{warning='RETENTION_FAILED';});await this.state(owner,true,warning,safety.copy_error).catch(()=>{});return {...result,warning};
  }catch(error){
   // Preserve the verified safety file even if the replacement transaction rolls back.
   if(safety){await this.store.db.transaction(tx=>tx.query('INSERT INTO recovery_backups(id,owner_id,kind,created_at,bytes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[safety.id,owner,'safety',safety.created_at,safety.bytes])).catch(()=>{});await this.prune(owner).catch(()=>{});}
   await this.state(owner,false,error instanceof ApiError?error.code:'RESTORE_FAILED').catch(()=>{});throw error;
  }
 }
 async attachment(owner:string,id:string){const rows=await this.store.db.transaction(tx=>tx.query('SELECT * FROM owner_files WHERE owner_id=$1 AND id=$2',[owner,id]));if(!rows.length)throw new ApiError(404,'NOT_FOUND','Attachment not found.');const f=rows[0];return {name:f.name,mime_type:f.mime_type,content_base64:f.content_base64,sha256:f.sha256};}
}
