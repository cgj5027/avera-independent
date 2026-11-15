import { buildDemoDataset,createDemoRecords,DEMO_PROFILE_KEYS } from '../shared/demo-profiles.js';
import { RecordStore,body } from './store.ts';
import { object } from './validation.ts';
import { ApiError,invalid } from './errors.ts';

/** Select or explicitly reset one owner's scenario in a single database transaction. */
export async function sampleWorkspace(store:RecordStore,owner:string,input:unknown){
 const data=object(input),profile=data.profile;
 if(!DEMO_PROFILE_KEYS.includes(profile)||Object.keys(data).some(k=>!['profile','reset'].includes(k))||(data.reset!==undefined&&typeof data.reset!=='boolean'))invalid('Choose a sample scenario.');
 const dataset=buildDemoDataset(profile,new Date());
 const names:Record<string,string>={property:'Property',mortgageRecord:'MortgageRecord',transaction:'Transaction',account:'Account',incomeSource:'IncomeSource',bill:'Bill',budgetCategory:'BudgetCategory',goal:'Goal',householdProfile:'HouseholdProfile',jobProfile:'JobProfile'};
 return store.db.transaction(async tx=>{
  // Serialize requests for the same owner, including concurrent first loads/resets.
  await tx.query('SELECT id FROM users WHERE id=$1'+(store.db.dialect==='postgres'?' FOR UPDATE':''),[owner]);
  const initialized=await tx.query('SELECT * FROM sample_workspaces WHERE owner_id=$1 AND profile=$2',[owner,profile]);
  const tag=store.db.dialect==='postgres'?"body->>'demo_profile'":"json_extract(body,'$.demo_profile')";
  const selected=await tx.query(`SELECT * FROM records WHERE owner_id=$1 AND deleted_at IS NULL AND ${tag}=$2`,[owner,profile]);
  const linked=selected.find(row=>row.collection==='PlaidItem');
  if(data.reset===true&&linked)throw new ApiError(409,'SAMPLE_BANK_CONNECTED','Disconnect the sample test bank in Settings before resetting this scenario.');
  if(data.reset===true){
   // Includes ForecastRecord, dismissals and contributions; does not depend on a UI entity list.
   for(const row of selected){
    const at=new Date().toISOString(),revision=Number(row.revision)+1;
    await tx.query('UPDATE records SET deleted_at=$1,updated_at=$1,revision=$2,dedupe_key=NULL WHERE owner_id=$3 AND collection=$4 AND id=$5',[at,revision,owner,row.collection,row.id]);
    await tx.query('DELETE FROM owner_files WHERE owner_id=$1 AND record_collection=$2 AND record_id=$3',[owner,row.collection,row.id]);
    await tx.query('INSERT INTO changes(owner_id,collection,record_id,revision,operation,changed_at) VALUES($1,$2,$3,$4,$5,$6)',[owner,row.collection,row.id,revision,'delete',at]);
   }
  }
  if(data.reset===true||(!initialized.length&&!selected.length)){
   await createDemoRecords(dataset,async(key:string,rows:any[])=>{
    const out=[];for(const row of rows)out.push(await store.insert(tx,owner,names[key],row));return out;
   });
  }
  await tx.query('INSERT INTO sample_workspaces(owner_id,profile,initialized_at) VALUES($1,$2,$3) ON CONFLICT(owner_id,profile) DO NOTHING',[owner,profile,new Date().toISOString()]);
  return {workspace:{profile,plaid_item_id:linked?body(linked).item_id:null},plaid_used:false,warning:''};
 });
}
