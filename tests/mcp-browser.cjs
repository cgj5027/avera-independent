// Real independent authorization UI with synthetic accounts and loopback callbacks only.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises'),{join,resolve}=require('node:path'),{tmpdir}=require('node:os'),{randomUUID,randomBytes,createHash}=require('node:crypto');
(async()=>{
 const {sqliteDatabase}=await import('../server/database.ts'),{startLocalServer}=await import('../server/http.ts');
 const dir=await mkdtemp(join(tmpdir(),'avera-mcp-browser-'));let runtime,browser;const checks=[],errors=[],external=[];
 try{
  runtime=await startLocalServer({db:sqliteDatabase(join(dir,'records.sqlite')),port:0,dist:resolve('dist-local'),env:{AVERA_MCP_ENABLED:'true',AVERA_VAULT_KEY_PATH:join(dir,'vault.key')}});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  for(const theme of ['light','dark'])for(const width of [320,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);await context.addInitScript({path:require.resolve('axe-core/axe.min.js')});
   await context.route('**/*',route=>{const target=new URL(route.request().url());if(target.port==='49877'&&target.hostname==='127.0.0.1')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Fixture client callback</title><p>Fixture client callback</p>'});if(target.hostname!=='127.0.0.1'){external.push(target.hostname);return route.abort();}return route.continue();});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const signed=await context.request.post(runtime.url+'/api/v1/auth/register',{headers:{Origin:runtime.url},data:{email:randomUUID()+'@example.test',password:'fixture-mcp-browser-password'}});assert(signed.ok());
   const register=await context.request.post(runtime.url+'/oauth/register',{data:{client_name:'Fixture desktop AI',redirect_uris:['http://127.0.0.1:49877/callback']}});assert(register.ok());const client=await register.json();
   const verifier=randomBytes(32).toString('base64url'),params=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',scope:'avera:read',resource:runtime.url+'/mcp',state:'fixture',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
   async function audit(state){await page.waitForTimeout(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${theme} ${width} ${state}`);const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});assert.deepEqual(violations,[],`${theme} ${width} ${state}`);checks.push({theme,width,state});}
   await page.goto(runtime.url+'/oauth/authorize?'+params);await page.getByRole('button',{name:'Approve',exact:true}).waitFor();await page.getByText('Read personal Avera records',{exact:true}).waitFor();await audit('consent');
   await page.getByRole('button',{name:'Approve',exact:true}).click();await page.waitForURL(u=>u.port==='49877');const code=new URL(page.url()).searchParams.get('code');assert(code);
   // Avera's session cookie is scoped to its API, not sent to the client callback.
   assert(!(await context.cookies('http://127.0.0.1:49877/callback')).some(c=>c.name==='avera_session'));
   const tokens=await context.request.post(runtime.url+'/oauth/token',{form:{client_id:client.client_id,grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:client.redirect_uris[0],resource:runtime.url+'/mcp'}});assert(tokens.ok());const credentials=await tokens.json();
   await page.goto(runtime.url+'/settings');await page.getByRole('button',{name:'Revoke access for Fixture desktop AI'}).waitFor();await audit('connected clients');await page.getByRole('button',{name:'Revoke access for Fixture desktop AI'}).click();await page.getByText('No AI clients have access.',{exact:true}).waitFor();await audit('revoked');
   const blocked=await context.request.post(runtime.url+'/mcp',{headers:{Authorization:'Bearer '+credentials.access_token},data:{jsonrpc:'2.0',id:1,method:'tools/list'}});assert.equal(blocked.status(),401);
   await page.goto(runtime.url+'/oauth/authorize?'+params);await page.getByRole('button',{name:'Deny',exact:true}).waitFor();await page.getByRole('button',{name:'Deny',exact:true}).click();await page.waitForURL(u=>u.port==='49877');assert.equal(new URL(page.url()).searchParams.get('error'),'access_denied');
   await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({checks:checks.length,results:checks,errors,external},null,2));
 }finally{await browser?.close();await runtime?.close();await rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
