import type { Application, Collection, Fields } from '../contracts';
import { PUBLIC_COLLECTIONS } from '../contracts.ts';

export function createHttpAdapter({ fetcher=globalThis.fetch.bind(globalThis), navigate=(path: string)=>{window.location.href=path;} }: {
  fetcher?: typeof fetch; navigate?: (path: string)=>void;
} = {}): Application {
  const pending=new Set<AbortController>();
  async function request(path: string, method='GET', input?: unknown) {
    let response: Response;
    const controller=new AbortController();pending.add(controller);
    try { response=await fetcher('/api/v1'+path,{
      method,credentials:'same-origin',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(path==='/services/searchJobOpportunities'?180000:path.startsWith('/services/')?120000:20000)]),
      headers:{'Content-Type':'application/json'},...(input===undefined ? {} : {body:JSON.stringify(input)}),
    }); } catch { throw Object.assign(new Error('Local service is unavailable.'),{status:0,code:'SERVICE_UNAVAILABLE'}); }
    finally { pending.delete(controller); }
    let data: Fields;
    try { data=await response.json(); }
    catch { throw Object.assign(new Error('Invalid service response.'),{status:502,code:'INVALID_RESPONSE'}); }
    if (!response.ok) {
      const message=typeof data.error==='string' ? data.error:'Request failed.';
      throw Object.assign(new Error(message),{status:response.status,code:data.code,data,response:{status:response.status,data}});
    }
    return data as any;
  }
  function returnPath(raw: string) {
    try { const u=new URL(raw,window.location.origin); return u.origin===window.location.origin && !u.pathname.startsWith('//') && !u.pathname.includes('\\') ? u.pathname+u.search : '/'; }
    catch { return '/'; }
  }
  const capabilities={oauth:false,passwordReset:false,emailVerification:false,privacyControls:true,sampleWorkspaces:true};
  const collections=new Map<string,Collection>();
  return {
    capabilities,
    cancelPendingRequests(){for(const controller of pending)controller.abort();pending.clear();},
    auth:{
      startSample:()=>request('/auth/sample','POST',{}),
      leaveSample:()=>request('/auth/sample/leave','POST',{}),
      hasSession:()=>true, // Cookie-only sessions must be verified by the server.
      currentUser:()=>request('/auth/me'),updateProfile:fields=>request('/auth/me','PATCH',fields),
      signIn:(email,password)=>request('/auth/login','POST',{email,password}),
      register:fields=>request('/auth/register','POST',fields),
      verifyEmail:fields=>request('/auth/verify','POST',fields),setSessionToken:()=>{throw new Error('Sessions use private server cookies.');},resendVerification:email=>request('/auth/resend','POST',{email}),
      requestPasswordReset:email=>request('/auth/request-reset','POST',{email}),resetPassword:fields=>request('/auth/reset','POST',fields),signInWithProvider:(provider,returnTo)=>{if(provider!=='google')throw new Error('Unsupported sign-in provider.');navigate('/api/v1/auth/google/start?returnTo='+encodeURIComponent(returnPath(returnTo)));},
      signOut:async redirect=>{ await request('/auth/logout','POST',{}); if(redirect) navigate(returnPath(redirect)); },
      redirectToSignIn:returnTo=>navigate('/login?returnTo='+encodeURIComponent(returnPath(returnTo))),
    },
    records:{cascadesDependents:true,collection(name) {
      if (!(PUBLIC_COLLECTIONS as readonly string[]).includes(name)) throw new Error('Unknown record collection.');
      if (!collections.has(name)) {
        const path='/records/'+name;
        collections.set(name,{
          list:(query={},options={})=>request(path+'/query','POST',{query,options}),
          get:id=>request(path+'/'+encodeURIComponent(id)),create:fields=>request(path,'POST',fields),
          update:(id,fields)=>request(path+'/'+encodeURIComponent(id),'PATCH',fields),
          delete:id=>request(path+'/'+encodeURIComponent(id),'DELETE',{}),createMany:rows=>request(path+'/bulk','POST',{rows}),
        });
      }
      return collections.get(name)!;
    }},
    services:{invoke:async(name,payload={})=>({data:await request('/services/'+encodeURIComponent(name),'POST',payload)})},
    files:{parseResume:async input=>({data:await request('/services/parseResume','POST',input)})},
    settings:{getPublic:async()=>{const data=await request('/settings/public');const auth=data.public_settings?.auth;capabilities.oauth=auth?.oauth===true;capabilities.passwordReset=auth?.password_reset===true;capabilities.emailVerification=auth?.email_verification===true;return data;}},
    consent:{getInfo:async()=>new Response('{}',{status:501}),respond:async()=>new Response('{}',{status:501})},
  };
}
