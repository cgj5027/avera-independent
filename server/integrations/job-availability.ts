import https from 'node:https';
import { parse } from 'parse5';
import { lookup } from 'node:dns/promises';
import { BlockList,isIP } from 'node:net';

export type Candidate={url:string;title:string;company:string};
export type Check={status:'active'|'closed'|'unverified';checked_at:string;reason:string};
export type Page={status:number;url:string;html:string};
const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['192.88.99.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(ip,bits,'ipv4');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');
for(const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)blocked.addSubnet(ip,bits,'ipv6');
export function publicAddress(address:string){const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!blocked.check(address,'ipv6');}
export function postingUrl(raw:string){
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||isIP(url.hostname.replace(/^\[|\]$/g,''))||url.href.length>2048)throw new Error('Unsafe posting URL.');
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  if(!host.includes('.')||['localhost','local','internal','test','invalid','example','onion'].some(suffix=>host===suffix||host.endsWith('.'+suffix))||host==='example.com'||host.endsWith('.example.com'))throw new Error('Unsafe posting URL.');
  url.hostname=host;url.hash='';return url;
}
export async function resolvePostingHost(host:string,resolver:typeof lookup=lookup){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const addresses=await Promise.race([resolver(host,{all:true,verbatim:true}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout.')),2500);})]);
    if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))throw new Error('Unsafe posting address.');
    return addresses.find(row=>row.family===4)??addresses[0];
  }finally{if(timer)clearTimeout(timer);}
}
/** Public GET only: pinned DNS, TLS validation, bounded redirects/time/bytes, no cookies or provider keys. */
export async function readPosting(raw:string,dependencies:{resolve?:typeof resolvePostingHost;request?:typeof https.request}={}):Promise<Page>{
  const deadline=Date.now()+8000;
  let url=postingUrl(raw);
  for(let redirects=0;redirects<=3;redirects++){
    const address=await (dependencies.resolve??resolvePostingHost)(url.hostname);
    const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Posting timeout.');
    const page=await new Promise<Page&{location?:string}>((resolve,reject)=>{
      const request=(dependencies.request??https.request)(url,{method:'GET',agent:false,family:address.family,
        lookup:(_host,_options,callback)=>callback(null,address.address,address.family),
        headers:{Accept:'text/html,application/xhtml+xml','Accept-Encoding':'identity','User-Agent':'Avera/1.0 (job availability check)'}},response=>{
        const status=response.statusCode??0;
        if(status>=300&&status<400){response.resume();resolve({status,url:url.href,html:'',location:response.headers.location});return;}
        if(status!==200){response.resume();resolve({status,url:url.href,html:''});return;}
        const type=response.headers['content-type']??'';
        if(!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(type)||Number(response.headers['content-length']??0)>1024*1024){response.destroy();reject(new Error('Unsupported posting response.'));return;}
        const chunks:Buffer[]=[];let size=0;
        response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){response.destroy();reject(new Error('Posting too large.'));}else chunks.push(Buffer.from(chunk));});
        response.on('error',reject);response.on('end',()=>resolve({status,url:url.href,html:Buffer.concat(chunks).toString('utf8')}));
      });
      const timer=setTimeout(()=>request.destroy(new Error('Posting timeout.')),remaining);
      request.once('close',()=>clearTimeout(timer));request.on('error',reject);request.end();
    });
    if(page.status>=300&&page.status<400){if(!page.location)throw new Error('Missing redirect.');url=postingUrl(new URL(page.location,url).href);continue;}
    return page;
  }
  throw new Error('Too many posting redirects.');
}
function documentData(html:string){
  const root=parse(html),jobs:any[]=[],headings:string[]=[],links:{href:string;text:string}[]=[],forms:{action:string;text:string}[]=[];
  const ignored=new Set(['script','style','noscript','nav','footer','aside']);
  const text=(node:any)=>{const pieces:string[]=[],stack=[node];while(stack.length){const next=stack.pop();if(ignored.has(next.tagName))continue;if(next.nodeName==='#text')pieces.push(next.value);else stack.push(...(next.childNodes??[]).slice().reverse());}return pieces.join(' ').replace(/\s+/g,' ').trim();};
  let nodes=0,jsonNodes=0,scripts=0;
  const walkJson=(value:any,depth=0)=>{if(depth>12||++jsonNodes>1500||!value||typeof value!=='object')return;
    if([value['@type']].flat().some(type=>type==='JobPosting'||type==='https://schema.org/JobPosting'))jobs.push(value);
    for(const child of Object.values(value))if(child&&typeof child==='object')Array.isArray(child)?child.forEach(v=>walkJson(v,depth+1)):walkJson(child,depth+1);
  };
  const stack:any[]=[root];
  while(stack.length){
    const node=stack.pop();if(++nodes>20000)throw new Error('Posting document too complex.');
    const attr=(name:string)=>node.attrs?.find((row:any)=>row.name===name)?.value??'';
    if(node.tagName==='script'&&attr('type').toLowerCase().split(';')[0].trim()==='application/ld+json'&&++scripts<=100){try{walkJson(JSON.parse((node.childNodes??[]).map((row:any)=>row.value??'').join('')));}catch{/* Invalid metadata cannot establish availability. */}}
    if(node.tagName==='h1')headings.push(text(node));
    if(node.tagName==='a')links.push({href:attr('href'),text:text(node)});
    if(node.tagName==='form')forms.push({action:attr('action'),text:text(node)});
    if(!ignored.has(node.tagName))stack.push(...(node.childNodes??[]));
  }
  return {visible:text(root),jobs,headings,links,forms};
}
const words=(value:unknown)=>String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
function sameTitle(a:unknown,b:unknown){const left=words(a),right=new Set(words(b));return left.length>0&&left.filter(word=>right.has(word)).length/left.length>=0.8;}
function sameCompany(a:unknown,b:unknown){const clean=(v:unknown)=>words(v).filter(w=>!['inc','llc','ltd','corporation','corp','company'].includes(w)).join(' ');return !!clean(a)&&clean(a)===clean(b);}
function identity(raw:string){const url=postingUrl(raw);for(const key of [...url.searchParams.keys()])if(/^utm_|^(gclid|fbclid)$/i.test(key))url.searchParams.delete(key);url.searchParams.sort();return url.href.replace(/\/$/,'');}
export function assessPosting(candidate:Candidate,page:Page,now=Date.now()):Check{
  const result=(status:Check['status'],reason:string):Check=>({status,reason,checked_at:new Date(now).toISOString()});
  if(page.status===404||page.status===410)return result('closed','removed');
  if(page.status!==200)return result('unverified','inaccessible');
  const {visible,jobs,headings,links,forms}=documentData(page.html);
  if(/\b(?:this\s+(?:job(?:\s+posting)?|position|posting|vacancy)\s+(?:(?:is|was|has(?:\s+been)?)\s+)?(?:now\s+)?(?:closed|expired|filled|no longer available)|no longer accepting applications|(?:job|position|posting|requisition|vacancy) (?:is )?no longer (?:active|open|available)|applications(?: for this (?:job|position))? (?:are|have been) (?:now )?closed|job (?:has been|was) (?:removed|filled)|job you (?:are|were) looking for (?:is|was) (?:not found|no longer available))\b/i.test(visible))return result('closed','closed_notice');
  if(/verify (?:that )?you are human|checking your browser|access denied|enable javascript to continue/i.test(visible))return result('unverified','blocked');
  const exact=jobs.filter(job=>{try{return typeof job.url==='string'&&[candidate.url,page.url].some(url=>identity(url)===identity(job.url));}catch{return false;}});
  const matching=(exact.length?exact:jobs.length===1?jobs:[]).filter(job=>sameTitle(candidate.title,job.title)&&(!job.hiringOrganization?.name||sameCompany(candidate.company,job.hiringOrganization.name)));
  if(jobs.length&&!matching.length)return result('unverified','different_posting');
  const applicationUrls=new Set<string>();
  for(const link of [...links.map(link=>({url:link.href,text:link.text})),...forms.map(form=>({url:form.action,text:form.text}))]){
    if(!/\bapply(?: now| for (?:this|the) (?:job|position))?\b/i.test(link.text)||!link.url||link.url.startsWith('#'))continue;
    try{applicationUrls.add(identity(new URL(link.url,page.url).href));}catch{/* Unsafe application destinations are not evidence. */}
  }
  const apply=applicationUrls.size>0;
  for(const job of matching){
    if(job.validThrough){const raw=String(job.validThrough),expires=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T23:59:59.999Z':raw);if(!Number.isFinite(expires))return result('unverified','invalid_expiry');if(expires<now)return result('closed','expired');}
    if(job.validThrough||apply)return result('active','posting_evidence');
  }
  const heading=headings.some(heading=>sameTitle(candidate.title,heading));
  if(!jobs.length&&headings.length===1&&heading&&applicationUrls.size===1&&sameTitle(candidate.company,visible))return result('active','application_link');
  return result('unverified','no_active_evidence');
}
export async function checkPostings(input:unknown,reader:typeof readPosting=readPosting,now=Date.now()){
  if(!Array.isArray(input)||input.length>24)throw new Error('Invalid posting batch.');
  const output:Check[]=[];
  for(let start=0;start<input.length;start+=6){const batch=await Promise.all(input.slice(start,start+6).map(async candidate=>{
    try{if(typeof candidate?.title!=='string'||!candidate.title.trim()||candidate.title.length>200||typeof candidate.company!=='string'||!candidate.company.trim()||candidate.company.length>200)throw new Error();postingUrl(candidate.url);return assessPosting(candidate,await reader(candidate.url),now);}catch{return {status:'unverified',reason:'lookup_failed',checked_at:new Date(now).toISOString()} as Check;}
  }));output.push(...batch);}return output;
}

/** Per-search budget/cache prevents duplicate checks and unbounded crawling. */
export function createPostingVerifier(invoke:(candidates:Candidate[])=>Promise<Check[]>){
  const cache=new Map<string,Check>(),skipped=new Set<string>();
  const key=(row:Candidate)=>JSON.stringify([row.url,row.title,row.company]);
  return {
    async check(candidates:Candidate[]){
      const fresh=candidates.filter(row=>!cache.has(key(row))).slice(0,Math.max(0,36-cache.size));
      if(fresh.length){
        let checks:Check[];try{checks=await invoke(fresh);}catch{checks=[];}
        for(let index=0;index<fresh.length;index++){
          const raw=checks?.[index];
          const valid=raw&&['active','closed','unverified'].includes(raw.status)&&(raw.status!=='active'||['posting_evidence','application_link'].includes(raw.reason))&&(raw.status!=='closed'||['removed','expired','closed_notice'].includes(raw.reason))&&Number.isFinite(Date.parse(raw.checked_at))&&['removed','inaccessible','closed_notice','blocked','different_posting','invalid_expiry','expired','posting_evidence','application_link','no_active_evidence','lookup_failed'].includes(raw.reason);
          cache.set(key(fresh[index]),valid?raw:{status:'unverified',reason:'lookup_failed',checked_at:new Date().toISOString()});
        }
      }
      return candidates.map(row=>{if(!cache.has(key(row)))skipped.add(key(row));return cache.get(key(row))??{status:'unverified',reason:'check_budget',checked_at:new Date().toISOString()} as Check;});
    },
    summary(){const values=[...cache.values()];return {checked:values.length,excluded_closed:values.filter(row=>row.status==='closed').length,excluded_unverified:values.filter(row=>row.status==='unverified').length+skipped.size};},
  };
}
