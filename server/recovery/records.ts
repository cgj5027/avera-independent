import { randomUUID } from 'node:crypto';
import type { Transaction } from '../database.ts';
import { RecordStore,body } from '../store.ts';
import { recordSchemas,validateRecord,object } from '../validation.ts';
import { ApiError,invalid } from '../errors.ts';
import { canonical,sha,fromBase64,MAX_ARCHIVE_BYTES } from './archive.ts';
export const RECOVERY_SCHEMA=5;
export const COLLECTIONS=Object.keys(recordSchemas).filter(name=>name!=='PlaidItem');
const bankFields=new Set(['plaid_item_id','plaid_account_id','plaid_transaction_id','import_key']);
const idValid=(value:any)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const iso=(value:any)=>typeof value==='string'&&value.length<=30&&Number.isFinite(Date.parse(value));
export type SavedRecord={collection:string;id:string;fields:Record<string,any>;revision:number;created_at:string;updated_at:string};
export type SavedFile={id:string;name:string;mime_type:string;content_base64:string;sha256:string;record_collection:string|null;record_id:string|null};
export type Snapshot={format:'avera-records';version:1;schema_version:number;created_at:string;source:string;records:SavedRecord[];attachments:SavedFile[];workspaces:string[]};
function cleanFields(collection:string,fields:any,id:string){
 const copy={...object(fields)};
 const bankHistory=['Account','Transaction'].includes(collection)&&(copy.source==='Plaid Sandbox'||[...bankFields].some(name=>copy[name]));
 for(const name of bankFields)delete copy[name];
 if(bankHistory)copy.restored_bank_history=true;
 if(collection==='GoalContribution')copy.contribution_key='archive:'+id;
 return validateRecord(collection,copy,undefined,true);
}
export function validateSnapshot(input:unknown):Snapshot{
 const doc=object(input);
 if(doc.format!=='avera-records'||doc.version!==1||!Number.isInteger(doc.schema_version)||doc.schema_version<1||doc.schema_version>RECOVERY_SCHEMA||!iso(doc.created_at)||!['avera','base44'].includes(doc.source))invalid('This backup format or schema version is not supported.');
 if(!Array.isArray(doc.records)||doc.records.length>10000||!Array.isArray(doc.attachments)||doc.attachments.length>200||!Array.isArray(doc.workspaces))invalid('This backup exceeds the supported record or attachment limits.');
 if(Buffer.byteLength(JSON.stringify(doc))>MAX_ARCHIVE_BYTES-128)throw new ApiError(413,'BACKUP_TOO_LARGE','This backup exceeds the portable size limit.');
 const seen=new Set<string>();
 const categories=new Set<string>();
 const records:SavedRecord[]=doc.records.map((raw:any)=>{
  const row=object(raw);
  if(!COLLECTIONS.includes(row.collection)||!idValid(row.id)||!Number.isSafeInteger(row.revision)||row.revision<1||!iso(row.created_at)||!iso(row.updated_at))invalid('A backup record is invalid.');
  const key=row.collection+':'+row.id;if(seen.has(key))invalid('The backup contains duplicate record identifiers.');seen.add(key);
  return {collection:row.collection,id:row.id,fields:cleanFields(row.collection,row.fields,row.id),revision:row.revision,created_at:row.created_at,updated_at:row.updated_at};
 });
 for(const row of records)if(row.collection==='BudgetCategory'){const key=JSON.stringify([row.fields.demo_profile||'',row.fields.name.trim().toLowerCase()]);if(categories.has(key))invalid('The backup contains duplicate budget categories.');categories.add(key);}
 const byId=new Map(records.map(row=>[row.collection+':'+row.id,row]));
 for(const row of records){
  const parent=row.collection==='MortgageRecord'?['Property','property_id']:row.collection==='GoalContribution'?['Goal','goal_id']:null;
  if(parent){const linked=byId.get(parent[0]+':'+row.fields[parent[1]]);if(!linked||(linked.fields.demo_profile??'')!==(row.fields.demo_profile??''))invalid('A backup relationship is missing or crosses datasets.');}
 }
 const fileIds=new Set();
 const attachments:SavedFile[]=doc.attachments.map((raw:any)=>{
  const f=object(raw);
  if(!idValid(f.id)||fileIds.has(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.length>200||/[\\/\u0000-\u001f\u007f]/.test(f.name)||typeof f.mime_type!=='string'||!/^[\w.+-]+\/[\w.+-]+$/.test(f.mime_type)||f.mime_type.length>100)invalid('Attachment metadata is invalid.');
  fileIds.add(f.id);const bytes=fromBase64(f.content_base64,4*1024*1024);
  if(sha(bytes)!==f.sha256)invalid('An attachment failed its integrity check.');
  if((f.record_collection||f.record_id)&&!byId.has(f.record_collection+':'+f.record_id))invalid('An attachment references a missing record.');
  return {id:f.id,name:f.name,mime_type:f.mime_type,content_base64:f.content_base64,sha256:f.sha256,record_collection:f.record_collection||null,record_id:f.record_id||null};
 });
 const workspaces=[...new Set<string>(doc.workspaces)];if(workspaces.some(p=>!['early_career','multi_income','financial_improvement'].includes(p)))invalid('A sample workspace is invalid.');
 return {format:'avera-records',version:1,schema_version:doc.schema_version,created_at:doc.created_at,source:doc.source,records,attachments,workspaces};
}
export async function snapshot(tx:Transaction,owner:string):Promise<Snapshot>{
 const rows=await tx.query("SELECT * FROM records WHERE owner_id=$1 AND collection<>'PlaidItem' AND deleted_at IS NULL ORDER BY collection,id LIMIT 10001",[owner]);
 const files=await tx.query('SELECT * FROM owner_files WHERE owner_id=$1 ORDER BY id LIMIT 201',[owner]);
 const workspaces=await tx.query('SELECT profile FROM sample_workspaces WHERE owner_id=$1 ORDER BY profile',[owner]);
 return validateSnapshot({format:'avera-records',version:1,schema_version:RECOVERY_SCHEMA,created_at:new Date().toISOString(),source:'avera',records:rows.filter(row=>row.collection!=='PlaidItem').map(row=>({collection:row.collection,id:row.id,fields:body(row),revision:Number(row.revision),created_at:row.created_at,updated_at:row.updated_at})),attachments:files,workspaces:workspaces.map(row=>row.profile)});
}
export function summary(doc:Snapshot){
 const counts:Record<string,number>={},datasets:Record<string,number>={},totals:Record<string,string>={};
 const money=['amount','balance','monthly_limit','target_amount','saved_amount','estimated_value','outstanding_balance','monthly_payment','projected_income','projected_expenses','projected_savings','year_end_cash','taxes_monthly','insurance_monthly','hoa_monthly','maintenance_monthly'];
 for(const row of doc.records){counts[row.collection]=(counts[row.collection]??0)+1;const dataset=row.fields.demo_profile||'personal';datasets[dataset]=(datasets[dataset]??0)+1;
  for(const field of money)if(typeof row.fields[field]==='number'){const key=row.collection+'.'+field+(row.collection==='Transaction'?'.'+row.fields.type:'');totals[key]=(BigInt(totals[key]??'0')+BigInt(Math.round(row.fields[field]*100))).toString();}
 }
 const semantic=doc.records.map(row=>{const {contribution_key,...fields}=row.fields;return {collection:row.collection,id:row.id,fields};}).sort((a,b)=>(a.collection+':'+a.id).localeCompare(b.collection+':'+b.id));
 return {created_at:doc.created_at,source:doc.source,records:doc.records.length,attachments:doc.attachments.length,counts,datasets,totals_cents:totals,digest:sha(canonical({records:semantic,files:doc.attachments,workspaces:[...doc.workspaces].sort()}))};
}
export function stateFingerprint(doc:Snapshot){const {created_at,...stable}=summary(doc);return sha(canonical({summary:stable,revisions:doc.records.map(r=>[r.collection,r.id,r.revision,r.updated_at])}));}
export async function bankState(tx:Transaction,owner:string){
 const rows=await tx.query("SELECT id,revision,body FROM records WHERE owner_id=$1 AND collection='PlaidItem' AND deleted_at IS NULL ORDER BY id",[owner]);
 const values=rows.map(row=>({id:row.id,revision:Number(row.revision),status:body(row).status}));
 return {digest:sha(canonical(values)),active:values.filter(row=>row.status!=='disconnected').length};
}
export async function consistentSnapshot(store:RecordStore,owner:string){return store.db.transaction(async tx=>{if(store.db.dialect==='postgres')await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');return snapshot(tx,owner);});}
/** Restore only the current owner's public finances. No sessions, tokens or passwords are accepted. */
export async function applySnapshot(tx:Transaction,store:RecordStore,owner:string,doc:Snapshot,mode:'restore'|'import'){
 const prior=await tx.query('SELECT * FROM records WHERE owner_id=$1',[owner]);
 const active=prior.filter(row=>!row.deleted_at&&row.collection!=='PlaidItem');
 if(mode==='import'&&active.length)throw new ApiError(409,'IMPORT_NOT_EMPTY','Use an empty account for migration to avoid duplicate financial totals.');
 const banks=prior.filter(row=>!row.deleted_at&&row.collection==='PlaidItem'&&body(row).status!=='disconnected');
 // Deactivate only local links, without requiring provider connectivity. Keep encrypted credentials
 // so the owner can complete remote revocation through Settings when online again.
 for(const row of banks){const fields={...body(row),status:'disconnected'},revision=Number(row.revision)+1,at=new Date().toISOString();await tx.query('UPDATE records SET body=$1,revision=$2,updated_at=$3 WHERE owner_id=$4 AND collection=$5 AND id=$6',[JSON.stringify(fields),revision,at,owner,'PlaidItem',row.id]);await tx.query('INSERT INTO changes(owner_id,collection,record_id,revision,operation,changed_at) VALUES($1,$2,$3,$4,$5,$6)',[owner,'PlaidItem',row.id,revision,'update',at]);}
 const map=new Map<string,string>(),reverse=new Map<string,string>();
 for(const row of doc.records){const matches=await tx.query('SELECT owner_id FROM records WHERE collection=$1 AND id=$2',[row.collection,row.id]);const id=matches.some(m=>m.owner_id!==owner)?randomUUID():row.id;map.set(row.collection+':'+row.id,id);reverse.set(row.collection+':'+id,row.id);}
 const at=new Date().toISOString();
 if(mode==='restore'){
  for(const row of active)await tx.query('INSERT INTO changes(owner_id,collection,record_id,revision,operation,changed_at) VALUES($1,$2,$3,$4,$5,$6)',[owner,row.collection,row.id,Number(row.revision)+1,'delete',at]);
  await tx.query('DELETE FROM recovery_bank_rows WHERE owner_id=$1',[owner]);
  await tx.query("DELETE FROM records WHERE owner_id=$1 AND collection<>'PlaidItem'",[owner]);
  await tx.query('DELETE FROM owner_files WHERE owner_id=$1',[owner]);await tx.query('DELETE FROM sample_workspaces WHERE owner_id=$1',[owner]);
 }
 const rank=(r:SavedRecord)=>r.collection==='Property'||r.collection==='Goal'?0:r.collection==='MortgageRecord'||r.collection==='GoalContribution'?2:1;
 const restored:SavedRecord[]=[];
 for(const row of [...doc.records].sort((a,b)=>rank(a)-rank(b))){
  const fields={...row.fields},id=map.get(row.collection+':'+row.id)!;
  if(row.collection==='MortgageRecord')fields.property_id=map.get('Property:'+fields.property_id);
  if(row.collection==='GoalContribution'){fields.goal_id=map.get('Goal:'+fields.goal_id);fields.contribution_key=JSON.stringify([owner,fields.goal_id,'restore:'+row.id]);}
  // Reuse identities unless another owner already holds that collection/id.
  if(mode==='import')await tx.query('DELETE FROM records WHERE owner_id=$1 AND collection=$2 AND id=$3 AND deleted_at IS NOT NULL',[owner,row.collection,id]);
  const old=prior.find(r=>r.collection===row.collection&&r.id===id);
  const revision=Math.max(row.revision,Number(old?.revision??0)+2);
  const made=await store.insert(tx,owner,row.collection,fields,true,{id,revision,created_at:row.created_at});
  const plain:Record<string,any>={...made};for(const key of ['id','created_by_id','created_date','updated_date','revision'])delete plain[key];
  if(row.collection==='MortgageRecord')plain.property_id=reverse.get('Property:'+plain.property_id);
  if(row.collection==='GoalContribution')plain.goal_id=reverse.get('Goal:'+plain.goal_id);
  if(['Account','Transaction'].includes(row.collection)&&(row.fields.restored_bank_history===true||row.fields.source==='Plaid Sandbox'))await tx.query('INSERT INTO recovery_bank_rows(owner_id,collection,id) VALUES($1,$2,$3) ON CONFLICT(owner_id,collection,id) DO NOTHING',[owner,row.collection,id]);
  restored.push({...row,fields:cleanFields(row.collection,plain,row.id)});
 }
 for(const f of doc.attachments){let parent=f.record_id;if(parent)parent=map.get(f.record_collection+':'+parent)!;await tx.query('INSERT INTO owner_files(owner_id,id,name,mime_type,content_base64,sha256,record_collection,record_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[owner,f.id,f.name,f.mime_type,f.content_base64,f.sha256,f.record_collection,parent]);}
 for(const profile of doc.workspaces)await tx.query('INSERT INTO sample_workspaces(owner_id,profile,initialized_at) VALUES($1,$2,$3) ON CONFLICT(owner_id,profile) DO NOTHING',[owner,profile,at]);
 const reconciliation={...doc,records:restored};if(summary(reconciliation).digest!==summary(doc).digest)throw new ApiError(409,'RECONCILIATION_FAILED','Restored records did not match the preview. No changes were committed.');
 return summary(doc);
}
