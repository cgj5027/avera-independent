// Real PostgreSQL and browser through a disposable TLS reverse proxy. Mail alone is synthetic.
const assert=require('node:assert/strict');
const https=require('node:https'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const {mkdtemp,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {randomBytes,randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
(async()=>{
 assert(process.env.AVERA_TEST_POSTGRES_URL,'A disposable PostgreSQL database is required.');
 const {startLocalServer}=await import('../server/http.ts');
 const {postgresDatabase}=await import('../server/database.ts');
 const dir=await mkdtemp(join(tmpdir(),'avera-hosted-tls-')),mail=[],errors=[],external=[];
 let runtime,browser,proxy;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key'),'-out',join(dir,'cert'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  proxy=https.createServer({key:await readFile(join(dir,'key')),cert:await readFile(join(dir,'cert'))},(req,res)=>{
   const upstream=http.request(runtime.url+req.url,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
   upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const origin='https://127.0.0.1:'+proxy.address().port;
  const env={AVERA_DATA_STORE:'postgres',AVERA_DATABASE_URL:process.env.AVERA_TEST_POSTGRES_URL,AVERA_VAULT_KEY:randomBytes(32).toString('base64'),AVERA_INTEGRATION_MODE:'gateway',AVERA_GATEWAY_URL:'https://gateway.fixture.test',AVERA_GATEWAY_TOKEN:randomBytes(32).toString('base64url'),AVERA_AUTH_EMAIL:'true'};
  runtime=await startLocalServer({db:postgresDatabase(env.AVERA_DATABASE_URL),port:0,host:'0.0.0.0',hostedApplication:true,publicOrigin:origin,dist:resolve('dist-local'),env,fetcher:async(url,options)=>{
   assert.equal(new URL(url).hostname,'gateway.fixture.test');
   const body=JSON.parse(options.body);
   if(body.operation==='mail'){mail.push(body.input);return Response.json({result:{sent:true}});}
   assert.equal(body.operation,'capabilities');return Response.json({result:{ai:true,plaid:true,email:true,linkedIn:false}});
  }});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({ignoreHTTPSErrors:true,reducedMotion:'reduce'});
  await context.addInitScript({path:require.resolve('axe-core/axe.min.js')});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const email=randomUUID()+'@example.test',password='hosted-fixture-password';
  await page.goto(origin+'/register');
  await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('heading',{name:'Verify your email',exact:true}).waitFor();
  async function emailWith(subject){for(let attempt=0;attempt<100;attempt++){const value=mail.find(item=>item.to===email&&item.subject===subject);if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Fixture account mail was not delivered.');}
  const verification=await emailWith('Avera verification code');
  await page.getByLabel('Email verification code',{exact:true}).fill(verification.text.match(/\b\d{6}\b/)[0]);await page.getByRole('button',{name:'Verify',exact:true}).click();await page.waitForURL(origin+'/');
  const cookie=(await context.cookies()).find(cookie=>cookie.httpOnly);assert(cookie?.secure);assert.equal(cookie.path,'/api/v1');
  const created=await context.request.post(origin+'/api/v1/records/Bill',{headers:{Origin:origin},data:{name:'TLS fixture bill',amount:75}});assert.equal(created.status(),201);
  for(const theme of ['light','dark'])for(const width of [320,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(theme=>localStorage.setItem('theme',theme),theme);await page.goto(origin+'/bills-budget');await page.getByRole('heading',{name:'TLS fixture bill',exact:true}).waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const violations=await page.evaluate(async()=>{const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return result.violations.map(item=>item.id);});assert.deepEqual(violations,[]);
  }
  const reset=await context.request.post(origin+'/api/v1/auth/request-reset',{headers:{Origin:origin,'X-Forwarded-Host':'attacker.example','X-Forwarded-Proto':'http'},data:{email}});assert.equal(reset.status(),200);
  const resetMail=await emailWith('Reset your Avera password');assert(resetMail.text.includes(origin+'/reset-password?token='));assert(!resetMail.text.includes('attacker.example'));
  const denied=await context.request.post(origin+'/api/v1/records/Bill',{headers:{Origin:'https://attacker.example'},data:{name:'Forbidden',amount:99}});assert.equal(denied.status(),403);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Hosted TLS browser: verified email, Secure cookie, PostgreSQL record, four responsive/theme accessibility checks, canonical recovery link and CSRF rejection passed. Mail was synthetic; no live providers were contacted.');
 }finally{await browser?.close();if(proxy)await new Promise(resolve=>proxy.close(resolve));await runtime?.close();await rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
