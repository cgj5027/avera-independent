import { randomUUID } from 'node:crypto';
import { dirname,join } from 'node:path';
import { validateResume } from './logic/resumeValidation.js';
import { RequestFailure } from './logic/requestSafety.js';
import type { Database } from '../database.ts';
import type { RecordStore } from '../store.ts';
import { ApiError,invalid } from '../errors.ts';
import { readServerConfig } from '../config.ts';
import { PrivateVault,loadSecretBox } from './vault.ts';
import { directTransport,type Transport } from './providers.ts';
import { gatewayClient,gatewayHandler,loadGrants } from './gateway.ts';
import { recordsFor,privateRecordsFor } from './facade.ts';
import { bindContext } from './context.js';
import { claimQuota } from './quota.ts';
import askAvera from './handlers/askAvera.js';
import suggestBills from './handlers/suggestBills.js';
import suggestCategories from './handlers/suggestCategories.js';
import searchJobOpportunities from './handlers/searchJobOpportunities.js';
import plaidCreateLinkToken from './handlers/plaidCreateLinkToken.js';
import plaidExchangeToken from './handlers/plaidExchangeToken.js';
import plaidSync from './handlers/plaidSync.js';
import plaidDisconnect from './handlers/plaidDisconnect.js';
import demoSandboxConnect from './handlers/demoSandboxConnect.js';
const handlers:Record<string,any>={askAvera,suggestBills,suggestCategories,searchJobOpportunities,plaidCreateLinkToken,plaidExchangeToken,plaidSync,plaidDisconnect,demoSandboxConnect};
export function integrationRuntime(db:Database,store:RecordStore,env:Record<string,string|undefined>,fetcher:typeof fetch=fetch){
  const config=readServerConfig(env);
  if(env.AVERA_AUTH_EMAIL!==undefined&&!['true','false'].includes(env.AVERA_AUTH_EMAIL))throw new Error('Invalid AVERA_AUTH_EMAIL.');
  if(!!env.GOOGLE_CLIENT_ID!==!!env.GOOGLE_CLIENT_SECRET)throw new Error('Configure both Google client credentials.');
  if(env.AVERA_AUTH_EMAIL==='true'&&(config.integrations.mode==='direct'?!(env.RESEND_API_KEY&&env.AVERA_EMAIL_FROM):!(config.integrations.gatewayUrl&&env.AVERA_GATEWAY_TOKEN)))throw new Error('Configure email transport before enabling account verification.');
  const vault=new PrivateVault(db,loadSecretBox(env,env.AVERA_VAULT_KEY_PATH??join(config.storage.driver==='sqlite'?dirname(config.storage.path!):'data','vault.key'),config.storage.driver==='postgres'));
  const direct=directTransport(env,vault,fetcher);
  const transport=config.integrations.mode==='direct'?direct:gatewayClient(config.integrations.gatewayUrl,env.AVERA_GATEWAY_TOKEN,fetcher);
  const gateway=env.AVERA_GATEWAY_GRANTS_FILE?gatewayHandler(db,direct,vault,loadGrants(env.AVERA_GATEWAY_GRANTS_FILE)):undefined;
  let maintenance:Promise<void>|undefined;
  async function drainMail(){
    const owners=await db.transaction(tx=>tx.query("SELECT DISTINCT owner_id FROM private_data WHERE collection='AccountMail'"));
    for(const row of owners)for(const mail of await vault.list(row.owner_id,'AccountMail')){
      try{if(mail.expires_at>Date.now())await transport.invoke(row.owner_id,'mail',mail.input);await vault.removeVersion(row.owner_id,'AccountMail',mail.id,mail.version);}catch{/* Keep encrypted mail for a later retry, until its challenge expires. */}
    }
  }
  const retry=()=>{if(!maintenance)maintenance=(async()=>{await direct.retryCleanup!();if(env.AVERA_AUTH_EMAIL==='true')await drainMail();})().catch(()=>{}).finally(()=>{maintenance=undefined;});};
  const timer=env.OPENAI_API_KEY||env.AVERA_AUTH_EMAIL==='true'?setInterval(retry,30000):undefined;timer?.unref();
  if(timer)retry();
  async function consent(owner:string){const rows=await db.transaction(tx=>tx.query('SELECT enabled FROM ai_consent WHERE owner_id=$1',[owner]));return rows[0]?.enabled===1;}
  return {transport,vault,gateway,async queueMail(owner:string,key:string,input:any,lifetime:number){await vault.put(owner,'AccountMail',key,{input,version:randomUUID(),expires_at:Date.now()+lifetime});queueMicrotask(retry);},async close(){if(timer)clearInterval(timer);await maintenance;},
    authEmail:env.AVERA_AUTH_EMAIL==='true',
    async status(owner:string){let capabilities={ai:false,plaid:false,email:false,linkedIn:false};try{capabilities=await transport.invoke(owner,'capabilities',{});}catch{}return {mode:config.integrations.mode,...capabilities,ai_consent:await consent(owner),sync_enabled:false};},
    async invoke(user:any,name:string,data:any){
      if(name==='getIntegrationStatus')return this.status(user.id);
      if(name==='setAiConsent'){
        if(typeof data.enabled!=='boolean')invalid('Choose whether AI may process your data.');
        await db.transaction(tx=>tx.query('INSERT INTO ai_consent(owner_id,enabled,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at',[user.id,data.enabled?1:0,new Date().toISOString()]));return {enabled:data.enabled};
      }
      if(!handlers[name]&&name!=='parseResume')throw new ApiError(404,'NOT_FOUND','Unknown online service.');
      if(name==='parseResume'){try{validateResume(data);}catch(error){if(error instanceof RequestFailure)throw new ApiError(error.status,error.code??'INVALID_RESUME',error.message);throw error;}}
      const limits:Record<string,[number,number]>={askAvera:[6,60],parseResume:[2,10],searchJobOpportunities:[3,30],demoSandboxConnect:[12,120],suggestBills:[6,60],suggestCategories:[6,60]};
      const limit=limits[name]??[10,120];
      await claimQuota(db,user.id,'online:'+name,limit[0]);await claimQuota(db,user.id,'online:'+name,limit[1],86400000);
      // Financial sharing is opt-in. Resume has separate explicit consent validation.
      const aiAllowed=await consent(user.id);
      if(['askAvera','suggestCategories','searchJobOpportunities'].includes(name)&&!aiAllowed)throw new ApiError(403,'AI_CONSENT_REQUIRED','Enable online AI processing in Settings before continuing.');
      if(name==='parseResume')return transport.invoke(user.id,'resume',data);
      const status=name==='searchJobOpportunities'?await this.status(user.id):null;
      const deadline=Date.now()+90000;
      const context={auth:{me:async()=>user},records:recordsFor(store,user.id),privateRecords:privateRecordsFor(vault,user.id),
        quota:{claim:async()=>{}},
        ai:{generate:(input:any)=>{if(!aiAllowed)throw new ApiError(403,'AI_CONSENT_REQUIRED','Enable online AI processing in Settings.');return transport.invoke(user.id,'ai',input);}},
        plaid:{request:(path:string,body:any)=>{if(Date.now()>deadline)throw new ApiError(503,'SERVICE_TIMEOUT','Bank refresh timed out. Retry to continue.');return transport.invoke(user.id,'plaid',{path,body});}},
        jobs:{linkedInConfigured:status?.linkedIn??false,linkedInKey:'server-managed',fetcher:async(url:string)=>Response.json(await transport.invoke(user.id,'jobs.fetch',{url}))},
      };
      const request=bindContext(new Request('http://avera.local/services/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),context);
      const bank=['plaidCreateLinkToken','plaidExchangeToken','plaidSync','plaidDisconnect','demoSandboxConnect'].includes(name),lease=randomUUID(),key='bank:'+user.id;
      if(bank){const acquired=await db.transaction(tx=>tx.query('INSERT INTO service_leases(lease_key,token,expires_at) VALUES($1,$2,$3) ON CONFLICT(lease_key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE service_leases.expires_at<$4 RETURNING token',[key,lease,Date.now()+180000,Date.now()]));if(!acquired.length)throw new ApiError(409,'SERVICE_BUSY','Another bank operation is running. Please retry shortly.');}
      try{const response:Response=await handlers[name](request);
        const result=await response.json();if(!response.ok)throw new ApiError(response.status,result.code??'SERVICE_FAILED',result.error??'Service unavailable.');return result;
      }finally{if(bank)await db.transaction(tx=>tx.query('DELETE FROM service_leases WHERE lease_key=$1 AND token=$2',[key,lease]));}
    },
  };
}
export type IntegrationRuntime=ReturnType<typeof integrationRuntime>;
