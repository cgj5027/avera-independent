import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as rawRequest } from 'node:http';
import { sqliteDatabase, postgresDatabase } from '../server/database.ts';
import { startLocalServer } from '../server/http.ts';
import { createHttpAdapter } from '../src/platform/adapters/http.ts';

for (const dialect of ['sqlite','postgres'] as const) {
  test(`${dialect}: real server/storage contract`, {skip:dialect==='postgres' && !process.env.AVERA_TEST_POSTGRES_URL}, async t=>{
    const dir=await mkdtemp(join(tmpdir(),'avera-stage3-'));
    const open=()=>dialect==='sqlite' ? sqliteDatabase(join(dir,'records.sqlite')) : postgresDatabase(process.env.AVERA_TEST_POSTGRES_URL!);
    let runtime=await startLocalServer({db:open(),port:0});
    t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
    async function request(path: string, method='GET', data?: unknown, session='', headers: Record<string,string>={}) {
      const response=await fetch(runtime.url+'/api/v1'+path,{method,headers:{Origin:runtime.url,'Content-Type':'application/json',...(session?{Cookie:session}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
      return {status:response.status,data:await response.json(),headers:response.headers};
    }
    const email=`${randomUUID()}@example.test`, password='fixture-password-only';
    const signup=await request('/auth/register','POST',{email,password});
    assert.equal(signup.status,200);
    assert.equal(signup.data.requires_verification,false);
    const session=signup.headers.get('set-cookie')!.split(';')[0];
    assert.match(signup.headers.get('set-cookie')!,/HttpOnly; SameSite=Lax/);
    const me=await request('/auth/me','GET',undefined,session);
    const owner=me.data.id;
    const signupB=await request('/auth/register','POST',{email:`${randomUUID()}@example.test`,password});
    const other=signupB.headers.get('set-cookie')!.split(';')[0];
    const create=await request('/records/Account','POST',{name:'Checking',balance:125,source:'Manual'},session);
    assert.equal(create.status,201);
    const id=create.data.id;

    await t.test('requires a real server session; rejects origin and host spoofing',async()=>{
      assert.equal((await request('/records/Account/query','POST',{})).status,401);
      assert.equal((await request('/records/Account/query','POST',{},session,{Origin:'https://untrusted.example'})).status,403);
      assert.equal((await request('/records/Account/query','POST',{},session,{Origin:''})).status,403);
      const rejectedHost=await new Promise<number>(resolve=>{
        rawRequest(runtime.url+'/api/v1/health',{headers:{Host:'untrusted.example'}},response=>{
          response.resume(); resolve(response.statusCode!);
        }).end();
      });
      assert.equal(rejectedHost,421);
      assert.equal((await request('/auth/me','PATCH',{role:'admin'},session)).status,400);
      assert.equal((await request('/auth/me','PATCH',{display_name:'Bad\0name'},session)).status,400);
      assert.equal((await request('/auth/me','PATCH',{display_name:' Example '},session)).data.display_name,'Example');
    });
    await t.test('isolates record IDs, queries, writes and bulk actions between users',async()=>{
      assert.equal((await request(`/records/Account/${id}`,'GET',undefined,other)).status,404);
      assert.equal((await request(`/records/Account/${id}`,'PATCH',{balance:999},other)).status,404);
      assert.equal((await request(`/records/Account/${id}`,'DELETE',{},other)).status,404);
      const foreign=await request('/records/Account/query','POST',{query:{created_by_id:owner}},other);
      assert.deepEqual(foreign.data.items,[]);
      assert.equal((await request('/records/Account','POST',{name:'Forged',created_by_id:owner},other)).status,400);
      assert.equal((await request('/records/PlaidCredential/query','POST',{},session)).status,400);
      assert.equal((await request('/records/PlaidItem','POST',{item_id:'forged'},session)).status,400);
      assert.equal((await request('/records/MortgageRecord','POST',{property_id:id},other)).status,404);
    });
    await t.test('validates writes, rejects unknown filters, and rolls back an entire failed batch',async()=>{
      assert.equal((await request('/records/Bill','POST',{name:'Bad',amount:-1},session)).status,400);
      assert.equal((await request('/records/Bill','POST',{name:'Bad',amount:1,next_due_date:'2026-02-30'},session)).status,400);
      assert.equal((await request('/records/Account/query','POST',{query:{$where:'DROP TABLE users'}},session)).status,400);
      assert.equal((await request('/records/Account/query','POST',{options:{sort:'name; DROP TABLE users'}},session)).status,400);
      assert.equal((await request('/records/Account/query','POST',{options:{cursor:Buffer.from('null').toString('base64url')}},session)).status,400);
      const batch=await request('/records/BudgetCategory/bulk','POST',{rows:[{name:'Duplicate'},{name:'duplicate'}]},session);
      assert.equal(batch.status,409);
      assert.deepEqual((await request('/records/BudgetCategory/query','POST',{},session)).data.items,[]);
      const before=await request(`/records/Account/${id}`,'GET',undefined,session);
      assert.equal(before.data.balance,125);
      assert.equal((await request('/records/Account','POST',{name:'x'.repeat(1024*1024)},session)).status,413);
    });
    await t.test('allows categorization but rejects changes to imported bank amounts',async()=>{
      const imported=await runtime.store.db.transaction(tx=>runtime.store.insert(tx,owner,'Transaction',{
        description:'Fixture bank purchase',amount:12,date:'2026-11-01',source:'Plaid Sandbox',plaid_item_id:'fixture-item',category:'Other',
      },true));
      assert.equal((await request(`/records/Transaction/${imported.id}`,'PATCH',{category:'Food'},session)).status,200);
      assert.equal((await request(`/records/Transaction/${imported.id}`,'PATCH',{amount:999},session)).status,400);
      assert.equal((await request(`/records/Transaction/${imported.id}`,'GET',undefined,session)).data.amount,12);
    });
    await t.test('enforces property relationships and cascades mortgage deletion within the owner dataset',async()=>{
      const property=await request('/records/Property','POST',{nickname:'Sample home',estimated_value:100000,demo_profile:'multi_income'},session);
      assert.equal(property.status,201);
      const fields={property_id:property.data.id,outstanding_balance:30000,monthly_payment:200,demo_profile:'multi_income'};
      assert.equal((await request('/records/MortgageRecord','POST',fields,other)).status,404);
      assert.equal((await request('/records/MortgageRecord','POST',{...fields,demo_profile:''},session)).status,400);
      const mortgage=await request('/records/MortgageRecord','POST',fields,session);
      assert.equal(mortgage.status,201);
      assert.equal((await request(`/records/Property/${property.data.id}`,'DELETE',{},session)).status,200);
      assert.equal((await request(`/records/MortgageRecord/${mortgage.data.id}`,'GET',undefined,session)).status,404);
    });
    await t.test('preserves dataset scopes and cursor pagination without duplicates',async()=>{
      await request('/records/Account','POST',{name:'Sample',balance:10,demo_profile:'early_career',source:'Sample data'},session);
      const ordinary={ $or:[{demo_profile:{$exists:false}},{demo_profile:null},{demo_profile:''}] };
      assert.equal((await request('/records/Account/query','POST',{query:ordinary},session)).data.items.length,1);
      const demo=await request('/records/Account/query','POST',{query:{demo_profile:'early_career'}},session);
      assert.equal(demo.data.items.length,1);
      assert.equal((await request(`/records/Account/${id}`,'PATCH',{demo_profile:'early_career'},session)).status,400);
      const page=await request('/records/Account/query','POST',{options:{limit:1}},session);
      assert.equal(page.data.has_more,true);
      const next=await request('/records/Account/query','POST',{options:{limit:1,cursor:page.data.next_cursor}},session);
      assert.equal(next.data.items.length,1);
      assert.notEqual(next.data.items[0].id,page.data.items[0].id);
      assert.equal(next.data.has_more,false);
      assert.equal((await request('/records/Account/query','POST',{query:{name:'Sample'},options:{cursor:page.data.next_cursor}},session)).status,400);
      const descending=await request('/records/Account/query','POST',{options:{sort:'-name',limit:1}},session);
      const second=await request('/records/Account/query','POST',{options:{sort:'-name',limit:1,cursor:descending.data.next_cursor}},session);
      assert.notEqual(second.data.items[0].id,descending.data.items[0].id);
    });
    await t.test('retains idempotent concurrent contributions and deletes references atomically',async()=>{
      const goal=(await request('/records/Goal','POST',{name:'Reserve',target_amount:1000},session)).data;
      const a={goal_id:goal.id,amount:10,request_id:'fixture-request-first-0001',dataset:{mode:'ordinary'}};
      const b={...a,amount:20,request_id:'fixture-request-second-0002'};
      const results=await Promise.all([a,a,b].map(input=>request('/services/logGoalContribution','POST',input,session)));
      assert.deepEqual(results.map(r=>r.status),[200,200,200]);
      assert.equal((await request('/services/logGoalContribution','POST',{...a,amount:30},session)).status,409);
      const contributions=(await request('/records/GoalContribution/query','POST',{query:{goal_id:goal.id}},session)).data.items;
      assert.equal(contributions.length,2);
      assert.equal(contributions.reduce((sum:number,row:any)=>sum+row.amount,0),30);
      assert.equal((await request('/services/logGoalContribution','POST',a,other)).status,404);
      assert.equal((await request('/services/logGoalContribution','POST',{...a,dataset:{mode:'demo',profile:'early_career'}},session)).status,404);
      assert.equal((await request(`/records/Goal/${goal.id}`,'DELETE',{},session)).status,200);
      assert.deepEqual((await request('/records/GoalContribution/query','POST',{query:{goal_id:goal.id}},session)).data.items,[]);
    });
    await t.test('uses the HTTP adapter against the real server without Base44',async()=>{
      const application=createHttpAdapter({fetcher:(async(path:any,options:any)=>fetch(new URL(path,runtime.url),{...options,headers:{...options.headers,Origin:runtime.url,Cookie:session}})) as typeof fetch});
      assert.equal((await application.auth.currentUser()).id,owner);
      const bill=await application.records.collection('Bill').create({name:'Rent',amount:100,source:'Manual'});
      assert.equal((await application.records.collection('Bill').get(bill.id))!.amount,100);
      assert.equal((await application.services.invoke('projectAnnualIncome',{name:'Salary',amount:100,frequency:'monthly'})).data.annual_amount,1200);
      await assert.rejects(application.services.invoke('askAvera',{question:'Budget?'}),(error:any)=>error.status===503 && error.code==='INTEGRATIONS_UNAVAILABLE');
      await application.auth.signOut();
      await assert.rejects(application.auth.currentUser(),(error:any)=>error.status===401);
    });
    await t.test('survives a server/database restart and records revision/deletion history',async()=>{
      await runtime.close();
      runtime=await startLocalServer({db:open(),port:0});
      const login=await request('/auth/login','POST',{email,password});
      assert.equal(login.status,200);
      const restored=login.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await request(`/records/Account/${id}`,'GET',undefined,restored)).data.balance,125);
      const edit=await request(`/records/Account/${id}`,'PATCH',{balance:175},restored);
      assert.equal(edit.data.revision,2);
      assert.equal((await request(`/records/Account/${id}`,'DELETE',{},restored)).status,200);
      assert.equal((await request(`/records/Account/${id}`,'GET',undefined,restored)).status,404);
      const history=await runtime.store.db.transaction(tx=>tx.query('SELECT * FROM changes WHERE owner_id=$1 AND record_id=$2 ORDER BY seq',[owner,id]));
      assert.deepEqual(history.map(r=>r.operation),['create','update','delete']);
      const count=await runtime.store.db.transaction(tx=>tx.query('SELECT COUNT(*) AS n FROM schema_migrations'));
      assert.equal(Number(count[0].n),5);
    });
  });
}

test('refuses a database from a future schema without modifying it',async()=>{
  const db=sqliteDatabase(':memory:');
  await db.transaction(async tx=>{
    await tx.query('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT)');
    await tx.query('INSERT INTO schema_migrations(version,applied_at) VALUES(99,$1)',['fixture']);
  });
  await assert.rejects(startLocalServer({db,port:0}),/newer Avera version/);
  const versions=await db.transaction(tx=>tx.query('SELECT version FROM schema_migrations'));
  assert.equal(versions[0].version,99);
  await db.close();
});
