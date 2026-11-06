import { createHash,randomUUID,timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ApiError,invalid,missing } from '../errors.ts';
import { fetchJson } from './network.ts';
import type { Transport } from './providers.ts';
import type { PrivateVault } from './vault.ts';
import type { Database } from '../database.ts';
import { claimQuota } from './quota.ts';
import { PlaidFailure } from './logic/plaid.js';
export type GatewayGrant={id:string;token:string};
export function loadGrants(path:string):GatewayGrant[]{
  const rows=JSON.parse(readFileSync(path,'utf8'));
  if(!Array.isArray(rows)||!rows.length||rows.length>1000||new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>!row||!/^[a-zA-Z0-9-]{1,80}$/.test(row.id)||typeof row.token!=='string'||!/^[a-zA-Z0-9_-]{43,128}$/.test(row.token)))throw new Error('Invalid gateway grant file.');
  return rows;
}
export function gatewayClient(url:string|null,token:string|undefined,fetcher:typeof fetch=fetch):Transport{
  return {async invoke(actor,operation,input){
    if(!url||!token)throw new ApiError(503,'INTEGRATIONS_UNAVAILABLE','Connect this installation to the Avera gateway in server settings.');
    const data=await fetchJson(fetcher,url+'/gateway/v1/invoke',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({actor,operation,input})},8*1024*1024,90000);
    if(data.error){if(data.plaid_code)throw new PlaidFailure(data.plaid_code);throw new ApiError(data.status??503,data.code??'PROVIDER_UNAVAILABLE',data.error);}return data.result;
  }};
}
export function gatewayHandler(db:Database,transport:Transport,vault:PrivateVault,grants:GatewayGrant[]){
  return async(authorization:string|undefined,body:any)=>{
    const supplied=createHash('sha256').update(authorization??'').digest();
    const grant=grants.find(row=>timingSafeEqual(supplied,createHash('sha256').update('Bearer '+row.token).digest()));
    if(!grant)throw new ApiError(401,'AUTH_REQUIRED','Invalid installation grant.');
    if(typeof body.actor!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(body.actor))invalid('Invalid local account.');
    if(!['capabilities','ai','resume','plaid','jobs.fetch','mail'].includes(body.operation))invalid('Unknown gateway operation.');
    const actor=createHash('sha256').update(grant.id+'\0'+body.actor).digest('hex');
    await claimQuota(db,grant.id,'gateway',100,60000);await claimQuota(db,grant.id,'gateway',2000,86400000);
    let input=structuredClone(body.input??{});
    if(body.operation==='plaid'){
      input.body??={};
      if(input.body.access_token){
        const entries=await vault.list(actor,'GatewayPlaid');
        const stored=entries.find(row=>row.handle===input.body.access_token)??missing();
        input.body.access_token=stored.access_token;
      }
    }
    try{
      const result=await transport.invoke(actor,body.operation,input);
      if(body.operation==='plaid'&&result.access_token){
        const handle='access-sandbox-gateway-'+randomUUID();
        await vault.put(actor,'GatewayPlaid',handle,{handle,access_token:result.access_token});
        return {result:{...result,access_token:handle}};
      }
      if(body.operation==='plaid'&&input.path==='/item/remove'){
        const entries=await vault.list(actor,'GatewayPlaid');for(const entry of entries)if(entry.handle===body.input.body.access_token)await vault.remove(actor,'GatewayPlaid',entry.id);
      }
      return {result};
    }catch(error){if(error instanceof PlaidFailure)return {error:'Bank provider unavailable.',plaid_code:error.code};throw error;}
  };
}
