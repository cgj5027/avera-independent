import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { startLocalServer } from '../server/http.ts';
import { sqliteDatabase } from '../server/database.ts';
test('independent dev UI proxies its own writes while preserving hostile Origin rejection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'avera-dev-proxy-'));const backend=await startLocalServer({db:sqliteDatabase(join(dir,'records.sqlite')),port:0});let dev:Awaited<ReturnType<typeof createServer>>|undefined;
 const before=process.env.AVERA_DEV_BACKEND_URL;process.env.AVERA_DEV_BACKEND_URL=backend.url;
 try{
  dev=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0}});await dev.listen();const address=dev.httpServer!.address();assert(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
  async function post(path:string,data:any,cookie='',requestOrigin=origin){return fetch(origin+'/api/v1'+path,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});}
  const signed=await post('/auth/register',{email:randomUUID()+'@example.test',password:'fixture-dev-password'});assert.equal(signed.status,200);const cookie=signed.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const bill=await post('/records/Bill',{name:'Dev fixture bill',amount:25},cookie);assert.equal(bill.status,201);
  const hostile=await post('/records/Bill',{name:'Forged fixture bill',amount:99},cookie,'https://untrusted.example');assert.equal(hostile.status,403);
  const listed=await post('/records/Bill/query',{query:{}},cookie);assert.equal((await listed.json()).items.length,1);
  const html=await fetch(origin+'/settings');assert.equal(html.status,200);assert((await html.text()).includes('/@vite/client'));
 }finally{await dev?.close();await backend.close();if(before===undefined)delete process.env.AVERA_DEV_BACKEND_URL;else process.env.AVERA_DEV_BACKEND_URL=before;await rm(dir,{recursive:true,force:true});}
});
