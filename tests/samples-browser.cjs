// Real account-free samples and account-owned datasets on disposable SQLite; no provider calls.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const dir=await mkdtemp(join(tmpdir(),'avera-stage5-'));let child,browser;
 const checks=[],errors=[],external=[];
 try{
  const env={...process.env,AVERA_PORT:'0',AVERA_DATA_STORE:'sqlite',AVERA_SQLITE_PATH:join(dir,'sample.sqlite'),AVERA_FILES_PATH:join(dir,'files'),AVERA_INTEGRATION_MODE:'gateway',AVERA_AUTH_EMAIL:'false'};
  for(const key of ['AVERA_GATEWAY_URL','AVERA_PUBLIC_ORIGIN','AVERA_DATABASE_URL'])delete env[key];
  child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{cwd:resolve('.'),env,stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{let out='',err='';const timer=setTimeout(()=>reject(Error('Startup timed out: '+err)),15000);child.stderr.on('data',x=>err+=String(x));child.stdout.on('data',x=>{out+=String(x);const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server stopped: '+err));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  for(const theme of ['light','dark'])for(const width of [320,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
   await context.addInitScript({path:require.resolve('axe-core/axe.min.js')});
   await context.route('**/*',r=>{const target=new URL(r.request().url());if(target.hostname!=='127.0.0.1'){external.push(target.hostname);return r.abort();}return r.continue();});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const post=async(path,data={})=>{const res=await context.request.post(url+'/api/v1'+path,{headers:{Origin:url},data});assert(res.ok(),path+' '+res.status()+' '+await res.text());return res.json();};
   async function audit(state){await page.waitForTimeout(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${state} ${width}`);const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));});assert.deepEqual(violations,[],`${state} ${theme} ${width}`);checks.push({state,theme,width});if(state==='public landing'||state==='secondary sample picker')await page.screenshot({path:`/tmp/avera-stage5-${state.replaceAll(' ','-')}-${theme}-${width}.png`,fullPage:true,animations:'disabled'});}
   async function navigate(label){if(width<1280){await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('navigation',{name:'Mobile primary'}).getByRole('link',{name:label,exact:true}).click();}else await page.getByRole('navigation',{name:'Primary',exact:true}).getByRole('link',{name:label,exact:true}).click();}
   await page.goto(url+'/');await page.getByRole('heading',{name:'A clearer view of your money.'}).waitFor();await audit('public landing');
   await page.keyboard.press('Tab');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'landing-content');
   assert.equal(await page.getByRole('button',{name:/Explore Early Career/}).count(),0);
   await page.getByRole('button',{name:'Try sample data'}).click();await audit('secondary sample picker');
   await page.getByRole('button',{name:'Explore Early Career Professional'}).click();await page.getByText('Sample data — Early Career Professional',{exact:true}).waitFor();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();await audit('guest overview');
   const first=(await post('/records/Bill/query',{query:{demo_profile:'early_career'}})).items;assert(first.length>0);
   const edit=await context.request.patch(url+'/api/v1/records/Bill/'+first[0].id,{headers:{Origin:url},data:{name:'Sample edit kept'}});assert(edit.ok());
   await navigate('Bills & Budget');await page.getByRole('tab',{name:'Goals',exact:true}).click();await audit('goals within three navigation clicks');
   await page.locator('summary').filter({hasText:'Sample data —'}).click();await page.getByRole('link',{name:'Change scenario'}).click();await page.getByRole('button',{name:'Explore Multi-Income Household'}).click();await page.getByText('Sample data — Multi-Income Household',{exact:true}).waitFor();
   await page.reload();await page.getByText('Sample data — Multi-Income Household',{exact:true}).waitFor();
   const tab=await context.newPage();await tab.goto(url+'/properties');await tab.getByRole('heading',{name:'Properties',exact:true}).waitFor();
   await page.locator('summary').filter({hasText:'Sample data —'}).click();await page.getByRole('link',{name:'Change scenario'}).click();await page.getByRole('button',{name:'Explore Early Career Professional'}).click();await page.getByText('Sample data — Early Career Professional',{exact:true}).waitFor();
   await tab.getByText('Sample data — Early Career Professional',{exact:true}).waitFor();assert.equal((await post('/records/Bill/query',{query:{id:first[0].id}})).items[0].name,'Sample edit kept');
   await page.locator('summary').filter({hasText:'Sample data —'}).click();await page.getByRole('button',{name:'Reset sample scenario'}).click();await audit('explicit reset confirmation');await page.getByRole('button',{name:'Reset sample',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
   assert(!(await post('/records/Bill/query',{query:{demo_profile:'early_career'}})).items.some(row=>row.name==='Sample edit kept'));
   await page.locator('summary').filter({hasText:'Sample data —'}).click();await page.getByRole('button',{name:'Back to landing page'}).click();await page.getByRole('heading',{name:'A clearer view of your money.'}).waitFor();
   await page.getByRole('button',{name:'Try sample data'}).click();await page.getByRole('button',{name:'Explore Multi-Income Household'}).click();await page.getByText('Sample data — Multi-Income Household',{exact:true}).waitFor();
   await audit('resumed guest scenario');await tab.close();
   if(width===1440&&theme==='light'){
    const guest=(await context.request.get(url+'/api/v1/auth/me')).ok();assert(guest);
    await post('/auth/register',{email:'stage5-'+Date.now()+'@example.test',password:'fixture-password-only'});
    const personal=await post('/records/Bill',{name:'PERSONAL only',amount:42,source:'Manual'});
    await page.goto(url+'/welcome');await page.getByRole('button',{name:'Try sample data'}).click();await page.getByRole('button',{name:'Explore Early Career Professional'}).click();await page.getByText('Sample data — Early Career Professional',{exact:true}).waitFor();
    await page.goto(url+'/bills-budget');assert.equal(await page.getByText('PERSONAL only',{exact:true}).count(),0);
    await page.locator('summary').filter({hasText:'Sample data —'}).click();await page.getByRole('button',{name:'Return to personal finances'}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();await navigate('Bills & Budget');await page.getByText('PERSONAL only',{exact:true}).waitFor();
    assert.equal((await post('/records/Bill/query',{query:{id:personal.id}})).items.length,1);await audit('personal records restored');
    await page.goto(url+'/welcome?sample=1');await page.getByRole('button',{name:'Explore Early Career Professional'}).click();await page.getByText('Sample data — Early Career Professional',{exact:true}).waitFor();
    await context.route('**/api/v1/services/sampleWorkspace',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture unavailable'})}));
    await page.goto(url+'/welcome?sample=1');await page.getByRole('button',{name:'Explore Financial Improvement'}).click();await page.getByRole('alert').filter({hasText:/previous workspace has been kept/}).waitFor();await context.unroute('**/api/v1/services/sampleWorkspace');
    const selection=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('avera_workspace:')&&JSON.parse(localStorage.getItem(key)||'{}').mode==='demo').map(([key])=>JSON.parse(localStorage.getItem(key)).workspace.profile));assert(selection.includes('early_career'));
    await page.goto(url+'/ask-avera');await page.getByLabel('Ask Avera',{exact:true}).fill('UNSENT sample-only draft');
    const second=await context.newPage();await second.goto(url+'/welcome');await second.getByRole('button',{name:'Get started'}).click();await page.getByRole('textbox',{name:'Ask Avera',exact:true}).waitFor();assert.equal(await page.getByLabel('Ask Avera',{exact:true}).inputValue(),'');await second.close();
   }
   await page.screenshot({path:`/tmp/avera-stage5-real-${theme}-${width}.png`,fullPage:true,animations:'disabled'});await context.close();
  }
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:checks.length,details:checks,external,errors},null,2));
 }finally{await browser?.close();if(child&&child.exitCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}await rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
