import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,readdir,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const run=promisify(execFile),project=resolve('.');
const pass='fixture-desktop-recovery-only';
test('copied desktop package runs independently, keeps data through upgrades, and recovers offline',{timeout:180000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'avera desktop preview ')),app=join(dir,'app with spaces'),home=join(dir,'private data'),away=join(dir,'unrelated working directory');
 await import('node:fs/promises').then(fs=>fs.mkdir(away));let child:ReturnType<typeof spawn>|undefined;
 const env={...process.env};for(const key of Object.keys(env))if(/^(AVERA_|VITE_|BASE44_|OPENAI_|PLAID_|RESEND_|GEOCODIO_|OPENWEBNINJA_|GOOGLE_)/.test(key))delete env[key];
 env.AVERA_HOME=home;env.AVERA_PORT='0';env.AVERA_GATEWAY_URL='https://offline-gateway.example';env.AVERA_GATEWAY_TOKEN='fixture-installation-grant';
 // Deny all external network at the Node boundary, including the child server.
 const preload=join(dir,'deny-network.cjs'),networkLog=join(dir,'blocked-hosts.txt');
 await writeFile(preload,`const fs=require('node:fs');const native=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input.url||input);if(!['127.0.0.1','localhost'].includes(u.hostname)){fs.appendFileSync(${JSON.stringify(networkLog)},u.hostname+'\\n');return Promise.reject(Error('fixture offline'));}return native(input,init);};const https=require('node:https');https.request=()=>{throw Error('fixture offline');};require('node:module').syncBuiltinESMExports();`);
 env.NODE_OPTIONS='--require='+JSON.stringify(preload.replace(/\\/g,'/'));
 async function start(folder=app){
  child=spawn(process.execPath,[join(folder,'scripts','desktop-launcher.mjs'),'--no-browser'],{cwd:away,env,stdio:['ignore','pipe','pipe','ipc']});
  const processHandle=child;
  return new Promise<string>((resolve,reject)=>{let output='',error='';const timer=setTimeout(()=>reject(Error('Desktop startup timeout: '+error)),30000);processHandle.stderr!.on('data',bytes=>{error+=String(bytes);});processHandle.once('exit',()=>{clearTimeout(timer);reject(Error('Desktop exited before readiness: '+error));});processHandle.stdout!.on('data',bytes=>{output+=String(bytes);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});});
 }
 async function stop(){const current=child;if(!current||current.exitCode!==null)return;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Desktop shutdown timeout')),20000);current.once('exit',code=>{clearTimeout(timer);assert.equal(code,0);resolve();});current.send('avera:shutdown');});child=undefined;}
 t.after(async()=>{if(child&&child.exitCode===null){child.kill('SIGKILL');await new Promise(resolve=>child!.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});
 await run(process.execPath,['scripts/package-desktop.mjs',app],{cwd:project});
 const manifest=JSON.parse(await readFile(join(app,'desktop-manifest.json'),'utf8'));assert.equal(manifest.runtime_bundled,false);assert(!Object.keys(manifest.dependencies).some(name=>/base44|vite|react/.test(name)));
 assert(!Object.keys(manifest.files).some(name=>/^(base44|src|data|config)\/|\.env|\.sqlite|\.key$/.test(name)));
 const notices=await readFile(join(app,'dist-local','third-party-notices.txt'),'utf8');assert(notices.includes('react '));assert(!notices.includes('@base44/'));
 const pkg=JSON.parse(await readFile(join(app,'package.json'),'utf8'));assert.deepEqual(Object.keys(pkg.dependencies).sort(),['parse5','pg']);
 const checked=await run(process.execPath,[join(app,'scripts','desktop-launcher.mjs'),'--check'],{cwd:away,env});assert.match(checked.stdout,/verified/);await assert.rejects(stat(home));
 if(process.platform==='win32')await run('cmd.exe',['/d','/s','/c',`""${join(app,'Start Avera.cmd')}" --check"`],{cwd:away,env,windowsVerbatimArguments:true});
 else{await run('sh',[join(app,'start-avera.sh'),'--check'],{cwd:away,env});await run('sh',[join(app,'Start Avera.command'),'--check'],{cwd:away,env});}
 await assert.rejects(run(process.execPath,['scripts/package-desktop.mjs',join(project,'server','invalid-release')],{cwd:project}));
 const html=join(app,'dist-local','index.html'),original=await readFile(html);await writeFile(html,Buffer.concat([original,Buffer.from('tampered fixture')]));await assert.rejects(run(process.execPath,[join(app,'scripts','desktop-launcher.mjs'),'--check'],{env}));await writeFile(html,original);
 let url=await start(),cookie='';
 async function request(path:string,data?:unknown){const res=await fetch(url+'/api/v1'+path,{method:data===undefined?'GET':'POST',headers:{Origin:url,'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data)});if(res.headers.getSetCookie().length)cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return {status:res.status,body:await res.json()};}
 const email=randomUUID()+'@example.test',password='fixture-desktop-password';assert.equal((await request('/auth/register',{email,password})).status,200);
 const bill=await request('/records/Bill',{name:'Portable fixture rent',amount:123.45});assert.equal(bill.status,201);
 assert.equal((await request('/services/projectAnnualIncome',{name:'Fixture income',amount:1000,frequency:'monthly'})).body.annual_amount,12000);
 assert.equal((await request('/services/suggestBills',{dataset:{mode:'ordinary'}})).status,200);
 const consent=await request('/services/setAiConsent',{enabled:true});assert.equal(consent.status,200);
 const ai=await request('/services/askAvera',{question:'What is my planned spending?',dataset:{mode:'ordinary'}});assert(ai.status>=400);assert.equal((await request('/records/Bill/query',{query:{}})).body.items[0].amount,123.45);
 assert.equal((await request('/recovery/backup',{})).status,200);const backup=await request('/recovery/export',{passphrase:pass});assert.equal(backup.status,200);
 const savedKey=await readFile(join(home,'backup.key')),vaultKey=await readFile(join(home,'vault.key'));assert.equal(savedKey.length,32);assert.equal(vaultKey.length,32);
 const duplicate=await run(process.execPath,[join(app,'scripts','desktop-launcher.mjs'),'--no-browser'],{env}).then(()=>null,error=>error);assert(duplicate);assert.match(duplicate.stderr,/locked/);
 await stop();await assert.rejects(stat(join(home,'desktop.lock')));
 // A freshly extracted app uses the existing home without rebuilding/installing anything.
 const upgrade=join(dir,'replacement app');await run(process.execPath,['scripts/package-desktop.mjs',upgrade],{cwd:project});url=await start(upgrade);cookie='';assert.equal((await request('/auth/login',{email,password})).status,200);
 assert.equal((await request('/records/Bill/query',{query:{id:bill.body.id}})).body.items[0].amount,123.45);assert.deepEqual(await readFile(join(home,'backup.key')),savedKey);assert.deepEqual(await readFile(join(home,'vault.key')),vaultKey);
 const input={archive_base64:backup.body.archive_base64,passphrase:pass};const preview=await request('/recovery/preview',input);assert.equal(preview.status,200);assert.equal((await request('/recovery/apply',{...input,preview_token:preview.body.preview_token,confirmation:'RESTORE'})).status,200);
 assert.equal((await request('/auth/me')).status,401);assert.equal((await request('/auth/login',{email,password})).status,200);assert.equal((await request('/records/Bill/query',{query:{}})).body.items.length,1);
 const files=await readdir(home);assert(files.includes('avera.sqlite'));assert(files.includes('installation.env'));
 const hosts=await readFile(networkLog,'utf8').catch(()=> '');assert(!hosts.includes('base44'));assert(hosts.includes('offline-gateway.example'));await stop();
});
