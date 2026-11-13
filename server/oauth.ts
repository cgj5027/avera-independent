import { randomBytes,randomUUID,createHash,createPublicKey,verify } from 'node:crypto';
import type { Database } from './database.ts';
import type { AuthService } from './auth.ts';
import type { SecretBox } from './integrations/vault.ts';
import { fetchJson } from './integrations/network.ts';
import { ApiError,invalid } from './errors.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('base64url');
export function googleAuth(db:Database,auth:AuthService,box:SecretBox,env:Record<string,string|undefined>,fetcher:typeof fetch=fetch){
  const enabled=!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);
  return {enabled,async begin(origin:string,returnTo:string){
    if(!enabled)throw new ApiError(503,'OAUTH_UNAVAILABLE','Google sign-in is not configured.');
    const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    if(!returnTo.startsWith('/')||returnTo.startsWith('//')||/[\\\r\n]/.test(returnTo))returnTo='/';
    await db.transaction(tx=>tx.query('DELETE FROM auth_challenges WHERE expires_at<$1',[Date.now()]));
    await db.transaction(tx=>tx.query('INSERT INTO auth_challenges(token_hash,kind,payload,expires_at) VALUES($1,$2,$3,$4)',[hash(state),'google',box.seal({nonce,verifier,returnTo,origin}),Date.now()+10*60000]));
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for(const [key,value] of Object.entries({client_id:env.GOOGLE_CLIENT_ID!,redirect_uri:origin+'/api/v1/auth/google/callback',response_type:'code',scope:'openid email profile',state,nonce,code_challenge:hash(verifier),code_challenge_method:'S256'}))url.searchParams.set(key,value);
    return {url:url.href,state};
  },async complete(origin:string,code:string,state:string,cookie:string|undefined){
    if(!enabled||!cookie||cookie!==state||!/^[\w-]{43}$/.test(state)||!code||code.length>4096)invalid('Invalid Google sign-in response.');
    const payload=await db.transaction(async tx=>{
      const rows=await tx.query("SELECT * FROM auth_challenges WHERE token_hash=$1 AND kind='google'"+(db.dialect==='postgres'?' FOR UPDATE':''),[hash(state)]);
      const row=rows[0];if(!row||row.used||Number(row.expires_at)<Date.now())return null;
      await tx.query('UPDATE auth_challenges SET used=1 WHERE token_hash=$1',[row.token_hash]);return box.open(row.payload);
    });
    if(!payload||payload.origin!==origin)invalid('Google sign-in expired. Please try again.');
    const tokens=await fetchJson(fetcher,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!,code,code_verifier:payload.verifier,grant_type:'authorization_code',redirect_uri:origin+'/api/v1/auth/google/callback'})});
    let claims:any;
    try{
      const parts=tokens.id_token.split('.');if(parts.length!==3)throw new Error();
      const header=JSON.parse(Buffer.from(parts[0],'base64url').toString()),value=JSON.parse(Buffer.from(parts[1],'base64url').toString());
      if(header.alg!=='RS256'||typeof header.kid!=='string')throw new Error();
      const jwks=await fetchJson(fetcher,'https://www.googleapis.com/oauth2/v3/certs');
      const jwk=jwks.keys.find((key:any)=>key.kid===header.kid&&key.kty==='RSA');
      if(!jwk||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw new Error();
      if(!['https://accounts.google.com','accounts.google.com'].includes(value.iss)||value.aud!==env.GOOGLE_CLIENT_ID||!Number.isFinite(value.exp)||!Number.isFinite(value.iat)||value.exp<Date.now()/1000||value.iat>Date.now()/1000+60||value.nonce!==payload.nonce||value.email_verified!==true||typeof value.sub!=='string'||value.sub.length>255||typeof value.email!=='string'||!/^\S+@\S+\.\S+$/.test(value.email))throw new Error();claims=value;
    }catch{throw new ApiError(401,'INVALID_OAUTH','Google identity could not be verified.');}
    const id=await db.transaction(async tx=>{
      const existing=await tx.query("SELECT user_id FROM oauth_accounts WHERE provider='google' AND subject=$1",[claims.sub]);if(existing[0])return existing[0].user_id;
      const users=await tx.query('SELECT * FROM users WHERE email=$1',[claims.email.toLowerCase()]);
      // Never silently attach Google to an unverified local account.
      if(users[0]&&!users[0].email_verified)throw new ApiError(409,'ACCOUNT_LINK_REQUIRED','Verify the existing account email before using Google sign-in.');
      const userId=users[0]?.id??randomUUID();
      if(!users[0])await tx.query('INSERT INTO users(id,email,password_hash,display_name,created_at,email_verified,pending_verification) VALUES($1,$2,$3,$4,$5,1,0)',[userId,claims.email.toLowerCase(),'oauth',String(claims.name??'').slice(0,100),new Date().toISOString()]);
      await tx.query("INSERT INTO oauth_accounts(provider,subject,user_id) VALUES('google',$1,$2)",[claims.sub,userId]);return userId as string;
    });
    return {token:await auth.session(id),returnTo:payload.returnTo};
  }};
}
