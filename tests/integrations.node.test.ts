import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes,randomUUID,generateKeyPairSync,sign } from 'node:crypto';
import { sqliteDatabase,postgresDatabase,migrate } from '../server/database.ts';
import { startLocalServer } from '../server/http.ts';
import { SecretBox,PrivateVault } from '../server/integrations/vault.ts';
import { claimQuota } from '../server/integrations/quota.ts';
import { directTransport } from '../server/integrations/providers.ts';
import { fetchJson } from '../server/integrations/network.ts';
import { PlaidFailure } from '../server/integrations/logic/plaid.js';
import { collectChanges } from '../server/integrations/handlers/plaidSync.js';

function fixture(){
  const calls:any[]=[],mails:any[]=[],state={failSync:false,revision:0,deleteFails:false,malformedAI:false,oauthClaims:{} as any};
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const fetcher:typeof fetch=async(raw,init={})=>{
    const url=new URL(String(raw)),body=typeof init.body==='string'&&String(init.headers&&new Headers(init.headers).get('Content-Type')).includes('json')?JSON.parse(init.body):{};
    calls.push({url:url.href,body,init});
    if(url.hostname==='api.resend.com'){mails.push(body);return Response.json({id:'fixture-mail'});}
    if(url.hostname==='sandbox.plaid.com'){
      const token='access-sandbox-fixture-private';
      if(url.pathname==='/item/public_token/exchange')return Response.json({access_token:token,item_id:'fixture-item'});
      if(url.pathname==='/item/get')return Response.json({item:{institution_id:'ins_fixture'}});
      if(url.pathname==='/institutions/get_by_id')return Response.json({institution:{name:'Synthetic Bank'}});
      if(url.pathname==='/accounts/get')return Response.json({accounts:[{account_id:'acc_fixture',name:'Synthetic Checking',type:'depository',subtype:'checking',balances:{current:1000,available:980,iso_currency_code:'USD'}}]});
      if(url.pathname==='/transactions/sync'){
        if(state.failSync)return Response.json({error_code:'PRODUCT_NOT_READY'},{status:400});
        return Response.json({added:[{transaction_id:'txn_fixture',account_id:'acc_fixture',name:'Fixture Store',amount:12+state.revision,date:'2026-11-01',iso_currency_code:'USD'}],modified:[],removed:[],next_cursor:'fixture-cursor-'+state.revision,has_more:false});
      }
      if(url.pathname==='/link/token/create')return Response.json({link_token:'link-sandbox-fixture',expiration:new Date().toISOString()});
      return Response.json({removed:true});
    }
    if(url.hostname==='api.openai.com'){
      if(url.pathname==='/v1/files'&&init.method==='POST')return Response.json({id:'file-fixture'});
      if(url.pathname==='/v1/files/file-fixture'&&init.method==='DELETE')return Response.json({deleted:!state.deleteFails},{status:state.deleteFails?503:200});
      const schema=body.text?.format?.schema;
      const answer:any={};
      for(const [key,rule] of Object.entries(schema?.properties??{}) as any){answer[key]=rule.type==='array'?[]:key==='answer'?'Fixture answer using owned data.':'Fixture skill';}
      if(state.malformedAI)answer.answer=42;
      return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(answer)}]}]});
    }
    if(url.hostname==='api.openwebninja.com')return Response.json({status:'OK',data:[]});
    if(url.hostname==='photon.komoot.io')return Response.json({features:[]});
    if(url.hostname==='oauth2.googleapis.com'){
      const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture-key'})).toString('base64url');
      const payload=Buffer.from(JSON.stringify(state.oauthClaims)).toString('base64url');
      const signature=sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
      return Response.json({id_token:header+'.'+payload+'.'+signature});
    }
    if(url.hostname==='www.googleapis.com')return Response.json({keys:[{...publicKey.export({format:'jwk'}),kid:'fixture-key'}]});
    throw new Error('Unexpected external destination '+url.origin);
  };
  return {fetcher,calls,mails,state};
}
for(const dialect of ['sqlite','postgres'] as const){
  test(`${dialect}: independent direct providers and authentication`,{skip:dialect==='postgres'&&!process.env.AVERA_TEST_POSTGRES_URL},async t=>{
    const dir=await mkdtemp(join(tmpdir(),'avera-stage4-')),f=fixture();
    const db=dialect==='sqlite'?sqliteDatabase(join(dir,'records.sqlite')):postgresDatabase(process.env.AVERA_TEST_POSTGRES_URL!);
    const env={AVERA_INTEGRATION_MODE:'direct',AVERA_VAULT_KEY:randomBytes(32).toString('base64'),OPENAI_API_KEY:'fixture-key',PLAID_CLIENT_ID:'fixture-id',PLAID_SECRET:'fixture-only',RESEND_API_KEY:'fixture-key',AVERA_EMAIL_FROM:'Avera <noreply@example.test>',GOOGLE_CLIENT_ID:'fixture-google',GOOGLE_CLIENT_SECRET:'fixture-only',OPENWEBNINJA_API_KEY:'fixture-key'};
    let runtime=await startLocalServer({db,port:0,env,fetcher:f.fetcher});
    t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
    async function request(path:string,data?:any,cookie='',method=data===undefined?'GET':'POST'){
      const response=await fetch(runtime.url+'/api/v1'+path,{method,headers:{Origin:runtime.url,'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]??''};
    }
    const email=randomUUID()+'@example.test',password='fixture-password-only';
    const signup=await request('/auth/register',{email,password});const cookie=signup.cookie;
    const me=await request('/auth/me',undefined,cookie),owner=me.data.id;
    const other=(await request('/auth/register',{email:randomUUID()+'@example.test',password})).cookie;
    await t.test('migrates credentials privately, preserves data, rejects ciphertext tampering',async()=>{
      const box=new SecretBox(Buffer.alloc(32,7)),encrypted=box.seal({secret:'private-fixture'});
      assert.deepEqual(box.open(encrypted),{secret:'private-fixture'});
      assert.throws(()=>new SecretBox(Buffer.alloc(32,8)).open(encrypted),/could not be read/);
      const rows=await db.transaction(tx=>tx.query('SELECT version FROM schema_migrations ORDER BY version'));
      assert.deepEqual(rows.map(row=>row.version),[1,2]);
    });
    await t.test('blocks AI by default, sends only owned dataset context after consent, supports revocation',async()=>{
      await request('/records/Bill',{name:'OWNED-ordinary',amount:10},cookie);
      await request('/records/Bill',{name:'OTHER-secret',amount:20},other);
      await request('/records/Bill',{name:'OWNED-demo',amount:30,demo_profile:'early_career'},cookie);
      const ask={question:'What are my bills?',dataset:{mode:'ordinary'}};
      assert.equal((await request('/services/askAvera',ask,cookie)).status,403);
      assert.equal(f.calls.filter(row=>row.url.includes('openai')).length,0);
      assert.equal((await request('/services/setAiConsent',{enabled:true},cookie)).status,200);
      const answer=await request('/services/askAvera',ask,cookie);assert.equal(answer.status,200,JSON.stringify(answer));
      const prompt=JSON.stringify(f.calls.findLast(row=>row.url.includes('/responses')).body);
      assert.match(prompt,/OWNED-ordinary/);assert.doesNotMatch(prompt,/OTHER-secret|OWNED-demo|password|access-sandbox/);
      assert.equal(f.calls.findLast(row=>row.url.includes('/responses')).body.store,false);
      f.state.malformedAI=true;assert.equal((await request('/services/askAvera',ask,cookie)).status,502);f.state.malformedAI=false;
      await request('/services/setAiConsent',{enabled:false},cookie);
      assert.equal((await request('/services/suggestCategories',{dataset:{mode:'ordinary'}},cookie)).status,403);
    });
    await t.test('detects and reviews recurring bills without AI, then uses retained job sources when enabled',async()=>{
      const callsBefore=f.calls.length;
      const now=new Date();
      for(let ago=2;ago>=0;ago--){const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-ago,1)).toISOString().slice(0,10);await request('/records/Transaction',{description:'Synthetic Power',amount:80,type:'expense',category:'Utilities',date},cookie);}
      const scanned=await request('/services/suggestBills',{action:'scan',dataset:{mode:'ordinary'}},cookie);
      assert.equal(scanned.status,200);assert.equal(scanned.data.ai_available,false);assert.equal(scanned.data.suggestions.length,1);assert.equal(f.calls.length,callsBefore);
      const candidate=scanned.data.suggestions[0];assert.equal(candidate.amount,80);assert.equal(candidate.frequency,'monthly');
      const added=await request('/services/suggestBills',{action:'add',dataset:{mode:'ordinary'},fingerprint:candidate.fingerprint,bill:candidate},cookie);assert.equal(added.status,200);assert.equal(added.data.bill.source,'Estimated');
      await request('/services/setAiConsent',{enabled:true},cookie);
      const jobs=await request('/services/searchJobOpportunities',{skills:'cooking',experience_level:'entry_level',work_mode:'any',job_type:'any'},cookie);
      assert.equal(jobs.status,200,JSON.stringify(jobs));assert.equal(jobs.data.source_provider,'combined');assert.deepEqual(jobs.data.sources.map((source:any)=>source.provider),['linkedin','web_search']);
      assert.ok(f.calls.some(row=>row.url.includes('/realtime-linkedin-data/search')));assert.ok(f.calls.some(row=>row.body.tools?.[0]?.type==='web_search_preview'));
      await request('/services/setAiConsent',{enabled:false},cookie);
    });
    await t.test('imports banks with duplicate-safe retry, keeps cursor on failure, isolates owners and secrets',async()=>{
      assert.equal((await request('/services/plaidExchangeToken',{public_token:'public-sandbox-fixture'},cookie)).status,200);
      await db.transaction(tx=>tx.query('INSERT INTO service_leases(lease_key,token,expires_at) VALUES($1,$2,$3)',['bank:'+owner,'fixture-lock',Date.now()+10000]));
      assert.equal((await request('/services/plaidCreateLinkToken',{},cookie)).status,409);
      await db.transaction(tx=>tx.query('DELETE FROM service_leases WHERE lease_key=$1',['bank:'+owner]));
      const items=await request('/records/PlaidItem/query',{},cookie);assert.equal(items.data.items.length,1);
      assert.doesNotMatch(JSON.stringify(items),/access_token|sync_cursor|access-sandbox/);
      assert.equal((await request('/services/plaidCreateLinkToken',{item_id:'fixture-item'},other)).status,404);
      let sync=await request('/services/plaidSync',{},cookie);assert.equal(sync.data.results[0].status,'synced',JSON.stringify(sync));
      sync=await request('/services/plaidSync',{},cookie);assert.equal(sync.data.results[0].status,'synced');
      let rows=await request('/records/Transaction/query',{query:{source:'Plaid Sandbox'}},cookie);assert.equal(rows.data.items.length,1);assert.equal(rows.data.items[0].amount,12);
      const encrypted=await db.transaction(tx=>tx.query('SELECT ciphertext FROM private_data WHERE owner_id=$1',[owner]));
      assert.ok(encrypted.length);assert.doesNotMatch(JSON.stringify(encrypted),/access-sandbox-fixture-private|fixture-cursor/);
      f.state.failSync=true;const failed=await request('/services/plaidSync',{},cookie);assert.equal(failed.data.results[0].status,'error');
      const privateRow=(await new PrivateVault(db,new SecretBox(Buffer.from(env.AVERA_VAULT_KEY,'base64'))).list(owner,'PlaidCredential'))[0];assert.equal(privateRow.sync_cursor,'fixture-cursor-0');
      f.state.failSync=false;f.state.revision=1;await request('/services/plaidSync',{},cookie);
      rows=await request('/records/Transaction/query',{query:{source:'Plaid Sandbox'}},cookie);assert.equal(rows.data.items.length,1);assert.equal(rows.data.items[0].amount,13);
      assert.equal((await request('/services/plaidDisconnect',{item_id:'fixture-item'},cookie)).status,200);
      assert.equal((await request('/records/Account/query',{},cookie)).data.items.length,0);
    });
    await t.test('resume processing requires consent and retries failed private provider file deletion',async()=>{
      const pdf=Buffer.from('%PDF-1.7\nfixture\n%%EOF');
      const input={file_name:'resume.pdf',file_base64:pdf.toString('base64'),consent:true};
      assert.equal((await request('/services/parseResume',{...input,consent:false},cookie)).status,400);
      assert.equal((await request('/services/parseResume',{...input,file_uri:'https://example.test/other'},cookie)).status,400);
      f.state.deleteFails=true;const parsed=await request('/services/parseResume',input,cookie);assert.equal(parsed.status,200,JSON.stringify(parsed));
      const vault=new PrivateVault(db,new SecretBox(Buffer.from(env.AVERA_VAULT_KEY,'base64')));
      assert.equal((await vault.list(owner,'PendingFileDeletion')).length,1);
      f.state.deleteFails=false;await request('/services/parseResume',{file_name:'resume.txt',file_base64:Buffer.from('Skills: cooking').toString('base64'),consent:true},cookie);
      assert.equal((await vault.list(owner,'PendingFileDeletion')).length,0);
    });
    await t.test('bounded fixed-provider networking rejects arbitrary URLs and quotas persist',async()=>{
      const direct=directTransport(env,new PrivateVault(db,new SecretBox(Buffer.alloc(32))),f.fetcher);
      await assert.rejects(direct.invoke(owner,'jobs.fetch',{url:'http://127.0.0.1/private'}));
      await direct.invoke(owner,'jobs.fetch',{url:'https://api.openwebninja.com/realtime-linkedin-data/search?query=cook'});
      await direct.invoke(owner,'jobs.fetch',{url:'https://photon.komoot.io/api/?q=Boston'});
      await claimQuota(db,owner,'fixture-quota',1);await assert.rejects(claimQuota(db,owner,'fixture-quota',1),/limit reached/);
      await assert.rejects(fetchJson(async()=>new Response('x'.repeat(100)), 'https://fixture.test',{},20));
      await assert.rejects(fetchJson(async()=>{throw new Error('private-provider-detail');},'https://fixture.test'),error=>!String(error).includes('private-provider-detail'));
    });
    await t.test('Google OIDC enforces state, signature, nonce, verified email and one-time callback',async()=>{
      const begin=await fetch(runtime.url+'/api/v1/auth/google/start?returnTo=%2FSettings',{redirect:'manual'});
      assert.equal(begin.status,302);const location=new URL(begin.headers.get('location')!);const state=location.searchParams.get('state')!;
      const stateCookie=begin.headers.get('set-cookie')!.split(';')[0];
      f.state.oauthClaims={iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,exp:Math.floor(Date.now()/1000)+300,iat:Math.floor(Date.now()/1000),nonce:location.searchParams.get('nonce'),email_verified:true,email:randomUUID()+'@example.test',sub:randomUUID(),name:'Fixture Google'};
      const callback=runtime.url+'/api/v1/auth/google/callback?state='+state+'&code=fixture';
      assert.equal((await fetch(callback,{redirect:'manual'})).status,400);
      const result=await fetch(callback,{headers:{Cookie:stateCookie},redirect:'manual'});assert.equal(result.status,302);assert.equal(result.headers.get('location'),'/Settings');
      assert.equal((await fetch(callback,{headers:{Cookie:stateCookie},redirect:'manual'})).status,400);
      const googleCookie=result.headers.get('set-cookie')!.split(';')[0];assert.equal((await request('/auth/me',undefined,googleCookie)).status,200);
      assert.equal((await request('/auth/login',{email:f.state.oauthClaims.email,password})).status,401);
    });
    await t.test('rejects Google nonce/verification failures and refuses unverified local-account linking',async()=>{
      async function attempt(overrides:any){
        const begin=await fetch(runtime.url+'/api/v1/auth/google/start',{redirect:'manual'}),location=new URL(begin.headers.get('location')!);
        f.state.oauthClaims={iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,exp:Math.floor(Date.now()/1000)+300,iat:Math.floor(Date.now()/1000),nonce:location.searchParams.get('nonce'),email_verified:true,email:randomUUID()+'@example.test',sub:randomUUID(),...overrides};
        return fetch(runtime.url+'/api/v1/auth/google/callback?code=fixture&state='+location.searchParams.get('state'),{headers:{Cookie:begin.headers.get('set-cookie')!.split(';')[0]},redirect:'manual'});
      }
      assert.equal((await attempt({nonce:'wrong'})).status,401);
      assert.equal((await attempt({email_verified:false})).status,401);
      assert.equal((await attempt({email})).status,409);
    });
    await t.test('mail completion cannot delete a newer queued reset',async()=>{
      const vault=new PrivateVault(db,new SecretBox(Buffer.from(env.AVERA_VAULT_KEY,'base64')));
      const id=await vault.put(owner,'AccountMail','fixture-race',{version:'old',input:{},expires_at:0});
      await vault.put(owner,'AccountMail','fixture-race',{version:'new',input:{},expires_at:0});
      await vault.removeVersion(owner,'AccountMail',id,'old');
      assert.equal((await vault.list(owner,'AccountMail'))[0].version,'new');
      await vault.removeVersion(owner,'AccountMail',id,'new');
      assert.equal((await vault.list(owner,'AccountMail')).length,0);
    });
    await t.test('verification and one-use reset invalidate old sessions without email enumeration',async()=>{
      await runtime.close();runtime=await startLocalServer({db:dialect==='sqlite'?sqliteDatabase(join(dir,'records.sqlite')):postgresDatabase(process.env.AVERA_TEST_POSTGRES_URL!),port:0,env:{...env,AVERA_AUTH_EMAIL:'true'},fetcher:f.fetcher});
      const pending=randomUUID()+'@example.test';let created=await request('/auth/register',{email:pending,password});assert.equal(created.data.requires_verification,true);assert.equal(created.cookie,'');
      assert.equal((await request('/auth/verify',{email:pending,otpCode:'000000'})).status,400);
      const code=f.mails.findLast(row=>row.to[0]===pending).text.match(/\b\d{6}\b/)[0];
      const verified=await request('/auth/verify',{email:pending,otpCode:code});assert.equal(verified.status,200);
      assert.equal((await request('/auth/verify',{email:pending,otpCode:code})).status,400);
      assert.deepEqual((await request('/auth/request-reset',{email:pending})).data,(await request('/auth/request-reset',{email:randomUUID()+'@example.test'})).data);
      const resetToken=new URL(f.mails.findLast(row=>row.subject==='Reset your Avera password').text.match(/http[^\s]+/)[0]).searchParams.get('token');
      const changed='replacement-fixture-password';assert.equal((await request('/auth/reset',{resetToken,newPassword:changed})).status,200);
      assert.equal((await request('/auth/reset',{resetToken,newPassword:changed})).status,400);
      assert.equal((await request('/auth/me',undefined,verified.cookie)).status,401);
      assert.equal((await request('/auth/login',{email:pending,password:changed})).status,200);
      assert.equal((await request('/auth/login',{email:pending,password})).status,401);
    });
  });
}

test('version 1 migration preserves existing users, sessions and finances',async()=>{
 const db=sqliteDatabase(':memory:');await migrate(db,1);
 await db.transaction(async tx=>{await tx.query("INSERT INTO users VALUES('user','fixture@example.test','hash','Name','fixture')");await tx.query("INSERT INTO records(collection,id,owner_id,body,created_at,updated_at) VALUES('Account','record','user',$1,'fixture','fixture')",[JSON.stringify({name:'Preserved',balance:25})]);});
 await migrate(db);const rows=await db.transaction(tx=>tx.query('SELECT * FROM records'));assert.equal(JSON.parse(rows[0].body).balance,25);await db.close();
});
test('Plaid mutation during pagination restarts from original cursor',async()=>{
 const cursors:string[]=[];let count=0;
 const result=await collectChanges('access-sandbox-fixture','original',{plaid:{request:async(_path:any,body:any)=>{cursors.push(body.cursor);if(++count===2)throw new PlaidFailure('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION');return {added:[],modified:[],removed:[],next_cursor:'next',has_more:count===1};}}});
 assert.deepEqual(cursors,['original','next','original']);assert.equal(result.cursor,'next');
});

test('gateway grants isolate local accounts and replace bank secrets with owner-bound handles',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'avera-gateway-'));const f=fixture(),token=randomBytes(32).toString('base64url');
 const tokenB=randomBytes(32).toString('base64url');const grants=join(dir,'grants.json');await writeFile(grants,JSON.stringify([{id:'fixture-installation',token},{id:'fixture-installation-two',token:tokenB}]));
 const gateway=await startLocalServer({db:sqliteDatabase(join(dir,'gateway.sqlite')),port:0,gatewayOnly:true,env:{AVERA_GATEWAY_GRANTS_FILE:grants,AVERA_VAULT_KEY:randomBytes(32).toString('base64'),PLAID_CLIENT_ID:'fixture',PLAID_SECRET:'fixture',OPENAI_API_KEY:'fixture'},fetcher:f.fetcher});
 t.after(async()=>{await gateway.close();await rm(dir,{recursive:true,force:true});});
 const call=async(actor:string,operation:string,input:any,bearer=token)=>{const res=await fetch(gateway.url+'/gateway/v1/invoke',{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify({actor,operation,input})});return {status:res.status,data:await res.json()};};
 assert.equal((await fetch(gateway.url+'/api/v1/auth/me')).status,404);
 assert.equal((await call('one','capabilities',{},'bad')).status,401);
 const exchanged=await call('one','plaid',{path:'/item/public_token/exchange',body:{public_token:'public-sandbox-fixture'}});assert.equal(exchanged.status,200);const handle=exchanged.data.result.access_token;assert.match(handle,/^access-sandbox-gateway-/);assert.doesNotMatch(JSON.stringify(exchanged),/fixture-private/);
 assert.equal((await call('one','plaid',{path:'/accounts/get',body:{access_token:handle}},tokenB)).status,404);
 assert.equal((await call('two','plaid',{path:'/accounts/get',body:{access_token:handle}})).status,404);
 assert.equal((await call('one','plaid',{path:'/accounts/get',body:{access_token:handle}})).status,200);
 assert.equal((await call('one','plaid',{path:'/accounts/get',body:{access_token:'access-sandbox-fixture-private'}})).status,404);
 const local=await startLocalServer({db:sqliteDatabase(join(dir,'local.sqlite')),port:0,env:{AVERA_GATEWAY_URL:gateway.url,AVERA_GATEWAY_TOKEN:token,AVERA_VAULT_KEY:randomBytes(32).toString('base64')}});t.after(()=>local.close());
 const signup=await fetch(local.url+'/api/v1/auth/register',{method:'POST',headers:{Origin:local.url,'Content-Type':'application/json'},body:JSON.stringify({email:'local@example.test',password:'fixture-password-only'})});const cookie=signup.headers.get('set-cookie')!.split(';')[0];
 const status=await fetch(local.url+'/api/v1/services/getIntegrationStatus',{method:'POST',headers:{Origin:local.url,'Content-Type':'application/json',Cookie:cookie},body:'{}'});const body=await status.json();assert.equal(body.mode,'gateway');assert.equal(body.plaid,true);
 const offline=await startLocalServer({db:sqliteDatabase(':memory:'),port:0,env:{AVERA_VAULT_KEY:randomBytes(32).toString('base64')}});await offline.close();
});
