import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sqliteDatabase,postgresDatabase } from '../server/database.ts';
import { startLocalServer } from '../server/http.ts';
for(const dialect of ['sqlite','postgres'] as const)test(`${dialect}: atomic sample workspaces and guest isolation`,{skip:dialect==='postgres'&&!process.env.AVERA_TEST_POSTGRES_URL},async t=>{
 const db=dialect==='sqlite'?sqliteDatabase(':memory:'):postgresDatabase(process.env.AVERA_TEST_POSTGRES_URL!);
 const runtime=await startLocalServer({db,port:0});t.after(()=>runtime.close());
 const request=async(path:string,data?:any,cookie='')=>{
  const res=await fetch(runtime.url+'/api/v1'+path,{method:data===undefined?'GET':'POST',headers:{Origin:runtime.url,'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:res.status,data:await res.json(),cookie:res.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};
 };
 const registered=await request('/auth/register',{email:randomUUID()+'@example.test',password:'fixture-password-only'}),cookie=registered.cookie;
 const owner=(await request('/auth/me',undefined,cookie)).data.id;
 const other=(await request('/auth/register',{email:randomUUID()+'@example.test',password:'fixture-password-only'})).cookie;
 const list=async(name:string,c=cookie)=>(await request('/records/'+name+'/query',{query:{}},c)).data.items;
 await t.test('seeds concurrently once and preserves personal, foreign and other scenario records',async()=>{
  await request('/records/Bill',{name:'Personal rent',amount:80},cookie);
  await request('/records/Bill',{name:'Foreign bill',amount:90},other);
  const results=await Promise.all([request('/services/sampleWorkspace',{profile:'early_career'},cookie),request('/services/sampleWorkspace',{profile:'early_career'},cookie)]);
  assert.ok(results.every(row=>row.status===200),JSON.stringify(results));
  const before=await list('Bill'),first=before.filter((row:any)=>row.demo_profile==='early_career');assert(first.length>0);
  await request('/services/sampleWorkspace',{profile:'multi_income'},cookie);
  assert.equal((await request('/services/sampleWorkspace',{profile:'financial_improvement'},cookie)).status,200);
  assert((await list('Bill')).some((row:any)=>row.demo_profile==='financial_improvement'));
  await request('/services/sampleWorkspace',{profile:'early_career'},cookie);
  assert.deepEqual((await list('Bill')).filter((r:any)=>r.demo_profile==='early_career').map((r:any)=>r.id).sort(),first.map((r:any)=>r.id).sort());
  assert((await list('Bill')).some((r:any)=>r.name==='Personal rent'));assert(!(await list('Bill')).some((r:any)=>r.name==='Foreign bill'));
 });
 await t.test('reset includes forecasts, dismissals and contributions but preserves every other dataset',async()=>{
  await request('/records/ForecastRecord',{year:2026,demo_profile:'early_career'},cookie);
  await request('/records/ForecastRecord',{year:2027},cookie);
  await request('/records/BillSuggestionDismissal',{fingerprint:'sample',demo_profile:'early_career'},cookie);
  const goals=(await list('Goal')).filter((r:any)=>r.demo_profile==='early_career');
  await request('/services/logGoalContribution',{goal_id:goals[0].id,amount:25,request_id:randomUUID(),dataset:{mode:'demo',profile:'early_career'}},cookie);
  const otherScenario=(await list('Bill')).filter((r:any)=>r.demo_profile==='multi_income');
  const result=await request('/services/sampleWorkspace',{profile:'early_career',reset:true},cookie);assert.equal(result.status,200,JSON.stringify(result));
  assert.deepEqual((await list('ForecastRecord')).map((r:any)=>r.year),[2027]);assert.deepEqual(await list('GoalContribution'),[]);assert.deepEqual(await list('BillSuggestionDismissal'),[]);
  assert.deepEqual((await list('Bill')).filter((r:any)=>r.demo_profile==='multi_income'),otherScenario);
  assert((await list('Bill',other)).some((r:any)=>r.name==='Foreign bill'));
 });
 await t.test('a mid-reset write failure rolls back records, revisions and change journal',async()=>{
  const before=await list('Bill');const changeCount=await db.transaction(tx=>tx.query('SELECT COUNT(*) AS n FROM changes WHERE owner_id=$1',[owner]));
  const insert=runtime.store.insert;let count=0;
  runtime.store.insert=async function(...args:Parameters<typeof insert>){if(++count===3)throw Error('fixture interruption');return insert.apply(this,args);};
  try{assert.equal((await request('/services/sampleWorkspace',{profile:'early_career',reset:true},cookie)).status,500);}finally{runtime.store.insert=insert;}
  assert.deepEqual(await list('Bill'),before);assert.deepEqual(await db.transaction(tx=>tx.query('SELECT COUNT(*) AS n FROM changes WHERE owner_id=$1',[owner])),changeCount);
 });
 await t.test('an empty saved scenario stays empty until explicitly reset',async()=>{
  const blank=(await request('/auth/register',{email:randomUUID()+'@example.test',password:'fixture-password-only'})).cookie;
  const id=(await request('/auth/me',undefined,blank)).data.id;
  await request('/services/sampleWorkspace',{profile:'early_career'},blank);
  await db.transaction(tx=>tx.query('DELETE FROM records WHERE owner_id=$1',[id]));
  await request('/services/sampleWorkspace',{profile:'early_career'},blank);assert.deepEqual(await list('Bill',blank),[]);
  await request('/services/sampleWorkspace',{profile:'early_career',reset:true},blank);assert((await list('Bill',blank)).length>0);
 });
 await t.test('guests have isolated, resumable cookie identities and cannot write personal data or use providers',async()=>{
  const a=await request('/auth/sample',{}),b=await request('/auth/sample',{});assert.notEqual(a.data.id,b.data.id);assert.equal(a.data.is_sample,true);assert.equal(a.data.email,'');
  assert.equal((await request('/services/sampleWorkspace',{profile:'early_career'},a.cookie)).status,200);
  assert.deepEqual(await list('Bill',b.cookie),[]);
  assert.equal((await request('/records/Bill',{name:'Personal',amount:10},a.cookie)).status,400);
  assert.equal((await request('/services/setAiConsent',{enabled:true},a.cookie)).status,403);
  assert.equal((await request('/services/askAvera',{question:'Hello'},a.cookie)).status,403);
  assert.equal((await request('/services/plaidCreateLinkToken',{},a.cookie)).status,403);
  assert.equal((await request('/auth/sample',{},cookie)).data.id,owner,'guest entry does not replace a personal session');
  const sampleCookie=a.cookie.split('; ').find((c:string)=>c.startsWith('avera_sample='))!;
  await request('/auth/sample/leave',{},a.cookie);
  assert.equal((await request('/auth/sample',{},sampleCookie)).data.id,a.data.id);
  assert.equal((await request('/services/sampleWorkspace',{profile:'early_career'})).status,401);
  const foreignBill=(await list('Bill'))[0];assert.equal((await request('/records/Bill/'+foreignBill.id,undefined,a.cookie)).status,404);
 });
 await t.test('expired guest rows are cleaned without touching registered accounts',async()=>{
  const guest=await request('/auth/sample',{});await request('/services/sampleWorkspace',{profile:'early_career'},guest.cookie);
  await db.transaction(async tx=>{await tx.query('UPDATE users SET created_at=$1 WHERE id=$2',['2000-01-01T00:00:00.000Z',guest.data.id]);await tx.query('UPDATE sessions SET expires_at=0 WHERE user_id=$1',[guest.data.id]);});
  await request('/auth/sample',{});
  assert.equal((await request('/auth/me',undefined,guest.cookie)).status,401);
  assert.deepEqual(await db.transaction(tx=>tx.query('SELECT * FROM records WHERE owner_id=$1',[guest.data.id])),[]);
  assert((await list('Bill')).some((row:any)=>row.name==='Personal rent'));
 });

});
