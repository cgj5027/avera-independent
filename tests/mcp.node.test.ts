import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { sqliteDatabase,postgresDatabase } from '../server/database.ts';
import { startLocalServer } from '../server/http.ts';
import { encryptArchive } from '../server/recovery/archive.ts';
import { unpackInstallation } from '../server/recovery/installation.ts';
import { McpService } from '../server/mcp.ts';
import { auth as oauthClient } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const digest=(value:string)=>createHash('sha256').update(value).digest('base64url');
for(const kind of ['sqlite','postgres'] as const)test(`${kind}: independent OAuth and MCP ownership/security`,{skip:kind==='postgres'&&!process.env.AVERA_TEST_POSTGRES_URL},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'avera-mcp-'));
 const runtime=await startLocalServer({db:kind==='sqlite'?sqliteDatabase(join(dir,'records.sqlite')):postgresDatabase(process.env.AVERA_TEST_POSTGRES_URL!),port:0,env:{AVERA_MCP_ENABLED:'true',AVERA_VAULT_KEY_PATH:join(dir,'vault.key')},recoveryOptions:{directory:join(dir,'backups'),keyPath:join(dir,'backup.key'),schedule:false}});
 t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
 const service=runtime.mcp!,db=runtime.store.db;
 async function request(path:string,data?:any,cookie='',extra:Record<string,string>={}){const response=await fetch(runtime.url+path,{method:data===undefined?'GET':'POST',redirect:'manual',headers:{Origin:runtime.url,'Content-Type':'application/json',Cookie:cookie,...extra},body:data===undefined?undefined:JSON.stringify(data)});const text=await response.text();return {status:response.status,headers:response.headers,body:text?JSON.parse(text):null,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};}
 const register=async()=>request('/api/v1/auth/register',{email:randomUUID()+'@example.test',password:'fixture-mcp-password'});
 const signed=await register(),other=await register(),owner=(await request('/api/v1/auth/me',undefined,signed.cookie)).body,foreign=(await request('/api/v1/auth/me',undefined,other.cookie)).body;
 const client=await service.register({client_name:'Fixture AI client',redirect_uris:['http://127.0.0.1:49877/callback'],token_endpoint_auth_method:'none'});
 async function begin(){const verifier=randomBytes(32).toString('base64url'),params=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',scope:'avera:read',state:'fixture-state',code_challenge:digest(verifier),code_challenge_method:'S256',resource:runtime.url+'/mcp'});const url=await service.authorize(params);return {verifier,params,handle:new URL(url).searchParams.get('ctx')!};}
 async function approve(){const flow=await begin();await service.info(flow.handle,owner);const grant=await service.respond(flow.handle,'approve',owner);return {...flow,code:new URL(grant.redirect_url).searchParams.get('code')!};}
 function exchange(flow:any){return {client_id:client.client_id,grant_type:'authorization_code',code:flow.code,code_verifier:flow.verifier,redirect_uri:client.redirect_uris[0],resource:runtime.url+'/mcp'};}
 await t.test('discovery, registration, consent sign-in and redirect validation use the independent server',async()=>{
  const protectedInfo=await request('/.well-known/oauth-protected-resource/mcp');assert.equal(protectedInfo.body.resource,runtime.url+'/mcp');const meta=await request('/.well-known/oauth-authorization-server');assert.deepEqual(meta.body.code_challenge_methods_supported,['S256']);
  const fresh=await request('/oauth/register',{client_name:'Registered test client',redirect_uris:['https://client.example/callback']});assert.equal(fresh.status,201);assert(!fresh.body.client_secret);
  await assert.rejects(service.register({client_name:'Bad client',redirect_uris:['javascript:alert(1)']}));await assert.rejects(service.register({client_name:'Bad client',redirect_uris:['https://user:pass@client.example/callback']}));
  await assert.rejects(service.register({client_name:'Encoded callback fixture',redirect_uris:['http://127.0.0.1:49877/%61pi/v1/callback']}));
  const rootClient=await service.register({client_name:'Root callback fixture',redirect_uris:['https://client.example']});const rootVerifier=randomBytes(32).toString('base64url');const rootUrl=await service.authorize(new URLSearchParams({client_id:rootClient.client_id,redirect_uri:'https://client.example',response_type:'code',scope:'avera:read',state:'fixture',code_challenge:digest(rootVerifier),code_challenge_method:'S256',resource:runtime.url+'/mcp'}));const rootHandle=new URL(rootUrl).searchParams.get('ctx')!;await service.info(rootHandle,owner);const approvedRoot=await service.respond(rootHandle,'approve',owner);const rootTokens=await service.exchange({client_id:rootClient.client_id,grant_type:'authorization_code',code:new URL(approvedRoot.redirect_url).searchParams.get('code')!,code_verifier:rootVerifier,redirect_uri:'https://client.example',resource:runtime.url+'/mcp'});assert(rootTokens.access_token);
  const flow=await begin(),wrong=new URLSearchParams(flow.params);wrong.set('redirect_uri','https://unregistered.example/');await assert.rejects(service.authorize(wrong));wrong.set('redirect_uri',client.redirect_uris[0]);wrong.set('code_challenge_method','plain');await assert.rejects(service.authorize(wrong));
  const anonymous=await request('/api/v1/mcp/consent-info?handle='+flow.handle);assert.equal(anonymous.body.authenticated,false);assert(!anonymous.body.tools);
  const info=await request('/api/v1/mcp/consent-info?handle='+flow.handle,undefined,signed.cookie);assert.equal(info.body.authenticated,true);assert.equal(info.body.tools.length,2);assert.equal(info.body.account_email,owner.email);
  await assert.rejects(service.info(flow.handle,foreign));assert.equal((await request('/api/v1/mcp/authorize-grant',{ctx:flow.handle,action:'approve'},other.cookie)).status,403);
  const denied=await service.respond(flow.handle,'deny',owner);assert.equal(new URL(denied.redirect_url).searchParams.get('error'),'access_denied');await assert.rejects(service.respond(flow.handle,'approve',owner));
 });
 await t.test('PKCE, resource binding and code reuse cannot create unauthorized tokens',async()=>{
  const flow=await approve(),input=exchange(flow);await assert.rejects(service.exchange({...input,client_id:randomBytes(32).toString('base64url')}),error=>error.code==='invalid_client');await assert.rejects(service.exchange({...input,code_verifier:randomBytes(32).toString('base64url')}));await assert.rejects(service.exchange({...input,resource:'https://another.example/mcp'}));
  const tokens=await service.exchange(input);assert.equal((await service.authenticate('Bearer '+tokens.access_token)).owner_id,owner.id);
  await assert.rejects(service.exchange(input));await assert.rejects(service.authenticate('Bearer '+tokens.access_token));
  const expired=await begin();await db.transaction(tx=>tx.query('UPDATE mcp_requests SET expires_at=0 WHERE handle_hash=$1',[digest(expired.handle)]));await assert.rejects(service.info(expired.handle,owner));
 });
 await t.test('official MCP client reads personal records and cannot access samples, another owner or credentials',async()=>{
  const own=await runtime.store.create(owner.id,'Bill',{name:'Owned fixture bill',amount:123.45}),hidden=await runtime.store.create(owner.id,'Bill',{name:'Sample fixture bill',amount:10,demo_profile:'early_career'}),theirs=await runtime.store.create(foreign.id,'Bill',{name:'Foreign fixture bill',amount:999});
  await db.transaction(tx=>tx.query('INSERT INTO private_data(owner_id,collection,natural_key,id,ciphertext) VALUES($1,$2,$3,$4,$5)',[owner.id,'FixtureCredential','fixture',randomUUID(),'NEVER-EXPOSE-THIS']));
  const flow=await approve(),tokens=await service.exchange(exchange(flow));
  const sdk=new Client({name:'Avera interop test',version:'1.0.0'});
  try{
   await sdk.connect(new StreamableHTTPClientTransport(new URL(runtime.url+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}}}));
   const listed=await sdk.listTools();assert.equal(listed.tools.length,2);const result=await sdk.callTool({name:'avera_list_records',arguments:{collection:'Bill'}});const text=JSON.stringify(result);assert(text.includes('Owned fixture bill'));assert(!text.includes('Sample fixture bill'));assert(!text.includes('Foreign fixture bill'));assert(!text.includes('NEVER-EXPOSE-THIS'));
   assert.equal((await sdk.callTool({name:'avera_get_record',arguments:{collection:'Bill',id:own.id}})).isError,false);
   assert.equal((await sdk.callTool({name:'avera_get_record',arguments:{collection:'Bill',id:theirs.id}})).isError,true);assert.equal((await sdk.callTool({name:'avera_get_record',arguments:{collection:'Bill',id:hidden.id}})).isError,true);
   await assert.rejects(sdk.callTool({name:'avera_list_records',arguments:{collection:'PlaidCredential'}}));
  }finally{await sdk.close();}
  const cannotWrite=await request('/api/v1/records/Bill',{name:'Unauthorized write fixture',amount:50},'',{Authorization:'Bearer '+tokens.access_token});assert.equal(cannotWrite.status,401);
  const missing=await request('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},signed.cookie);assert.equal(missing.status,401);assert(missing.headers.get('www-authenticate')?.includes('oauth-protected-resource/mcp'));
  const hostile=await request('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},'',{Origin:'https://untrusted.example',Authorization:'Bearer '+tokens.access_token});assert.equal(hostile.status,403);
  const bad=await service.rpc(owner.id,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'avera_list_records',arguments:{collection:'Bill',owner_id:foreign.id}}});assert('error' in bad!);
  const grants=await service.grants(owner.id);await assert.rejects(service.revoke(foreign.id,grants.grants.at(-1)!.id));
 });
 await t.test('rotating refresh tokens revoke the grant on replay; owner revocation blocks all access',async()=>{
  const flow=await approve(),first=await service.exchange(exchange(flow));const input={client_id:client.client_id,grant_type:'refresh_token',refresh_token:first.refresh_token,resource:runtime.url+'/mcp'};
  const second=await service.exchange(input);assert.notEqual(second.refresh_token,first.refresh_token);await assert.rejects(service.exchange(input));await assert.rejects(service.authenticate('Bearer '+second.access_token));
  const another=await service.exchange(exchange(await approve()));const grants=await service.grants(owner.id);await service.revoke(owner.id,grants.grants[0].id);await assert.rejects(service.authenticate('Bearer '+another.access_token));
 });
 await t.test('official OAuth client discovers, registers, uses PKCE and exchanges the approved code',async()=>{
  let information:any,tokens:any,verifier='',authorization:URL|undefined;const state=randomBytes(16).toString('hex');
  const provider={redirectUrl:'http://127.0.0.1:49878/callback',clientMetadata:{client_name:'Official OAuth test client',redirect_uris:['http://127.0.0.1:49878/callback'],token_endpoint_auth_method:'none' as const,grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'avera:read'},state:()=>state,clientInformation:()=>information,saveClientInformation:(value:any)=>{information=value;},tokens:()=>tokens,saveTokens:(value:any)=>{tokens=value;},redirectToAuthorization:(url:URL)=>{authorization=url;},saveCodeVerifier:(value:string)=>{verifier=value;},codeVerifier:()=>verifier};
  assert.equal(await oauthClient(provider,{serverUrl:runtime.url+'/mcp',scope:'avera:read'}),'REDIRECT');assert(authorization);
  const response=await fetch(authorization,{redirect:'manual'});assert.equal(response.status,302);const handle=new URL(response.headers.get('location')!).searchParams.get('ctx')!;
  assert.equal((await request('/api/v1/mcp/consent-info?handle='+handle,undefined,signed.cookie)).status,200);const approved=await request('/api/v1/mcp/authorize-grant',{ctx:handle,action:'approve'},signed.cookie);const callback=new URL(approved.body.redirect_url);assert.equal(callback.searchParams.get('state'),state);
  assert.equal(await oauthClient(provider,{serverUrl:runtime.url+'/mcp',scope:'avera:read',authorizationCode:callback.searchParams.get('code')!}),'AUTHORIZED');assert(tokens.access_token);assert.equal((await service.authenticate('Bearer '+tokens.access_token)).owner_id,owner.id);
  await assert.rejects(new McpService(runtime.store,()=> 'https://different.example').authenticate('Bearer '+tokens.access_token));
 });
 if(kind==='sqlite')await t.test('staged full-installation recovery invalidates old MCP grants and consent handles',async()=>{
  const tokens=await service.exchange(exchange(await approve()));const flow=await begin();await service.info(flow.handle,owner);const file=join(dir,'installation.sqlite');await db.snapshot!(file);
  const staged=join(dir,'staged');const bytes=await encryptArchive({format:'avera-installation-sqlite',version:1,schema_version:5,files:[],database_base64:(await readFile(file)).toString('base64')},'fixture-installation-recovery');await unpackInstallation(bytes,'fixture-installation-recovery',staged);
  const restored=sqliteDatabase(join(staged,'records.sqlite'));try{const grants=await restored.transaction(tx=>tx.query('SELECT revoked FROM mcp_grants'));assert(grants.length);assert(grants.every(g=>g.revoked===1));const requests=await restored.transaction(tx=>tx.query('SELECT used FROM mcp_requests'));assert(requests.every(r=>r.used===1));}finally{await restored.close();}assert((await service.authenticate('Bearer '+tokens.access_token)).owner_id===owner.id);
 });
 await t.test('form token exchange, CSRF, guest exclusion and restore revoke independent MCP grants',async()=>{
  const flow=await approve();const response=await fetch(runtime.url+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(exchange(flow))});assert.equal(response.status,200);const access=await response.json();assert(access.access_token);
  const form=await fetch(runtime.url+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...exchange(flow),code:'not-a-code'})});assert.equal((await form.json()).error,'invalid_grant');
  const csrf=await request('/api/v1/mcp/revoke',{grant_id:'fixture'},signed.cookie,{Origin:'https://untrusted.example'});assert.equal(csrf.status,403);
  const guest=await request('/api/v1/auth/sample',{});const guestFlow=await begin();assert.equal((await service.info(guestFlow.handle,{id:'guest',is_sample:true})).authenticated,false);assert.equal((await request('/api/v1/mcp/authorize-grant',{ctx:guestFlow.handle,action:'approve'},guest.cookie)).status,403);
  const pendingRestore=await begin();await service.info(pendingRestore.handle,owner);
  const backup=await runtime.recovery!.export(owner.id,'fixture-restoration-passphrase');const input={archive_base64:backup.archive_base64,passphrase:'fixture-restoration-passphrase'};const review=await runtime.recovery!.preview(owner.id,input);await runtime.recovery!.apply(owner.id,{...input,preview_token:review.preview_token,confirmation:'RESTORE'});await assert.rejects(service.authenticate('Bearer '+access.access_token));await assert.rejects(service.info(pendingRestore.handle,owner));
  const newTokens=await service.exchange(exchange(await approve()));const pendingReset=await begin();await service.info(pendingReset.handle,owner);const reset=randomBytes(32).toString('base64url');await db.transaction(tx=>tx.query('INSERT INTO auth_challenges(token_hash,kind,user_id,payload,expires_at) VALUES($1,$2,$3,$4,$5)',[createHash('sha256').update(reset).digest('hex'),'reset',owner.id,'{}',Date.now()+60000]));await runtime.auth.reset({resetToken:reset,newPassword:'fixture-reset-password'});await assert.rejects(service.authenticate('Bearer '+newTokens.access_token));await assert.rejects(service.info(pendingReset.handle,owner));
  const stored=await db.transaction(tx=>tx.query('SELECT token_hash FROM mcp_tokens'));assert(stored.length>0);assert(!JSON.stringify(stored).includes(access.access_token));
 });
});
