import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,writeFile,readdir,stat,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sqliteDatabase,postgresDatabase,migrate } from '../server/database.ts';
import { startLocalServer } from '../server/http.ts';
import { RecoveryService,beforeUpgrade } from '../server/recovery/service.ts';
import { encryptArchive,decryptArchive,sha } from '../server/recovery/archive.ts';
import { validateSnapshot,summary,consistentSnapshot } from '../server/recovery/records.ts';
import { unpackInstallation } from '../server/recovery/installation.ts';
import { prepareMigration } from '../server/recovery/migration.ts';
const pass='fixture-recovery-passphrase-only';
for(const dialect of ['sqlite','postgres'] as const)test(`${dialect}: encrypted backup, restore and migration`,{skip:dialect==='postgres'&&!process.env.AVERA_TEST_POSTGRES_URL},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'avera-recovery-'));
 const db=dialect==='sqlite'?sqliteDatabase(join(dir,'records.sqlite')):postgresDatabase(process.env.AVERA_TEST_POSTGRES_URL!);
 let now=Date.parse('2026-11-13T12:00:00Z');
 const options={directory:join(dir,'backups'),keyPath:join(dir,'backup.key'),copyDirectory:join(dir,'external-drive'),now:()=>now,schedule:false,maxBytes:512*1024*1024};
 const runtime=await startLocalServer({db,port:0,recoveryOptions:options});
 t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
 const service=runtime.recovery!;
 const request=async(path:string,data?:any,cookie='')=>{const res=await fetch(runtime.url+'/api/v1'+path,{method:data===undefined?'GET':'POST',headers:{Origin:runtime.url,'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,data:await res.json(),cookie:res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};};
 const register=async()=>request('/auth/register',{email:randomUUID()+'@example.test',password:'fixture-password-only'});
 const signed=await register(),cookie=signed.cookie,owner=(await request('/auth/me',undefined,cookie)).data.id;
 const other=await register(),foreign=(await request('/auth/me',undefined,other.cookie)).data.id;
 const bill=await runtime.store.create(owner,'Bill',{name:'Owned rent',amount:123.45,source:'Manual'});
 const goal=await runtime.store.create(owner,'Goal',{name:'Owned goal',target_amount:1000,saved_amount:25});
 await runtime.store.contribution(owner,{goal_id:goal.id,amount:10,request_id:randomUUID(),dataset:{mode:'ordinary'}});
 const property=await runtime.store.create(owner,'Property',{nickname:'Owned home',estimated_value:150000});
 await runtime.store.create(owner,'MortgageRecord',{property_id:property.id,monthly_payment:500,outstanding_balance:100000});
 await runtime.store.create(owner,'Transaction',{description:'Owned lunch',amount:12.34,type:'expense',date:'2026-11-13'});
 await runtime.store.create(owner,'Bill',{name:'Owned sample bill',amount:44,demo_profile:'early_career'});
 await runtime.store.create(foreign,'Bill',{name:'Foreign private record',amount:999});
 const attachment=Buffer.from('synthetic private attachment');const attachmentId=randomUUID();
 await db.transaction(tx=>tx.query('INSERT INTO owner_files(owner_id,id,name,mime_type,content_base64,sha256,record_collection,record_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[owner,attachmentId,'fixture.txt','text/plain',attachment.toString('base64'),sha(attachment),'Bill',bill.id]));
 let archive:any;
 await t.test('portable encryption rejects wrong keys/corruption and excludes foreign/private credentials',async()=>{
  await db.transaction(tx=>tx.query('INSERT INTO private_data(owner_id,collection,natural_key,id,ciphertext) VALUES($1,$2,$3,$4,$5)',[owner,'FixtureSecret','fixture',randomUUID(),'MUST-NOT-BE-EXPORTED']));
  archive=await service.export(owner,pass);const bytes=Buffer.from(archive.archive_base64,'base64');
  assert(!bytes.toString().includes('Owned rent'));
  const doc=await decryptArchive(bytes,pass);assert(doc.records.some((r:any)=>r.fields.name==='Owned rent'));assert(!JSON.stringify(doc).includes('Foreign private record'));assert(!JSON.stringify(doc).includes('MUST-NOT-BE-EXPORTED'));assert(!JSON.stringify(doc).includes('password_hash'));
  await assert.rejects(decryptArchive(bytes,'wrong-but-long-enough-passphrase'));
  const corrupt=Buffer.from(bytes);corrupt[corrupt.length-20]^=1;await assert.rejects(decryptArchive(corrupt,pass));
  assert.equal(doc.attachments[0].sha256,sha(attachment));assert.equal(archive.summary.totals_cents['Transaction.amount.expense'],'1234');
 });
 await t.test('saved backups use owner authorization, durable copies, retention and storage limits',async()=>{
  const first=await service.createBackup(owner);const status=await service.status(owner);assert(status.last_success);assert((await readdir(options.copyDirectory)).length>0);
  await assert.rejects(service.preview(foreign,{backup_id:first.id}));
  const bytes=await readFile(join(options.directory,sha(owner),first.id+'.avera'));assert(!bytes.toString().includes('Owned rent'));
  for(let i=1;i<=8;i++){now+=86400000;await service.createBackup(owner,'daily');}
  assert.equal((await service.status(owner)).backups.filter((r:any)=>r.kind==='daily').length,7);
  for(let i=0;i<5;i++){now+=7*86400000;await service.createBackup(owner,'weekly');}
  assert.equal((await service.status(owner)).backups.filter((r:any)=>r.kind==='weekly').length,4);
  const limited=await RecoveryService.create(runtime.store,{...options,maxBytes:1});await assert.rejects(limited.createBackup(owner),/storage is full/);assert.equal((await limited.status(owner)).last_error,'BACKUP_STORAGE_LIMIT');await limited.close();
  const missing=await service.createBackup(owner);await rm(join(options.directory,sha(owner),missing.id+'.avera'));await assert.rejects(service.preview(owner,{backup_id:missing.id}),/missing/);
 });
 await t.test('preview checks current state and owner; restore reconciles rows/files and ends sessions',async()=>{
  const input={archive_base64:archive.archive_base64,passphrase:pass};
  const stale=await service.preview(owner,input);await runtime.store.update(owner,'Bill',bill.id,{amount:222});
  await assert.rejects(service.apply(owner,{...input,preview_token:stale.preview_token,confirmation:'RESTORE'}),/changed since preview/);
  const link=await db.transaction(tx=>runtime.store.insert(tx,owner,'PlaidItem',{item_id:'fixture-linked',institution_name:'Fixture bank',status:'active'},true));
  const preview=await service.preview(owner,input);await assert.rejects(service.apply(foreign,{...input,preview_token:preview.preview_token,confirmation:'RESTORE'}));
  await assert.rejects(service.apply(owner,{...input,preview_token:preview.preview_token,confirmation:'WRONG'}));
  const result=await service.apply(owner,{...input,preview_token:preview.preview_token,confirmation:'RESTORE'});assert.equal(result.restored,true);assert.equal(result.reconciliation.digest,archive.summary.digest);
  assert.equal((await runtime.store.get(owner,'Bill',bill.id)).amount,123.45);assert.equal((await runtime.store.get(owner,'PlaidItem',link.id)).status,'disconnected');assert.equal((await request('/auth/me',undefined,cookie)).status,401);
  assert.equal((await service.attachment(owner,attachmentId)).content_base64,attachment.toString('base64'));await assert.rejects(service.attachment(foreign,attachmentId));
  assert((await runtime.store.list(foreign,'Bill')).items.some(r=>r.name==='Foreign private record'));
  const safety=await service.preview(owner,{backup_id:result.safety_backup_id});assert.equal(safety.incoming.totals_cents['Bill.amount'],'26600');
 });
 await t.test('interrupted restore rolls back finance changes and retains a verified safety copy',async()=>{
  const input={archive_base64:archive.archive_base64,passphrase:pass};await runtime.store.update(owner,'Bill',bill.id,{amount:333});
  const preview=await service.preview(owner,input),before=await consistentSnapshot(runtime.store,owner),original=runtime.store.insert;let writes=0;
  runtime.store.insert=async function(...args:Parameters<typeof original>){if(++writes===3)throw Error('fixture restore interruption');return original.apply(this,args);};
  try{await assert.rejects(service.apply(owner,{...input,preview_token:preview.preview_token,confirmation:'RESTORE'}));}finally{runtime.store.insert=original;}
  const after=await consistentSnapshot(runtime.store,owner);assert.equal(summary(after).digest,summary(before).digest);assert((await service.status(owner)).backups.some((r:any)=>r.kind==='safety'));
 });
 await t.test('cross-owner migration remaps colliding relationship IDs and rejects duplicate or mixed-owner imports',async()=>{
  const source=await decryptArchive(Buffer.from(archive.archive_base64,'base64'),pass);
  const tables:any={};for(const row of source.records){(tables[row.collection]??=[]).push({...row.fields,id:row.id,created_by_id:'authorized-owner',created_date:row.created_at});}
  tables.attachments=source.attachments.map((file:any)=>({...file,created_by_id:'authorized-owner'}));
  const prepared=prepareMigration(tables,'authorized-owner');assert.equal(prepared.source,'base44');
  assert.throws(()=>prepareMigration({...tables,Bill:[{id:randomUUID(),name:'Not owned',amount:1,created_by_id:'other'}]},'authorized-owner'));
  const target=(await register()).cookie,id=(await request('/auth/me',undefined,target)).data.id;
  const input={archive_base64:Buffer.from(JSON.stringify(prepared)).toString('base64'),mode:'import'};
  const preview=await service.preview(id,input),result=await service.apply(id,{...input,preview_token:preview.preview_token,confirmation:'IMPORT'});assert.equal(result.reconciliation.records,prepared.records.length);
  const restoredGoal=(await runtime.store.list(id,'Goal')).items[0];assert.notEqual(restoredGoal.id,goal.id);
  const contributions=(await runtime.store.list(id,'GoalContribution')).items;assert.equal(contributions[0].goal_id,restoredGoal.id);
  const file=await service.attachment(id,attachmentId);assert.equal(file.sha256,sha(attachment));
  await assert.rejects(service.preview(id,input),/empty account/);
 });
 await t.test('restored bank history blocks reconnect until reviewed cleanup, preserving manual finances',async()=>{
  const target=await register(),person=(await request('/auth/me',undefined,target.cookie)).data;
  const doc=await decryptArchive(Buffer.from(archive.archive_base64,'base64'),pass);
  doc.records.push({collection:'Transaction',id:randomUUID(),revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),fields:{description:'Archived bank charge',amount:5,type:'expense',date:'2026-11-13',source:'Plaid Sandbox'}});
  doc.records.push({collection:'Account',id:randomUUID(),revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),fields:{name:'Legacy bank account',balance:50,source:'Manual',plaid_account_id:'fixture-account-id'}});
  const input={archive_base64:(await encryptArchive(doc,pass)).toString('base64'),passphrase:pass};const reviewed=await service.preview(person.id,input);await service.apply(person.id,{...input,preview_token:reviewed.preview_token,confirmation:'RESTORE'});
  const login=await request('/auth/login',{email:person.email,password:'fixture-password-only'});
  assert.equal((await request('/services/plaidCreateLinkToken',{},login.cookie)).data.code,'RECONNECT_REVIEW_REQUIRED');assert.equal((await service.status(person.id)).restored_bank_history,2);
  const historical=(await runtime.store.list(person.id,'Transaction')).items.find(row=>row.restored_bank_history);assert(historical);await runtime.store.update(person.id,'Transaction',historical.id,{category:'Food',restored_bank_history:true});await assert.rejects(runtime.store.update(person.id,'Transaction',historical.id,{restored_bank_history:false}),/managed by recovery/);
  const cleanup=await service.preview(person.id,{clear_bank_history:true});assert.equal(cleanup.incoming.records,doc.records.length-2);await service.apply(person.id,{clear_bank_history:true,preview_token:cleanup.preview_token,confirmation:'RESTORE'});
  assert.equal((await service.status(person.id)).restored_bank_history,0);assert((await runtime.store.list(person.id,'Bill')).items.some(row=>row.name==='Owned rent'));
 });
 await t.test('preview expiry, changed bank links, bad relationships and failed off-device copies are explicit',async()=>{
  const input={archive_base64:archive.archive_base64,passphrase:pass};const expired=await service.preview(owner,input);now+=11*60000;await assert.rejects(service.apply(owner,{...input,preview_token:expired.preview_token,confirmation:'RESTORE'}),/Preview/);
  const changed=await service.preview(owner,input);await db.transaction(tx=>runtime.store.insert(tx,owner,'PlaidItem',{item_id:'changed-bank',institution_name:'Fixture bank',status:'active'},true));await assert.rejects(service.apply(owner,{...input,preview_token:changed.preview_token,confirmation:'RESTORE'}),/connections changed/);
  const doc=await decryptArchive(Buffer.from(archive.archive_base64,'base64'),pass);const orphan={...doc,records:doc.records.filter((r:any)=>r.collection!=='Goal')};assert.throws(()=>validateSnapshot(orphan),/relationship/);
  const duplicate={...doc,records:[...doc.records,{...doc.records.find((r:any)=>r.collection==='Bill'),collection:'BudgetCategory',id:randomUUID(),fields:{name:'Food',monthly_limit:100}},{...doc.records.find((r:any)=>r.collection==='Bill'),collection:'BudgetCategory',id:randomUUID(),fields:{name:' food ',monthly_limit:200}}]};assert.throws(()=>validateSnapshot(duplicate),/duplicate budget/);
  const blocked=join(dir,'not-a-drive');await writeFile(blocked,'fixture');const copies=await RecoveryService.create(runtime.store,{...options,copyDirectory:blocked});await copies.createBackup(owner);assert.equal((await copies.status(owner)).copy_error,'OFF_DEVICE_COPY_FAILED');await copies.close();
 });
 await t.test('lost recovery key fails safely while portable exports remain possible',async()=>{
  const old=await readFile(options.keyPath);await rm(options.keyPath);
  const restarted=await RecoveryService.create(runtime.store,options);assert.equal((await restarted.status(owner)).last_error,'RECOVERY_KEY_MISSING');await assert.rejects(restarted.createBackup(owner),/recovery/);
  const portable=await restarted.export(owner,pass);assert(portable.archive_base64);await restarted.close();await writeFile(options.keyPath,old,{mode:0o600});
 });
 await t.test('automatic scheduling makes at most one daily and weekly snapshot per interval',async()=>{
  now+=86400000;await service.daily();const before=await service.status(owner);await service.daily();assert.deepEqual((await service.status(owner)).backups,before.backups);
 });
 await t.test('invalid schema, file traversal, altered content and guest access fail without writes',async()=>{
  const doc=await decryptArchive(Buffer.from(archive.archive_base64,'base64'),pass);assert.throws(()=>validateSnapshot({...doc,schema_version:999}));
  assert.throws(()=>validateSnapshot({...doc,attachments:[{...doc.attachments[0],name:'../../escape'}]}));
  assert.throws(()=>validateSnapshot({...doc,attachments:[{...doc.attachments[0],sha256:'0'.repeat(64)}]}));
  const guest=await request('/auth/sample',{});assert.equal((await request('/recovery/export',{passphrase:pass},guest.cookie)).status,403);
  assert.equal((await request('/recovery/status')).status,401);
  const who=(await register()).cookie;const csrf=await fetch(runtime.url+'/api/v1/recovery/backup',{method:'POST',headers:{Origin:'https://untrusted.example',Cookie:who,'Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
 });
});
test('SQLite upgrade protection uses a consistent snapshot and a separate key',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'avera-preupgrade-')),db=sqliteDatabase(join(dir,'live.sqlite'));
 try{await migrate(db,3);await mkdir(join(dir,'private-files','owner'),{recursive:true});await writeFile(join(dir,'private-files','owner','fixture.txt'),'private upgrade fixture');await beforeUpgrade(db,{directory:join(dir,'backups'),keyPath:join(dir,'backup.key'),filesPath:join(dir,'private-files')});const list=await readdir(join(dir,'backups','installation'));assert.equal(list.length,1);
 const bytes=await readFile(join(dir,'backups','installation',list[0])),key=(await readFile(join(dir,'backup.key'))).toString('base64');const doc=await decryptArchive(bytes,key);assert.equal(doc.format,'avera-installation-sqlite');assert.equal(doc.schema_version,3);
 const staged=join(dir,'staged');const recovered=await unpackInstallation(bytes,key,staged);assert.equal(recovered.schema_version,3);assert.equal(await readFile(join(staged,'files','owner','fixture.txt'),'utf8'),'private upgrade fixture');await assert.rejects(unpackInstallation(await encryptArchive({...doc,files:[{...doc.files[0],path:'../escape'}]},key),key,join(dir,'unsafe')));assert((await stat(join(staged,'records.sqlite'))).isFile());await assert.rejects(unpackInstallation(bytes,key,staged));
 assert.equal((await stat(join(dir,'backup.key'))).mode&0o777,0o600);
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
});

test('portable recovery handles Unicode passphrases consistently and preserves SQLite to PostgreSQL finances',{skip:!process.env.AVERA_TEST_POSTGRES_URL},async()=>{
 const unicode='fixture-cafe\u0301-recovery-passphrase';const bytes=await encryptArchive({value:'fixture'},unicode);assert.deepEqual(await decryptArchive(bytes,unicode.normalize('NFC')),{value:'fixture'});await assert.rejects(encryptArchive({},'😀😀😀😀'));
 const dir=await mkdtemp(join(tmpdir(),'avera-cross-store-'));const source=await startLocalServer({db:sqliteDatabase(join(dir,'source.sqlite')),port:0,recoveryOptions:{directory:join(dir,'source-backups'),keyPath:join(dir,'source.key'),schedule:false}});
 const target=await startLocalServer({db:postgresDatabase(process.env.AVERA_TEST_POSTGRES_URL!),port:0,recoveryOptions:{directory:join(dir,'target-backups'),keyPath:join(dir,'target.key'),schedule:false}});
 try{
  async function account(runtime:any){const user=await runtime.auth.register({email:randomUUID()+'@example.test',password:'fixture-password-only'});return (await runtime.auth.current(user.token)).id;}
  const from=await account(source),to=await account(target);await source.store.create(from,'Bill',{name:'Portable rent',amount:321.09});
  const archive=await source.recovery!.export(from,pass),input={archive_base64:archive.archive_base64,passphrase:pass};const preview=await target.recovery!.preview(to,input);await target.recovery!.apply(to,{...input,preview_token:preview.preview_token,confirmation:'RESTORE'});
  assert.equal((await target.store.list(to,'Bill')).items[0].amount,321.09);
 }finally{await source.close();await target.close();await rm(dir,{recursive:true,force:true});}
});
