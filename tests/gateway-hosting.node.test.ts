import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { gatewayNetwork } from '../server/gateway-config.ts';
import { sqliteDatabase } from '../server/database.ts';
import { startLocalServer } from '../server/http.ts';
test('gateway networking keeps local defaults and accepts Render routing explicitly',()=>{
  assert.deepEqual(gatewayNetwork({}),{host:'127.0.0.1',port:4175,publicOrigin:undefined,healthHost:undefined});
  const config=gatewayNetwork({AVERA_LISTEN_HOST:'0.0.0.0',PORT:'10000',RENDER_EXTERNAL_URL:'https://avera-gateway.onrender.com',RENDER_EXTERNAL_HOSTNAME:'avera-gateway.onrender.com'});
  assert.equal(config.host,'0.0.0.0');assert.equal(config.port,10000);
  assert.equal(gatewayNetwork({PORT:'10000',AVERA_PORT:'4176'}).port,4176);
  for(const env of [{AVERA_LISTEN_HOST:'0.0.0.0'},{PORT:''},{PORT:'1e3'},{PORT:'65536'},{AVERA_PUBLIC_ORIGIN:'http://example.test'},{RENDER_EXTERNAL_HOSTNAME:'attacker.example'}])assert.throws(()=>gatewayNetwork(env));
});
test('hosted health probes do not widen gateway host authorization',async()=>{
  const runtime=await startLocalServer({db:sqliteDatabase(':memory:'),gatewayOnly:true,host:'0.0.0.0',port:0,publicOrigin:'https://gateway.avera.run',healthHost:'avera-gateway.onrender.com'});
  try{
    const status=(path:string,host:string)=>new Promise<number>((resolve,reject)=>{request(runtime.url+path,{headers:{Host:host}},res=>{res.resume();resolve(res.statusCode!);}).on('error',reject).end();});
    assert.equal(await status('/api/v1/health','gateway.avera.run'),200);
    assert.equal(await status('/api/v1/health','avera-gateway.onrender.com'),200);
    assert.equal(await status('/api/v1/health','attacker.example'),421);
    assert.equal(await status('/gateway/v1/invoke','avera-gateway.onrender.com'),421);
    assert.equal(await status('/api/v1/auth/me','gateway.avera.run'),404);
  }finally{await runtime.close();}
});
