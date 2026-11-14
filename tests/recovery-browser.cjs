// Real SQLite recovery UI. All data is disposable; no external providers are contacted.
const {chromium}=require('playwright');
const {mkdtemp,rm,readFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
(async()=>{
 const {sqliteDatabase}=await import('../server/database.ts');const {startLocalServer}=await import('../server/http.ts');
 const dir=await mkdtemp(join(tmpdir(),'avera-recovery-browser-'));let runtime,browser;const checks=[],errors=[],external=[];
 try{
  runtime=await startLocalServer({db:sqliteDatabase(join(dir,'records.sqlite')),port:0,dist:resolve('dist-local'),recoveryOptions:{directory:join(dir,'backups'),keyPath:join(dir,'backup.key'),schedule:false}});const url=runtime.url;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  for(const theme of ['light','dark'])for(const width of [320,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',acceptDownloads:true});
   await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);await context.addInitScript({path:require.resolve('axe-core/axe.min.js')});
   await context.route('**/*',route=>{const target=new URL(route.request().url());if(target.hostname!=='127.0.0.1'&&target.protocol!=='blob:'){external.push(target.hostname);return route.abort();}return route.continue();});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const email='restore-'+randomUUID()+'@example.test',password='fixture-password-only',phrase='fixture-recovery-passphrase-only';
   async function post(path,data={}){const res=await context.request.post(url+'/api/v1'+path,{headers:{Origin:url},data});assert(res.ok(),path+' '+res.status()+' '+await res.text());return res.json();}
   async function signIn(who=email){await page.getByLabel('Email',{exact:true}).fill(who);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Log in',exact:true}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();}
   async function audit(state){await page.waitForTimeout(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${theme} ${width} ${state}`);const v=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});assert.deepEqual(v,[],`${theme} ${width} ${state}`);checks.push({theme,width,state});}
   await post('/auth/register',{email,password});const bill=await post('/records/Bill',{name:'Fixture recovery rent',amount:125.45,source:'Manual'});
   await page.goto(url+'/settings');await page.getByRole('heading',{name:'Account',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Backups & recovery'}).count(),0);await audit('general settings');await page.getByRole('tab',{name:'General',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.getByRole('heading',{name:'Backups & recovery'}).waitFor();assert.equal(await page.getByRole('tab',{name:'Backups & recovery',exact:true}).getAttribute('aria-selected'),'true');await audit('backup settings');
   await page.getByRole('button',{name:'Back up now'}).click();await page.getByText('Backup completed and verified.').waitFor();
   await page.getByText('Download an encrypted portable backup',{exact:true}).click();await page.getByLabel('Recovery passphrase (at least 16 characters)').fill(phrase);await page.getByLabel('Repeat recovery passphrase').fill(phrase);
   const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download encrypted backup'}).click();const download=await downloading,bytes=await readFile(await download.path());assert(!bytes.toString().includes('Fixture recovery rent'));assert.equal(await page.getByLabel('Recovery passphrase (at least 16 characters)').inputValue(),'');
   const change=await context.request.patch(url+'/api/v1/records/Bill/'+bill.id,{headers:{Origin:url},data:{amount:200.33}});assert(change.ok());
   await page.getByText('Review or restore a backup',{exact:true}).click();await page.getByLabel('Choose a backup or migration file (maximum 32 MiB)').setInputFiles({name:'fixture.avera',mimeType:'application/octet-stream',buffer:bytes});
   await page.getByLabel('Backup recovery passphrase').fill('wrong-fixture-passphrase');await page.getByRole('button',{name:'Preview selected file'}).click();await page.getByRole('alert').filter({hasText:/passphrase is incorrect/}).waitFor();await audit('wrong passphrase');
   await page.getByLabel('Backup recovery passphrase').fill(phrase);await page.getByRole('button',{name:'Preview selected file'}).click();await page.getByRole('region',{name:'Recovery preview'}).waitFor();await audit('restore preview');
   assert(await page.getByRole('button',{name:'Restore records'}).isDisabled());
   const newer=await context.request.patch(url+'/api/v1/records/Bill/'+bill.id,{headers:{Origin:url},data:{amount:201.33}});assert(newer.ok());
   await page.getByLabel('Type RESTORE to confirm').fill('RESTORE');await page.getByRole('button',{name:'Restore records'}).click();await page.getByRole('alert').filter({hasText:/changed since preview/}).waitFor();
   const kept=await post('/records/Bill/query',{query:{id:bill.id}});assert.equal(kept.items[0].amount,201.33);
   await page.getByRole('button',{name:'Preview selected file'}).click();await page.getByLabel('Type RESTORE to confirm').fill('RESTORE');await page.getByRole('button',{name:'Restore records'}).click();await page.waitForURL(u=>u.pathname==='/login');await signIn();
   const restored=await post('/records/Bill/query',{query:{id:bill.id}});assert.equal(restored.items.length,1);assert.equal(restored.items[0].amount,125.45);
   await page.goto(url+'/settings');await page.getByRole('tab',{name:'Backups & recovery',exact:true}).click();await page.getByRole('heading',{name:'Backups & recovery'}).waitFor();const status=await context.request.get(url+'/api/v1/recovery/status');assert((await status.json()).backups.some(row=>row.kind==='safety'));await audit('restored and reauthenticated');
   if(theme==='light'&&width===1440){
    const target='migration-'+randomUUID()+'@example.test';await post('/auth/register',{email:target,password});
    const recordId=randomUUID(),fileId=randomUUID(),content=Buffer.from('fixture attachment'),at=new Date().toISOString();
    const prepared={format:'avera-records',version:1,schema_version:4,created_at:at,source:'base44',records:[{collection:'Bill',id:recordId,revision:1,created_at:at,updated_at:at,fields:{name:'Migrated fixture bill',amount:75.50,source:'Manual'}}],workspaces:[],attachments:[{id:fileId,name:'fixture.txt',mime_type:'text/plain',content_base64:content.toString('base64'),sha256:createHash('sha256').update(content).digest('hex'),record_collection:'Bill',record_id:recordId}]};
    await page.goto(url+'/settings');await page.getByRole('tab',{name:'Backups & recovery',exact:true}).click();await page.getByText('Review or restore a backup',{exact:true}).click();await page.getByLabel('File type',{exact:true}).selectOption('import');await page.getByLabel('Choose a backup or migration file (maximum 32 MiB)').setInputFiles({name:'fixture.migration.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(prepared))});await page.getByRole('button',{name:'Preview selected file'}).click();await page.getByRole('region',{name:'Recovery preview'}).waitFor();await page.getByText('Reconciled money totals',{exact:true}).click();await page.getByText('75.50',{exact:true}).waitFor();await audit('migration reconciliation');
    await page.getByLabel('Type IMPORT to confirm').fill('IMPORT');await page.getByRole('button',{name:'Import records'}).click();await page.waitForURL(u=>u.pathname==='/login');await signIn(target);
    assert.equal((await post('/records/Bill/query',{query:{name:'Migrated fixture bill'}})).items[0].amount,75.50);assert.equal((await post('/recovery/attachment',{id:fileId})).content_base64,content.toString('base64'));
   }
   await page.screenshot({path:`/tmp/avera-stage6-${theme}-${width}.png`,fullPage:true,animations:'disabled'});await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({checks:checks.length,details:checks,errors,external},null,2));
 }finally{await browser?.close();await runtime?.close();await rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
