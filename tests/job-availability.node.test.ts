import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress,postingUrl,resolvePostingHost,assessPosting,checkPostings,createPostingVerifier } from '../server/integrations/job-availability.ts';
import { searchListings } from '../server/integrations/logic/opportunitySource.js';
const now=Date.parse('2026-11-13T12:00:00Z');
const candidate={url:'https://careers.employer.com/jobs/123',title:'Bookkeeper',company:'Fixture Employer'};
const page=(html:string,status=200)=>({html,status,url:candidate.url});
const job=(extra:any={})=>({ '@type':'JobPosting',url:candidate.url,title:candidate.title,hiringOrganization:{name:candidate.company},...extra});
const html=(metadata:any,body='')=>`<html><script type="application/ld+json">${JSON.stringify(metadata)}</script>${body}</html>`;
const apply='<h1>Bookkeeper</h1><p>Fixture Employer</p><a href="/jobs/123/apply">Apply now</a>';
test('public posting URLs and pinned DNS reject internal, reserved and rebinding targets',async()=>{
  for(const address of ['127.0.0.1','10.1.1.1','169.254.169.254','172.16.1.2','192.168.1.1','100.64.1.2','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'])assert.equal(publicAddress(address),false,address);
  for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(publicAddress(address),true,address);
  for(const url of ['http://careers.employer.com','https://127.1/','https://2130706433/','https://[::1]/','https://user:pass@employer.com/','https://employer.com:8443/','https://metadata.google.internal/','https://jobs.localhost/','file:///etc/passwd'])assert.throws(()=>postingUrl(url),url);
  const resolving=(rows:any[])=>async()=>rows;
  await assert.rejects(resolvePostingHost('careers.employer.com',resolving([{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]) as any));
  await assert.rejects(resolvePostingHost('careers.employer.com',resolving([]) as any));
  assert.deepEqual(await resolvePostingHost('careers.employer.com',resolving([{address:'8.8.8.8',family:4}]) as any),{address:'8.8.8.8',family:4});
});
test('filters removed pages, expired deadlines, closure notices and stale apply metadata',()=>{
  for(const status of [404,410])assert.equal(assessPosting(candidate,page('',status),now).status,'closed');
  assert.equal(assessPosting(candidate,page(html(job({validThrough:'2026-11-12'}),apply)),now).status,'closed');
  assert.equal(assessPosting(candidate,page(html(job({validThrough:'2027-01-01'}),'This job is no longer available. '+apply)),now).status,'closed');
  for(const notice of ['This position has been filled.','This job posting has expired.','Applications for this position are now closed.','This requisition is no longer active.'])assert.equal(assessPosting(candidate,page(html(job({validThrough:'2027-01-01'}),notice+apply)),now).status,'closed',notice);
  assert.equal(assessPosting(candidate,page(html(job({potentialAction:{'@type':'ApplyAction'}}))),now).status,'unverified');
  assert.equal(assessPosting(candidate,page(html(job({validThrough:'not a date'}),apply)),now).status,'unverified');
});
test('only positive evidence for the matching posting qualifies, with date-only deadlines inclusive',()=>{
  assert.equal(assessPosting(candidate,page(html(job({validThrough:'2026-11-13'}))),now).status,'active');
  assert.equal(assessPosting(candidate,page(html({'@graph':[job()]},apply)),now).status,'active');
  assert.equal(assessPosting(candidate,page(apply),now).status,'active');
  assert.equal(assessPosting(candidate,page(apply+'<a href="/jobs/other/apply">Apply now</a>'),now).status,'unverified');
  assert.equal(assessPosting(candidate,page(html(job({title:'Unrelated occupation',validThrough:'2027-01-01'}),apply)),now).status,'unverified');
  assert.equal(assessPosting(candidate,page('<h1>Careers</h1><p>Fixture Employer Bookkeeper</p><a href="/all/apply">Apply now</a>'),now).status,'unverified');
  assert.equal(assessPosting(candidate,page(html(job({hiringOrganization:{name:'Another employer'},validThrough:'2027-01-01'}))),now).status,'unverified');
  assert.equal(assessPosting(candidate,page('Verify you are human '+apply),now).status,'unverified');
  for(const status of [403,429,500,503])assert.equal(assessPosting(candidate,page('',status),now).status,'unverified');
});
test('lookup failures fail closed, never fetch unsafe URLs, and preserve response ordering',async()=>{
  const visited:string[]=[];
  const rows=await checkPostings([candidate,{...candidate,url:'https://127.0.0.1/'},{...candidate,url:'https://employer.com/timeout'}],async url=>{visited.push(url);if(url.endsWith('timeout'))throw new Error('private transport detail');return page(html(job({validThrough:'2027-01-01'})));},now);
  assert.deepEqual(rows.map(row=>row.status),['active','unverified','unverified']);assert.equal(visited.length,2);assert.doesNotMatch(JSON.stringify(rows),/private transport detail/);
  await assert.rejects(checkPostings(Array(25).fill(candidate)));
});
test('per-search checks are cached and budget-limited, and unavailable checkers do not certify jobs',async()=>{
  let total=0;const verifier=createPostingVerifier(async rows=>{total+=rows.length;return rows.map(()=>({status:'active',reason:'posting_evidence',checked_at:new Date(now).toISOString()}));});
  const rows=Array.from({length:24},(_,i)=>({...candidate,url:candidate.url+'/'+i}));
  await verifier.check(rows);await verifier.check(rows);assert.equal(total,24);
  const more=await verifier.check(Array.from({length:24},(_,i)=>({...candidate,url:candidate.url+'/next'+i})));assert.equal(total,36);assert.equal(more.filter(row=>row.status==='active').length,12);
  const failed=createPostingVerifier(async()=>{throw new Error('provider details');});assert.equal((await failed.check([candidate]))[0].status,'unverified');assert.equal(failed.summary().excluded_unverified,1);
});
test('OpenAI-only discovery drops inactive listings before the result limit and preserves evidence',async()=>{
  let modelCalls=0;const requested:string[]=[];
  const verifier=createPostingVerifier(async rows=>{requested.push(...rows.map(row=>row.url));return rows.map(row=>({status:row.url.endsWith('/closed')?'closed':row.url.endsWith('/blocked')?'unverified':'active',reason:row.url.endsWith('/closed')?'expired':row.url.endsWith('/blocked')?'blocked':'posting_evidence',checked_at:new Date(now).toISOString()}));});
  const context={ai:{generate:async()=>{modelCalls++;return {opportunities:[{...candidate,url:candidate.url+'/closed'},{...candidate,url:candidate.url+'/blocked'},...Array.from({length:14},(_,i)=>({...candidate,url:candidate.url+'/active'+i}))]};}},jobs:{linkedInConfigured:false,fetcher:async()=>{throw new Error('Location not requested.');},...verifier}};
  const result=await searchListings(context,{skills:'Bookkeeping',experience_level:'entry_level',work_mode:'any',job_type:'any',location:''},'combined');
  assert.equal(result.opportunities.length,12);assert.equal(modelCalls,1);assert.equal(requested.length,16);
  assert.deepEqual(result.sources,[{provider:'web_search',status:'searched'}]);
  assert.ok(result.opportunities.every(row=>row.availability_status==='checked'&&!/closed|blocked/.test(row.url)));
  assert.deepEqual(result.availability,{checked:16,excluded_closed:1,excluded_unverified:1});
});
test('all closed or unverified results produce an honest empty set and deduplicate expanded checks',async()=>{
  let modelCalls=0,checked=0;const verifier=createPostingVerifier(async rows=>{checked+=rows.length;return rows.map(()=>({status:'closed',reason:'closed_notice',checked_at:new Date(now).toISOString()}));});
  const context={ai:{generate:async()=>{modelCalls++;return {opportunities:[candidate]};}},jobs:{linkedInConfigured:false,fetcher:async()=>{throw new Error();},...verifier}};
  const result=await searchListings(context,{skills:'Bookkeeping',experience_level:'entry_level',work_mode:'any',job_type:'any',location:''},'combined');
  assert.deepEqual(result.opportunities,[]);assert.equal(modelCalls,2);assert.equal(checked,1);assert.equal(result.availability.excluded_closed,1);
});

test('HTTPS transport pins DNS on each redirect and never forwards credentials',async()=>{
  const {readPosting}=await import('../server/integrations/job-availability.ts');
  const {EventEmitter}=await import('node:events');const {Readable}=await import('node:stream');
  const hosts:string[]=[];let requests=0;
  const resolve=async(host:string)=>{hosts.push(host);if(host==='private.employer.com')throw new Error('Unsafe address.');return {address:'8.8.8.8',family:4};};
  const requester=((url:any,options:any,callback:any)=>{
    assert.equal(options.agent,false);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
    options.lookup(url.hostname,{},(error:any,address:any,family:any)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
    const req:any=new EventEmitter();req.destroy=(error:any)=>{req.emit('error',error);req.emit('close');return req;};
    req.end=()=>queueMicrotask(()=>{requests++;const response:any=Readable.from([apply]);response.statusCode=requests===1?302:200;response.headers=requests===1?{location:'https://public.employer.com/job'}:{'content-type':'text/html'};response.once('end',()=>req.emit('close'));callback(response);});return req;
  }) as any;
  const result=await readPosting(candidate.url,{resolve:resolve as any,request:requester});assert.equal(result.status,200);assert.deepEqual(hosts,['careers.employer.com','public.employer.com']);
  requests=0;const hostile=((_url:any,_options:any,callback:any)=>{const req:any=new EventEmitter();req.destroy=(error:any)=>{req.emit('error',error);req.emit('close');return req;};req.end=()=>queueMicrotask(()=>{const res:any=Readable.from([]);res.statusCode=302;res.headers={location:'https://private.employer.com/job'};res.once('end',()=>req.emit('close'));callback(res);});return req;}) as any;
  await assert.rejects(readPosting(candidate.url,{resolve:resolve as any,request:hostile}),/Unsafe address/);
});
test('malformed HTML and form-based applications are parsed without executing page code',()=>{
  const form='<h1>Bookkeeper</h1><p>Fixture Employer</p><form action="/jobs/123/apply"><button>Apply now</button></form><script>throw new Error("do not run")</script>';
  assert.equal(assessPosting(candidate,page(form),now).status,'active');
  assert.equal(assessPosting(candidate,page('<script>invalid '+ '<'.repeat(10000)),now).status,'unverified');
});
