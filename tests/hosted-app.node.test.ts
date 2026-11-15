import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,rm,stat,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { randomBytes,randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostedApplicationConfig } from '../server/hosted-config.ts';
import { startLocalServer } from '../server/http.ts';
import { sqliteDatabase,postgresDatabase } from '../server/database.ts';
const run=promisify(execFile);
const fixture=(home:string)=>({AVERA_DATA_STORE:'postgres',AVERA_DATABASE_URL:'postgresql://avera@127.0.0.1/avera',AVERA_HOSTED_DATA_DIR:home,AVERA_VAULT_KEY:randomBytes(32).toString('base64'),AVERA_GATEWAY_URL:'https://gateway.example',AVERA_GATEWAY_TOKEN:randomBytes(32).toString('base64url'),RENDER_EXTERNAL_URL:'https://avera-web.onrender.com',RENDER_EXTERNAL_HOSTNAME:'avera-web.onrender.com',PORT:'10000'});
test('hosted configuration requires PostgreSQL, HTTPS, persistent paths and private backend keys',()=>{
 const base=fixture(resolve('/tmp/hosted-fixture')),parsed=hostedApplicationConfig(base);assert.equal(parsed.network.host,'0.0.0.0');assert.equal(parsed.network.port,10000);assert.equal(parsed.network.publicOrigin,base.RENDER_EXTERNAL_URL);assert.equal(parsed.config.synchronization,false);assert(parsed.recovery.keyPath.endsWith('backup.key'));
 assert.equal(hostedApplicationConfig({...base,AVERA_PUBLIC_ORIGIN:'https://avera.run',AVERA_PORT:'4175'}).network.publicOrigin,'https://avera.run');assert.equal(hostedApplicationConfig({...base,AVERA_PORT:'4175'}).network.port,10000);
 for(const bad of [{AVERA_DATA_STORE:'sqlite'},{AVERA_DATABASE_URL:'https://invalid.example'},{AVERA_HOSTED_DATA_DIR:'data'},{AVERA_VAULT_KEY:'invalid'},{AVERA_GATEWAY_TOKEN:'invalid'},{AVERA_GATEWAY_URL:'http://gateway.example'},{AVERA_PUBLIC_ORIGIN:'http://avera.run'},{AVERA_PUBLIC_ORIGIN:'https://avera.run/path'},{PORT:'$PORT'},{PORT:'0'},{PORT:'65536'},{AVERA_BACKUP_DIR:'relative'},{RENDER_EXTERNAL_HOSTNAME:'untrusted.example'},{AVERA_SYNC_ENABLED:'true'}])assert.throws(()=>hostedApplicationConfig({...base,...bad}));
});
test('hosted credential generation preserves current gateway grants without printing or overwriting secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'avera-hosted-secrets-')),current=[{id:randomUUID(),token:randomBytes(32).toString('base64url')}];
 try{const input=join(dir,'current.json'),out=join(dir,'private');await writeFile(input,JSON.stringify(current));const result=await run(process.execPath,['scripts/create-hosted-secrets.mjs',out,input],{cwd:resolve('.')});const merged=JSON.parse(await readFile(join(out,'gateway-grants.merged.json'),'utf8'));assert.deepEqual(merged[0],current[0]);assert.equal(merged.length,2);assert.notEqual(merged[1].token,current[0].token);const env=await readFile(join(out,'hosted-secrets.env'),'utf8');assert(!result.stdout.includes(merged[1].token));assert(env.includes(merged[1].token));assert.equal(Buffer.from(env.match(/AVERA_VAULT_KEY=(.*)/)![1],'base64').length,32);await assert.rejects(run(process.execPath,['scripts/create-hosted-secrets.mjs',out,input]));assert.equal(JSON.parse(await readFile(input,'utf8')).length,1);if(process.platform!=='win32')assert.equal((await stat(join(out,'hosted-secrets.env'))).mode&0o777,0o600);assert.equal((await readdir(out)).length,4);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('public application binding stays opt-in and requires canonical HTTPS',async()=>{
 const db=sqliteDatabase(':memory:');try{await assert.rejects(startLocalServer({db,host:'0.0.0.0',publicOrigin:'https://avera.run',port:0}));await assert.rejects(startLocalServer({db,host:'0.0.0.0',hostedApplication:true,publicOrigin:'http://avera.run',port:0}));await assert.rejects(startLocalServer({db,gatewayOnly:true,hostedApplication:true,publicOrigin:'https://avera.run',port:0}));}finally{await db.close();}
});
test('hosted app keeps health alias narrow, requires secure cookies and survives a PostgreSQL restart',{skip:!process.env.AVERA_TEST_POSTGRES_URL},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'avera-public-app-')),network={host:'0.0.0.0' as const,hostedApplication:true,port:0,publicOrigin:'https://avera.run',healthHost:'avera-web.onrender.com'};
 await writeFile(join(dir,'index.html'),'<!doctype html><title>Avera hosted fixture</title>');
 let runtime=await startLocalServer({db:postgresDatabase(process.env.AVERA_TEST_POSTGRES_URL!),...network,dist:dir});
 try{
  async function rawRequest(path:string,data?:unknown,cookie='',host='avera.run',origin='https://avera.run'):Promise<Response>{return new Promise((resolve,reject)=>{const request=httpRequest(runtime.url+path,{method:data===undefined?'GET':'POST',headers:{Host:host,Origin:origin,'Content-Type':'application/json',Cookie:cookie}},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>{const headers=new Headers();for(const [key,value] of Object.entries(response.headers))if(value)for(const entry of Array.isArray(value)?value:[value])headers.append(key,entry);resolve(new Response(body,{status:response.statusCode,headers}));});});request.on('error',reject);request.end(data===undefined?undefined:JSON.stringify(data));});}
  async function request(path:string,data?:unknown,cookie='',host='avera.run',origin='https://avera.run'){const response=await rawRequest(path,data,cookie,host,origin);return {response,data:await response.json()};}
  assert.equal((await request('/api/v1/health',undefined,'','avera-web.onrender.com')).response.status,200);assert.equal((await request('/api/v1/settings/public',undefined,'','avera-web.onrender.com')).response.status,421);assert.equal((await request('/api/v1/health',undefined,'','untrusted.example')).response.status,421);assert.equal((await request('/api/v1/health?probe=1',undefined,'','avera-web.onrender.com')).response.status,421);assert.equal((await request('/api/v1/health',{},'','avera-web.onrender.com')).response.status,421);
  const email=randomUUID()+'@example.test',password='fixture-hosted-password';const signed=await request('/api/v1/auth/register',{email,password});assert.equal(signed.response.status,200);const raw=signed.response.headers.get('set-cookie')!;assert(raw.includes('Secure'));assert(raw.includes('HttpOnly'));assert(raw.includes('Path=/api/v1'));const cookie=raw.split(';')[0];
  assert.equal((await request('/api/v1/records/Bill',{name:'Hosted fixture bill',amount:75},cookie)).response.status,201);assert.equal((await request('/api/v1/records/Bill',{name:'Forged fixture bill',amount:99},cookie,'avera.run','https://untrusted.example')).response.status,403);
  await runtime.close();runtime=await startLocalServer({db:postgresDatabase(process.env.AVERA_TEST_POSTGRES_URL!),...network,dist:dir});
  const login=await request('/api/v1/auth/login',{email,password});assert.equal(login.response.status,200);const remembered=login.response.headers.get('set-cookie')!.split(';')[0];const rows=await request('/api/v1/records/Bill/query',{query:{}},remembered);assert.equal(rows.data.items.length,1);assert.equal(rows.data.items[0].amount,75);
  const asset=await rawRequest('/settings');assert.equal(asset.status,200);assert(asset.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));assert((await asset.text()).includes('Avera'));
 }finally{await runtime.close();await rm(dir,{recursive:true,force:true});}
});
