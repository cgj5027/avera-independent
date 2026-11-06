import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { Database } from './database.ts';
import { migrate } from './database.ts';
import { RecordStore } from './store.ts';
import { integrationRuntime } from './integrations/runtime.ts';
import { googleAuth } from './oauth.ts';
import { AuthService } from './auth.ts';
import { ApiError, invalid } from './errors.ts';
import { object } from './validation.ts';

async function jsonBody(req: IncomingMessage,maximum=1024*1024) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new ApiError(415,'INVALID_CONTENT_TYPE','Use application/json.');
  const chunks: Buffer[]=[]; let bytes=0;
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    const part=Buffer.from(chunk); bytes+=part.length;
    if (bytes>maximum) { req.resume(); throw new ApiError(413,'REQUEST_TOO_LARGE','Request is too large.'); }
    chunks.push(part);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
  catch (error) { if (error instanceof ApiError) throw error; invalid('Invalid JSON.'); }
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}
function cookie(req: IncomingMessage) {
  return req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('avera_session='))?.slice('avera_session='.length);
}
export async function startLocalServer({ db, port=4175, dist, publicOrigin,env,fetcher=fetch,gatewayOnly=false }: {
  db: Database; port?: number; dist?: string; publicOrigin?: string; env?:Record<string,string|undefined>;fetcher?:typeof fetch;gatewayOnly?:boolean;
}) {
  await migrate(db);
  const store=new RecordStore(db);
  const integrations=env?integrationRuntime(db,store,env,fetcher):undefined;
  const auth=new AuthService(db,integrations);
  const google=integrations?googleAuth(db,auth,integrations.vault.box,env!,fetcher):undefined;
  let origin='';
  const server=createServer((req,res)=>{ void handle(req,res); });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const expected=new URL(publicOrigin ?? origin);
      const allowed=publicOrigin ? [expected.host] : [expected.host,`localhost:${expected.port}`];
      if (!req.headers.host || !allowed.includes(req.headers.host)) throw new ApiError(421,'INVALID_HOST','Invalid host.');
      const requestOrigin=publicOrigin ?? `http://${req.headers.host}`;
      const url=new URL(req.url ?? '/',requestOrigin), method=req.method ?? 'GET';
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('X-Frame-Options','DENY');
      const sessionCookie=(token:string)=>`avera_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${requestOrigin.startsWith('https:')?'; Secure':''}`;
      if(method==='POST'&&url.pathname==='/gateway/v1/invoke'&&integrations?.gateway){
        if(req.headers.origin)throw new ApiError(403,'INVALID_ORIGIN','Use a server connection for gateway requests.');
        return send(res,200,await integrations.gateway(req.headers.authorization,await jsonBody(req,8*1024*1024)));
      }
      if(gatewayOnly&&url.pathname!=='/api/v1/health')throw new ApiError(404,'NOT_FOUND','Endpoint not found.');
      if (url.pathname.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(method) && req.headers.origin!==requestOrigin) throw new ApiError(403,'INVALID_ORIGIN','Request origin is not allowed.');
        const path=url.pathname;
        if (method==='GET' && path==='/api/v1/health') return send(res,200,{ok:true});
        if (method==='GET' && path==='/api/v1/settings/public') return send(res,200,{id:'avera-independent',public_settings:{auth:{email_verification:integrations?.authEmail??false,oauth:google?.enabled??false,password_reset:integrations?.authEmail??false}}});
        if (method==='POST' && (path==='/api/v1/auth/register' || path==='/api/v1/auth/login')) {
          auth.limit(req.socket.remoteAddress ?? 'local');
          const result=path.endsWith('/register') ? await auth.register(await jsonBody(req)) : await auth.signIn(await jsonBody(req));
          if(result.token)res.setHeader('Set-Cookie',sessionCookie(result.token));
          return send(res,200,result.data);
        }
        if(method==='GET'&&path==='/api/v1/auth/google/start'&&google){
          auth.limit(req.socket.remoteAddress??'local');
          const result=await google.begin(requestOrigin,url.searchParams.get('returnTo')??'/');
          res.writeHead(302,{Location:result.url,'Set-Cookie':`avera_oauth=${result.state}; Path=/api/v1/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${requestOrigin.startsWith('https:')?'; Secure':''}`});res.end();return;
        }
        if(method==='GET'&&path==='/api/v1/auth/google/callback'&&google){
          auth.limit(req.socket.remoteAddress??'local');
          const stateCookie=req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('avera_oauth='))?.slice(12);
          const result=await google.complete(requestOrigin,url.searchParams.get('code')??'',url.searchParams.get('state')??'',stateCookie);
          res.writeHead(302,{Location:result.returnTo,'Set-Cookie':[sessionCookie(result.token),'avera_oauth=; Path=/api/v1/auth/google; HttpOnly; SameSite=Lax; Max-Age=0']});res.end();return;
        }
        if(method==='POST'&&['/api/v1/auth/verify','/api/v1/auth/resend','/api/v1/auth/request-reset','/api/v1/auth/reset'].includes(path)){
          auth.limit(req.socket.remoteAddress??'local');const data=await jsonBody(req);
          if(path.endsWith('/verify')){const result=await auth.verify(data);res.setHeader('Set-Cookie',sessionCookie(result.token));return send(res,200,result.data);}
          if(path.endsWith('/resend'))return send(res,200,await auth.resend(data.email));
          if(path.endsWith('/request-reset'))return send(res,200,await auth.requestReset(data.email,requestOrigin));
          return send(res,200,await auth.reset(data));
        }
        if (method==='POST' && path==='/api/v1/auth/logout') {
          await jsonBody(req); await auth.signOut(cookie(req));
          res.setHeader('Set-Cookie',`avera_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${requestOrigin.startsWith('https:') ? '; Secure':''}`);
          return send(res,200,{signed_out:true});
        }
        const user=await auth.current(cookie(req));
        if (method==='GET' && path==='/api/v1/auth/me') return send(res,200,user);
        if (method==='PATCH' && path==='/api/v1/auth/me') return send(res,200,await auth.update(user.id,await jsonBody(req)));
        const match=path.match(/^\/api\/v1\/records\/([A-Za-z]+)(?:\/([^/]+))?$/);
        if (match) {
          const name=match[1], id=match[2];
          if (method==='POST' && id==='query') { const data=await jsonBody(req); return send(res,200,await store.list(user.id,name,data.query,data.options)); }
          if (method==='POST' && id==='bulk') return send(res,201,await store.createMany(user.id,name,(await jsonBody(req)).rows));
          if (method==='POST' && !id) return send(res,201,await store.create(user.id,name,await jsonBody(req)));
          if (method==='GET' && id) return send(res,200,await store.get(user.id,name,id));
          if (method==='PATCH' && id) return send(res,200,await store.update(user.id,name,id,await jsonBody(req)));
          if (method==='DELETE' && id) { await jsonBody(req); return send(res,200,await store.delete(user.id,name,id)); }
        }
        if (method==='POST' && path.startsWith('/api/v1/services/')) {
          const name=path.slice('/api/v1/services/'.length), data=await jsonBody(req,name==='parseResume'?8*1024*1024:1024*1024);
          if (name==='logGoalContribution') return send(res,200,await store.contribution(user.id,data));
          if (name==='projectAnnualIncome') {
            const periods: Record<string,number>={weekly:52,biweekly:26,semimonthly:24,monthly:12,quarterly:4,semiannual:2,annual:1};
            if (typeof data.name!=='string' || !data.name.trim() || typeof data.amount!=='number' || !Number.isFinite(data.amount) || data.amount<=0 || data.amount>1e9 || typeof data.frequency!=='string' || !Object.hasOwn(periods,data.frequency)) invalid('Enter a valid income amount and frequency.');
            return send(res,200,{annual_amount:Math.round(data.amount*periods[data.frequency]*100)/100,rationale:`Calculated from the entered amount and ${data.frequency} frequency. Excludes unrecorded bonuses, overtime and tax assumptions.`});
          }
          if (name==='submitFeedback') {
            if (!Number.isInteger(data.rating) || data.rating<1 || data.rating>5 || typeof data.message!=='string' || !data.message.trim() || data.message.length>2000 || data.consent!==true || typeof data.request_id!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.request_id)) invalid('Choose a rating, enter feedback, and confirm consent.');
            await db.transaction(tx=>tx.query(`INSERT INTO feedback(owner_id,request_id,rating,message,created_at) VALUES($1,$2,$3,$4,$5)
              ON CONFLICT(owner_id,request_id) DO UPDATE SET rating=excluded.rating,message=excluded.message`,[user.id,data.request_id,data.rating,data.message.trim(),new Date().toISOString()]));
            return send(res,200,{saved:true});
          }
          if(integrations&&['getIntegrationStatus','setAiConsent','askAvera','searchJobOpportunities','parseResume','suggestBills','suggestCategories','demoSandboxConnect','plaidCreateLinkToken','plaidExchangeToken','plaidSync','plaidDisconnect'].includes(name))return send(res,200,await integrations.invoke(user,name,data));
          if (['askAvera','searchJobOpportunities','parseResume','suggestBills','suggestCategories','demoSandboxConnect','plaidCreateLinkToken','plaidExchangeToken','plaidSync','plaidDisconnect'].includes(name)) {
            throw new ApiError(503,'INTEGRATIONS_UNAVAILABLE','Online services are not configured in this installation yet.');
          }
        }
        throw new ApiError(404,'NOT_FOUND','Endpoint not found.');
      }
      if (!dist || !['GET','HEAD'].includes(method)) throw new ApiError(404,'NOT_FOUND','Page not found.');
      const root=await realpath(dist), requested=resolve(root,'.'+decodeURIComponent(url.pathname));
      if (requested!==root && !requested.startsWith(root+sep)) throw new ApiError(404,'NOT_FOUND','Page not found.');
      let file=requested;
      try { if (!(await stat(file)).isFile()) file=resolve(root,'index.html'); }
      catch { if (extname(file)) throw new ApiError(404,'NOT_FOUND','File not found.'); file=resolve(root,'index.html'); }
      file=await realpath(file);
      if (!file.startsWith(root+sep)) throw new ApiError(404,'NOT_FOUND','File not found.');
      const types: Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
      res.writeHead(200,{'Content-Type':types[extname(file)] ?? 'application/octet-stream','Cache-Control':'no-cache',
        'Content-Security-Policy':"default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.plaid.com; frame-src https://*.plaid.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});
      res.end(method==='HEAD' ? undefined : await readFile(file));
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const e=error as any;
      if (e instanceof ApiError) return send(res,e.status,{error:e.message,code:e.code});
      if (e.code==='23505' || String(e.message).includes('UNIQUE constraint failed')) return send(res,409,{error:'A conflicting record already exists.',code:'CONFLICT'});
      send(res,500,{error:'The request could not be completed.',code:'INTERNAL_ERROR'});
    }
  }
  server.requestTimeout=120000;server.headersTimeout=15000;
  await new Promise<void>((resolve,reject)=>{ server.once('error',reject); server.listen(port,'127.0.0.1',()=>resolve()); });
  const address=server.address();
  if (!address || typeof address==='string') throw new Error('Server did not bind.');
  origin=`http://127.0.0.1:${address.port}`;
  return {url:origin,store,auth,async close() {
    await new Promise<void>((resolve,reject)=>server.close(error=>error ? reject(error):resolve()));
    await integrations?.close();
    await db.close();
  }};
}
