// Real local server + SQLite + browser. No API fixtures or external providers.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');

(async()=>{
 const dir=await mkdtemp(join(tmpdir(),'avera-browser-'));
 let child,browser;
 const checks=[],forbidden=[],errors=[];
 async function start(){
  const env={...process.env,AVERA_PORT:'0',AVERA_DATA_STORE:'sqlite',AVERA_SQLITE_PATH:join(dir,'records.sqlite'),AVERA_FILES_PATH:join(dir,'files'),AVERA_INTEGRATION_MODE:'gateway'};
  for(const key of ['AVERA_GATEWAY_URL','AVERA_PUBLIC_ORIGIN','AVERA_DATABASE_URL']) delete env[key];
  child=spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{cwd:resolve('.'),env,stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{
   let out='',stderr=''; const timeout=setTimeout(()=>reject(new Error('Local server startup timed out: '+stderr)),15000);
   child.stderr.on('data',chunk=>{stderr+=String(chunk).slice(0,2000);});
   child.once('exit',code=>{clearTimeout(timeout);if(code)reject(new Error('Local server exited: '+stderr));});
   child.stdout.on('data',chunk=>{out+=String(chunk);const match=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});
  });
 }
 async function stop(){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}
 try{
  let url=await start();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  let first;
  for(const theme of ['light','dark'])for(const width of [320,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
   // Audit instrumentation runs before the page CSP; application scripts remain subject to it.
   await context.addInitScript({path:require.resolve('axe-core/axe.min.js')});
   await context.route('**/*',route=>{
    const target=new URL(route.request().url());
    if(target.hostname!=='127.0.0.1'||/base44|app-params/.test(target.pathname)){forbidden.push(target.href);return route.abort();}
    return route.continue();
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const email=`fixture-${theme}-${width}-${Date.now()}@example.test`,password='fixture-password-only';
   first??={email,password};
   await page.goto(url+'/register');
   await page.getByRole('heading',{name:'Create a local account'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Continue with Google'}).count(),0);
   await page.getByLabel('Email',{exact:true}).fill(email);
   await page.getByLabel('Password',{exact:true}).fill(password);
   await page.getByLabel('Confirm password',{exact:true}).fill(password);
   await page.getByRole('button',{name:'Create account',exact:true}).click();
   await page.waitForURL(url+'/');
   async function audit(path){
    await page.goto(url+path);await page.getByRole('heading').first().waitFor();
    await page.waitForTimeout(250);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${theme} ${width} ${path}`);
    const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));});
    assert.deepEqual(violations,[],`${theme} ${width} ${path}`);checks.push({theme,width,path});
   }
   await page.goto(url+'/bills-budget');
   await page.getByRole('button',{name:'Add bill',exact:true}).click();
   const dialog=page.getByRole('dialog');
   await dialog.getByLabel('Bill name').fill('Fixture rent');
   await dialog.getByLabel('Amount',{exact:true}).fill('100');
   await dialog.getByRole('button',{name:'Add bill',exact:true}).click();
   await dialog.waitFor({state:'hidden'});
   await page.getByRole('heading',{name:'Fixture rent',exact:true}).waitFor();
   await page.reload();await page.getByRole('heading',{name:'Fixture rent',exact:true}).waitFor();
   for(const path of ['/','/bills-budget','/yearly-plan','/settings']) await audit(path);
   await page.getByLabel('Household name').fill('Fixture household');
   await page.getByRole('button',{name:'Save household preferences',exact:true}).click();
   await page.getByText('Household preferences saved',{exact:true}).waitFor();
   await page.reload();await page.getByLabel('Household name').waitFor();
   assert.equal(await page.getByLabel('Household name').inputValue(),'Fixture household');
   await page.getByLabel('Household name').fill('Updated fixture household');
   const updated=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().includes('/records/HouseholdProfile/'));
   await page.getByRole('button',{name:'Save household preferences',exact:true}).click();
   assert.equal((await updated).status(),200);
   await page.getByText('Household preferences saved',{exact:true}).waitFor();
   if(theme==='light'&&width===1440){
    await page.goto(url+'/bills-budget');await page.getByRole('tab',{name:'Goals',exact:true}).click();
    await page.getByRole('button',{name:'Add goal',exact:true}).click();
    const goal=page.getByRole('dialog');await goal.getByLabel('Goal name').fill('Fixture reserve');await goal.getByLabel('Target amount').fill('1000');
    await goal.getByRole('button',{name:'Add goal',exact:true}).click();await goal.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Log contribution',exact:true}).click();
    const contribution=page.getByRole('dialog');await contribution.getByLabel('Contribution amount').fill('25');
    await contribution.getByRole('button',{name:'Log contribution',exact:true}).click();await contribution.waitFor({state:'hidden'});
    await page.getByText('$25.00',{exact:true}).waitFor();
    await page.goto(url+'/welcome');await page.getByRole('button',{name:'Pick a profile',exact:true}).click();
    await page.getByRole('button',{name:'Load profile',exact:true}).nth(1).click();
    await page.waitForURL(url+'/');
    await page.getByText('Demo Mode — Multi-Income Household',{exact:true}).first().waitFor();
    const own=await context.request.post(url+'/api/v1/records/Bill/query',{headers:{Origin:url},data:{query:{name:'Fixture rent'}}});
    assert.equal((await own.json()).items.length,1,'personal record survives sample seeding');
   }
   const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));
   assert(!stored.includes(email)&&!stored.includes(password)&&!stored.includes('Fixture rent'),'financial records/credentials are not in localStorage');
   await context.close();
  }
  await stop();url=await start();
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(url+'/login');await page.getByLabel('Email',{exact:true}).fill(first.email);await page.getByLabel('Password',{exact:true}).fill(first.password);
  await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(url+'/');
  await page.goto(url+'/bills-budget');await page.getByRole('heading',{name:'Fixture rent',exact:true}).waitFor();
  checks.push({processRestart:true});
  assert.deepEqual(forbidden,[],'independent UI requests no Base44 resources or external providers');
  assert.deepEqual(errors,[],'no browser exceptions');
  console.log(JSON.stringify({checks:checks.length,results:checks,forbidden,errors},null,2));
 }finally{if(browser)await browser.close();await stop();await rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
