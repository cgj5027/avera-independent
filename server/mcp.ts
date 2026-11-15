import { createHash,randomBytes,randomUUID } from 'node:crypto';
import type { Transaction } from './database.ts';
import { RecordStore } from './store.ts';
import { object } from './validation.ts';
import { ApiError,invalid } from './errors.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('base64url');
const token=()=>randomBytes(32).toString('base64url');
const scope='avera:read';
const collections=['Account','Bill','BudgetCategory','ForecastRecord','Goal','GoalContribution','HouseholdProfile','IncomeSource','JobProfile','MortgageRecord','PlaidItem','Property','Transaction'];
const tools=[{name:'avera_list_records',title:'Read personal Avera records',description:'Read your personal financial and opportunity records, up to 50 per page. Saved samples, private files and provider credentials are excluded.',inputSchema:{type:'object',properties:{collection:{type:'string',enum:collections},limit:{type:'integer',minimum:1,maximum:50},cursor:{type:'string',maxLength:2000}},required:['collection'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},{name:'avera_get_record',title:'Read one personal Avera record',description:'Read a single personal record belonging to you. Cannot change records, move money or access provider credentials.',inputSchema:{type:'object',properties:{collection:{type:'string',enum:collections},id:{type:'string',maxLength:100}},required:['collection','id'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}];
const permissions=hash(JSON.stringify(tools));
function redirect(value:unknown){
 if(typeof value!=='string'||value.length>2000||/[\u0000-\u0020\u007f]/.test(value))invalid('Invalid client redirect URI.');
 try{
  const url=new URL(value),hostname=url.hostname.replace(/\.$/,'').toLowerCase();
  const local=['localhost','127.0.0.1','[::1]'].includes(hostname);
  if(url.username||url.password||url.hash||!url.hostname||(local&&/^\/api(?:\/|$)/.test(decodeURIComponent(url.pathname)))||(url.protocol!=='https:'&&!(local&&url.protocol==='http:')))throw Error();
  // OAuth compares the exact registered URI, including a root URI without a slash.
  return value;
 }catch{invalid('Use an HTTPS redirect URI, or HTTP loopback outside /api for a local client.');}
}
function clean(row:Record<string,any>){return Object.fromEntries(Object.entries(row).filter(([key])=>!['item_id','plaid_item_id','plaid_account_id','plaid_transaction_id','import_key'].includes(key)));}
export class McpService {
 store:RecordStore; origin:()=>string; now:()=>number;
 constructor(store:RecordStore,origin:()=>string,now:()=>number=Date.now){this.store=store;this.origin=origin;this.now=now;}
 resource(){return this.origin()+'/mcp';}
 metadata(){return {issuer:this.origin(),authorization_endpoint:this.origin()+'/oauth/authorize',token_endpoint:this.origin()+'/oauth/token',registration_endpoint:this.origin()+'/oauth/register',revocation_endpoint:this.origin()+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:[scope]};}
 protectedMetadata(){return {resource:this.resource(),authorization_servers:[this.origin()],scopes_supported:[scope],bearer_methods_supported:['header'],resource_name:'Avera personal records (read only)'};}
 private lock(){return this.store.db.dialect==='postgres'?' FOR UPDATE':'';}
 async register(input:unknown){
  const value=object(input);
  if(typeof value.client_name!=='string'||!value.client_name.trim()||value.client_name.length>100||/[\u0000-\u001f]/.test(value.client_name)||!Array.isArray(value.redirect_uris)||value.redirect_uris.length<1||value.redirect_uris.length>5||value.token_endpoint_auth_method&&value.token_endpoint_auth_method!=='none'||value.grant_types&&(!Array.isArray(value.grant_types)||!value.grant_types.includes('authorization_code')||value.grant_types.some((g:any)=>!['authorization_code','refresh_token'].includes(g)))||value.response_types&&JSON.stringify(value.response_types)!==JSON.stringify(['code']))invalid('Use a named public OAuth client with authorization-code/refresh-token grants and PKCE.');
  const uris=[...new Set(value.redirect_uris.map(redirect))];
  return this.store.db.transaction(async tx=>{
   // A shared advisory lock bounds concurrent registrations across hosted processes.
   if(this.store.db.dialect==='postgres')await tx.query('SELECT pg_advisory_xact_lock(718305)');
   const count=await tx.query('SELECT COUNT(*) AS n FROM mcp_clients');if(Number(count[0].n)>=1000)throw new ApiError(429,'CLIENT_LIMIT','The client registration limit has been reached. Contact this installation administrator.');
   const id=token(),metadata={client_id:id,client_name:value.client_name.trim(),redirect_uris:uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
   await tx.query('INSERT INTO mcp_clients(client_id,metadata,created_at) VALUES($1,$2,$3)',[id,JSON.stringify(metadata),this.now()]);return metadata;
  });
 }
 private async client(tx:Transaction,id:any){if(typeof id!=='string'||!/^[\w-]{43}$/.test(id))throw new ApiError(400,'invalid_client','Unknown OAuth client.');const rows=await tx.query('SELECT metadata FROM mcp_clients WHERE client_id=$1',[id]);if(!rows[0])throw new ApiError(400,'invalid_client','Unknown OAuth client.');return JSON.parse(rows[0].metadata);}
 async authorize(params:URLSearchParams){
  for(const key of params.keys())if(params.getAll(key).length!==1)invalid('Duplicate authorization parameter.');
  const input=Object.fromEntries(params),uri=redirect(input.redirect_uri);
  if(input.response_type!=='code'||input.code_challenge_method!=='S256'||!/^[\w-]{43}$/.test(input.code_challenge??'')||!input.state||input.state.length>512||(input.scope??scope)!==scope||input.resource!==this.resource())invalid('Authorization requires PKCE S256, state, avera:read scope and this MCP resource.');
  return this.store.db.transaction(async tx=>{
   const client=await this.client(tx,input.client_id);if(!client.redirect_uris.includes(uri))invalid('The redirect URI is not registered for this client.');
   await tx.query('DELETE FROM mcp_requests WHERE expires_at<$1',[this.now()]);
   const handle=token();await tx.query('INSERT INTO mcp_requests(handle_hash,payload,expires_at,used) VALUES($1,$2,$3,0)',[hash(handle),JSON.stringify({...input,scope,permissions,redirect_uri:uri,client_name:client.client_name}),this.now()+10*60000]);
   return this.origin()+'/oauth/consent?ctx='+encodeURIComponent(handle);
  });
 }
 private async request(tx:Transaction,handle:unknown){if(typeof handle!=='string'||!/^[\w-]{43}$/.test(handle))invalid('Invalid authorization handle.');const rows=await tx.query('SELECT * FROM mcp_requests WHERE handle_hash=$1'+this.lock(),[hash(handle)]);if(!rows[0]||rows[0].used||Number(rows[0].expires_at)<this.now())throw new ApiError(404,'AUTHORIZATION_EXPIRED','Reconnect from your AI client to start a new authorization.');return rows[0];}
 async info(handle:unknown,user?:{id:string;is_sample?:boolean;email?:string}){
  return this.store.db.transaction(async tx=>{const request=await this.request(tx,handle);if(!user||user.is_sample)return {authenticated:false,login_path:'/login'};
   if(request.owner_id&&request.owner_id!==user.id)throw new ApiError(403,'WRONG_ACCOUNT','This authorization belongs to another signed-in account.');
   await tx.query('UPDATE mcp_requests SET owner_id=$1 WHERE handle_hash=$2',[user.id,request.handle_hash]);const data=JSON.parse(request.payload);if(data.permissions!==permissions)throw new ApiError(409,'PERMISSIONS_CHANGED','Reconnect from your AI client; available permissions changed.');
   return {authenticated:true,client_name:data.client_name,app_name:'Avera',account_email:user.email,redirect_origin:new URL(data.redirect_uri).origin,login_path:'/login',tools};
  });
 }
 async respond(handle:unknown,action:unknown,user:{id:string;is_sample?:boolean}){
  if(user.is_sample)throw new ApiError(403,'SAMPLE_ONLY','Sign in to a personal account to authorize an AI client.');if(!['approve','deny'].includes(String(action)))invalid('Choose approve or deny.');
  return this.store.db.transaction(async tx=>{
   const request=await this.request(tx,handle);if(request.owner_id!==user.id)throw new ApiError(403,'WRONG_ACCOUNT','Review this request with the same signed-in account before approving.');
   const data=JSON.parse(request.payload);if(data.permissions!==permissions)throw new ApiError(409,'PERMISSIONS_CHANGED','Reconnect from your AI client; available permissions changed.');const client=await this.client(tx,data.client_id);if(!client.redirect_uris.includes(data.redirect_uri))throw new ApiError(409,'CLIENT_CHANGED','Reconnect from the AI client; its registered redirect changed.');
   await tx.query('UPDATE mcp_requests SET used=1 WHERE handle_hash=$1',[request.handle_hash]);const url=new URL(data.redirect_uri);url.searchParams.set('state',data.state);
   if(action==='deny'){url.searchParams.set('error','access_denied');return {redirect_url:url.href};}
   const code=token(),id=randomUUID();await tx.query('INSERT INTO mcp_grants(id,owner_id,client_id,resource,permissions_hash,created_at,revoked) VALUES($1,$2,$3,$4,$5,$6,0)',[id,user.id,data.client_id,this.resource(),permissions,this.now()]);
   await tx.query('INSERT INTO mcp_codes(code_hash,grant_id,redirect_uri,challenge,resource,expires_at,used) VALUES($1,$2,$3,$4,$5,$6,0)',[hash(code),id,data.redirect_uri,data.code_challenge,data.resource,this.now()+60000]);url.searchParams.set('code',code);return {redirect_url:url.href};
  });
 }
 private async issue(tx:Transaction,grant:string){
  const access=token(),refresh=token();for(const [value,kind,duration]of [[access,'access',3600000],[refresh,'refresh',30*86400000]] as const)await tx.query('INSERT INTO mcp_tokens(token_hash,grant_id,kind,expires_at,used) VALUES($1,$2,$3,$4,0)',[hash(value),grant,kind,this.now()+duration]);
  return {access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope};
 }
 async exchange(input:Record<string,string>){
  if(input.resource!==this.resource())throw new ApiError(400,'invalid_target','The token must target this MCP resource.');
  const result=await this.store.db.transaction(async tx=>{
   await this.client(tx,input.client_id);
   let row:any;
   if(input.grant_type==='authorization_code'){
    if(!/^[\w-]{43}$/.test(input.code??'')||!/^[\w.~-]{43,128}$/.test(input.code_verifier??''))return null;
    const rows=await tx.query('SELECT * FROM mcp_codes WHERE code_hash=$1'+this.lock(),[hash(input.code)]);row=rows[0];
    if(!row||row.redirect_uri!==input.redirect_uri||row.challenge!==hash(input.code_verifier)||row.resource!==this.resource()||Number(row.expires_at)<this.now())return null;
   }else if(input.grant_type==='refresh_token'){
    if(!/^[\w-]{43}$/.test(input.refresh_token??''))return null;
    const rows=await tx.query("SELECT * FROM mcp_tokens WHERE token_hash=$1 AND kind='refresh'"+this.lock(),[hash(input.refresh_token)]);row=rows[0];if(!row||Number(row.expires_at)<this.now())return null;
   }else throw new ApiError(400,'unsupported_grant_type','Use authorization_code or refresh_token.');
   const grants=await tx.query('SELECT * FROM mcp_grants WHERE id=$1'+this.lock(),[row.grant_id]);const grant=grants[0];if(!grant||grant.revoked||grant.client_id!==input.client_id||grant.resource!==this.resource()||grant.permissions_hash!==permissions)return null;
   if(row.used){await tx.query('UPDATE mcp_grants SET revoked=1 WHERE id=$1',[grant.id]);return null;}
   if(input.grant_type==='authorization_code')await tx.query('UPDATE mcp_codes SET used=1 WHERE code_hash=$1',[row.code_hash]);else await tx.query('UPDATE mcp_tokens SET used=1 WHERE token_hash=$1',[row.token_hash]);
   return this.issue(tx,grant.id);
  });
  if(!result)throw new ApiError(400,'invalid_grant','Authorization expired, was used, or could not be verified. Reconnect your AI client.');return result;
 }
 async authenticate(header:unknown){
  if(typeof header!=='string'||!/^Bearer [\w-]{43}$/.test(header))throw new ApiError(401,'invalid_token','Use an authorized MCP bearer token.');
  const rows=await this.store.db.transaction(tx=>tx.query("SELECT g.owner_id,g.client_id FROM mcp_tokens t JOIN mcp_grants g ON g.id=t.grant_id JOIN users u ON u.id=g.owner_id WHERE t.token_hash=$1 AND t.kind='access' AND t.expires_at>$2 AND t.used=0 AND g.revoked=0 AND g.resource=$3 AND g.permissions_hash=$4 AND u.pending_verification=0",[hash(header.slice(7)),this.now(),this.resource(),permissions]));
  if(!rows[0])throw new ApiError(401,'invalid_token','The AI client authorization expired or was revoked. Reconnect to Avera.');return rows[0];
 }
 async grants(owner:string){return this.store.db.transaction(async tx=>{const rows=await tx.query('SELECT g.id,g.created_at,c.metadata FROM mcp_grants g JOIN mcp_clients c ON c.client_id=g.client_id WHERE g.owner_id=$1 AND g.revoked=0 ORDER BY g.created_at DESC',[owner]);return {grants:rows.map(row=>({id:row.id,created_at:new Date(Number(row.created_at)).toISOString(),client_name:JSON.parse(row.metadata).client_name}))};});}
 async revoke(owner:string,id:unknown){if(typeof id!=='string')invalid();return this.store.db.transaction(async tx=>{const rows=await tx.query('SELECT id FROM mcp_grants WHERE owner_id=$1 AND id=$2',[owner,id]);if(!rows[0])throw new ApiError(404,'NOT_FOUND','AI client authorization not found.');await tx.query('UPDATE mcp_grants SET revoked=1 WHERE owner_id=$1 AND id=$2',[owner,id]);return {revoked:true};});}
 async revokeToken(input:Record<string,string>){await this.store.db.transaction(async tx=>{await this.client(tx,input.client_id);if(typeof input.token!=='string'||input.token.length>512)return;const rows=await tx.query('SELECT g.id FROM mcp_tokens t JOIN mcp_grants g ON g.id=t.grant_id WHERE t.token_hash=$1 AND g.client_id=$2',[hash(input.token),input.client_id]);if(rows[0])await tx.query('UPDATE mcp_grants SET revoked=1 WHERE id=$1',[rows[0].id]);});return {};}
 async rpc(owner:string,input:unknown){
  const body=object(input),id=body.id??null;const error=(code:number,message:string)=>({jsonrpc:'2.0',id,error:{code,message}});
  if(body.jsonrpc!=='2.0'||typeof body.method!=='string'||!['string','number','undefined'].includes(typeof body.id))return error(-32600,'Invalid JSON-RPC request.');
  if(body.method==='notifications/initialized'&&body.id===undefined)return null;
  if(body.id===undefined)return null;
  if(body.method==='initialize')return {jsonrpc:'2.0',id,result:{protocolVersion:['2025-11-25','2025-06-18','2025-03-26'].includes(body.params?.protocolVersion)?body.params.protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'avera',version:'1.0.0'},instructions:'Read-only access to this user’s personal records. No samples, private files, provider credentials, financial writes or payment actions.'}};
  if(body.method==='ping')return {jsonrpc:'2.0',id,result:{}};
  if(body.method==='tools/list')return {jsonrpc:'2.0',id,result:{tools}};
  if(body.method!=='tools/call')return error(-32601,'Method not found.');
  const params=body.params;
  try{
   if(!params||!['avera_list_records','avera_get_record'].includes(params.name))return error(-32602,'Unknown tool.');const args=object(params.arguments);
   const allowed=params.name==='avera_list_records'?['collection','limit','cursor']:['collection','id'];if(Object.keys(args).some(key=>!allowed.includes(key))||!collections.includes(args.collection))return error(-32602,'Invalid tool arguments.');
   let result;
   if(params.name==='avera_list_records'){
    if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>50)||args.cursor!==undefined&&(typeof args.cursor!=='string'||args.cursor.length>2000))return error(-32602,'Invalid page.');
    const data=await this.store.list(owner,args.collection,{$or:[{demo_profile:''},{demo_profile:{$exists:false}},{demo_profile:null}]},{limit:args.limit??25,...(args.cursor?{cursor:args.cursor}:{})});result={...data,items:data.items.map(clean)};
   }else{if(typeof args.id!=='string'||!/^[\w-]{1,100}$/.test(args.id))return error(-32602,'Invalid record ID.');const row:Record<string,any>=await this.store.get(owner,args.collection,args.id);if(row.demo_profile)throw new ApiError(404,'NOT_FOUND','Personal record not found.');result=clean(row);}
   return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}};
  }catch(e){return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:e instanceof ApiError?e.message:'The record could not be read.'}],isError:true}};}
 }
}
