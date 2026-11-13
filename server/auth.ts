import { randomBytes, randomUUID, createHash, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { Database, Row } from './database.ts';
import { ApiError, invalid } from './errors.ts';
import { claimQuota } from './integrations/quota.ts';
import type { IntegrationRuntime } from './integrations/runtime.ts';
import { object } from './validation.ts';

const duration=8*60*60*1000;
const digest=(value: string)=>createHash('sha256').update(value).digest('hex');
async function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error ? reject(error):resolve(key)));
}
function credentials(input: unknown) {
  const value=object(input);
  if (Object.keys(value).some(key=>key!=='email'&&key!=='password')) invalid('Unknown account field.');
  if (typeof value.email !== 'string' || value.email.length>254 || /[\u0000-\u001f\u007f]/.test(value.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) ||
    typeof value.password !== 'string' || value.password.length<12 || value.password.length>128) invalid('Use a valid email and a password of 12 to 128 characters.');
  return {email:value.email.trim().toLowerCase(),password:value.password};
}
function publicUser(row: Row) { return { id:row.id,email:row.id.startsWith('sample:')?'':row.email,display_name:row.display_name,role:row.id.startsWith('sample:')?'sample':'user',is_sample:row.id.startsWith('sample:') }; }
export class AuthService {
  db: Database;
  private attempts=new Map<string,{count:number;expires:number}>();
  integrations?: IntegrationRuntime; origin?:string;
  constructor(db: Database, integrations?:IntegrationRuntime) { this.db=db;this.integrations=integrations; }
  limit(key: string) {
    const now=Date.now();
    for (const [k,v] of this.attempts) if (v.expires<now) this.attempts.delete(k);
    const item=this.attempts.get(key) ?? {count:0,expires:now+60000};
    if (++item.count>20 || (!this.attempts.has(key) && this.attempts.size>=1000)) throw new ApiError(429,'REQUEST_LIMITED','Please wait before trying again.');
    this.attempts.set(key,item);
  }
  async session(userId: string) {
    const token=randomBytes(32).toString('base64url');
    await this.db.transaction(async tx => {
      await tx.query('DELETE FROM sessions WHERE expires_at<$1',[Date.now()]);
      await tx.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[digest(token),userId,Date.now()+duration]);
    });
    return token;
  }
  async register(input: unknown) {
    const {email,password}=credentials(input), salt=randomBytes(16).toString('hex');
    const hash=`${salt}:${(await derive(password,salt)).toString('hex')}`, id=randomUUID();
    await this.db.transaction(tx=>tx.query('INSERT INTO users(id,email,password_hash,display_name,created_at,pending_verification) VALUES($1,$2,$3,$4,$5,$6)',[id,email,hash,'',new Date().toISOString(),this.integrations?.authEmail?1:0]));
    if(this.integrations?.authEmail){await this.resend(email);return {token:undefined,data:{requires_verification:true}};}
    return {token:await this.session(id),data:{requires_verification:false}};
  }
  async signIn(input: unknown) {
    const {email,password}=credentials(input);
    const rows=await this.db.transaction(tx=>tx.query('SELECT * FROM users WHERE email=$1',[email]));
    const [salt,expected]=(rows[0]?.password_hash?.includes(':') ? rows[0].password_hash : `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual=await derive(password,salt);
    if (!rows.length || Buffer.from(expected,'hex').length!==actual.length || !timingSafeEqual(actual,Buffer.from(expected,'hex'))) throw new ApiError(401,'AUTH_REQUIRED','Email or password was not recognized.');
    if(rows[0].pending_verification){await this.resend(email);throw new ApiError(403,'EMAIL_VERIFICATION_REQUIRED','Verify your email using the code sent. Open Create account to enter it.');}
    return {token:await this.session(rows[0].id),data:publicUser(rows[0])};
  }
  async current(token: string | undefined) {
    if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new ApiError(401,'AUTH_REQUIRED','Sign in to continue.');
    const rows=await this.db.transaction(tx=>tx.query(`SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id
      WHERE sessions.token_hash=$1 AND sessions.expires_at>$2`,[digest(token),Date.now()]));
    if (!rows.length) throw new ApiError(401,'AUTH_REQUIRED','Sign in to continue.');
    return publicUser(rows[0]);
  }
  /** Account-free samples use an unguessable, expiring cookie identity, never a shared owner. */
  async startSample(token?:string) {
    if(token){try{const user=await this.current(token);if(user.is_sample)return {token,data:user};}catch{/* Expired sample session. */}}
    const id='sample:'+randomUUID();
    await this.db.transaction(async tx=>{
      // Remove expired guest-only data. Authenticated owners are never selected.
      const stale=await tx.query("SELECT id FROM users WHERE id LIKE 'sample:%' AND created_at<$1 AND NOT EXISTS (SELECT 1 FROM sessions WHERE user_id=users.id AND expires_at>$2)",[new Date(Date.now()-duration).toISOString(),Date.now()]);
      for(const row of stale){
        for(const table of ['records','changes','feedback','sample_workspaces','ai_consent'])await tx.query(`DELETE FROM ${table} WHERE owner_id=$1`,[row.id]);
        await tx.query('DELETE FROM sessions WHERE user_id=$1',[row.id]);
        await tx.query('DELETE FROM users WHERE id=$1',[row.id]);
      }
      await tx.query('INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES($1,$2,$3,$4,$5)',[id,randomUUID()+'@sample.invalid','sample-only','Sample visitor',new Date().toISOString()]);
    });
    const created=await this.session(id);return {token:created,data:await this.current(created)};
  }
  async signOut(token: string | undefined) {
    if (token) await this.db.transaction(tx=>tx.query('DELETE FROM sessions WHERE token_hash=$1',[digest(token)]));
  }
  async resend(email:unknown) {
    await this.pruneChallenges();
    const normalized=this.email(email);
    if(!this.integrations?.authEmail)throw new ApiError(503,'EMAIL_UNAVAILABLE','Email verification is not configured.');
    await claimQuota(this.db,normalized,'verification-email',3,15*60000);
    const users=await this.db.transaction(tx=>tx.query('SELECT * FROM users WHERE email=$1',[normalized]));
    if(!users[0]||users[0].id.startsWith('sample:')||users[0].email_verified)return {sent:true};
    const code=String(randomInt(100000,1000000)),salt=randomBytes(16).toString('hex');
    await this.db.transaction(tx=>tx.query(`INSERT INTO auth_challenges(token_hash,kind,user_id,payload,expires_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(token_hash) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,attempts=0,used=0`,[digest('verify:'+normalized),'verify',users[0].id,this.integrations!.vault.box.seal({salt,hash:digest(salt+code)}),Date.now()+10*60000]));
    await this.integrations.queueMail(users[0].id,'verification',{to:normalized,subject:'Avera verification code',text:'Your Avera verification code is '+code+'. It expires in 10 minutes.'},10*60000);
    return {sent:true};
  }
  private async pruneChallenges(){await this.db.transaction(tx=>tx.query('DELETE FROM auth_challenges WHERE expires_at<$1',[Date.now()]));}
  private email(value:unknown){if(typeof value!=='string'||value.length>254||/[\u0000-\u0020\u007f]/.test(value)||!/^[^@]+@[^@]+\.[^@]+$/.test(value))invalid('Enter a valid email.');return value.toLowerCase();}
  async verify(input:any){
    const email=this.email(input.email);
    await claimQuota(this.db,email,'verify-attempt',10,15*60000);
    const id=await this.db.transaction(async tx=>{
      const rows=await tx.query('SELECT * FROM auth_challenges WHERE token_hash=$1'+(this.db.dialect==='postgres'?' FOR UPDATE':''),[digest('verify:'+email)]);
      const row=rows[0];if(!row||row.used||Number(row.expires_at)<Date.now()||row.attempts>=5)return null;
      await tx.query('UPDATE auth_challenges SET attempts=attempts+1 WHERE token_hash=$1',[row.token_hash]);
      const payload=this.integrations!.vault.box.open(row.payload);
      if(typeof input.otpCode!=='string'||digest(payload.salt+input.otpCode)!==payload.hash)return null;
      await tx.query('UPDATE auth_challenges SET used=1 WHERE token_hash=$1',[row.token_hash]);
      await tx.query('UPDATE users SET email_verified=1,pending_verification=0 WHERE id=$1',[row.user_id]);return row.user_id as string;
    });
    if(!id)throw new ApiError(400,'INVALID_CODE','The code is invalid or expired. Request another code.');
    return {token:await this.session(id),data:{verified:true}};
  }
  async requestReset(email:unknown,origin:string){
    await this.pruneChallenges();
    const normalized=this.email(email);
    if(!this.integrations?.authEmail)throw new ApiError(503,'EMAIL_UNAVAILABLE','Email recovery is not configured.');
    await claimQuota(this.db,normalized,'reset-email',3,15*60000);
    const users=await this.db.transaction(tx=>tx.query('SELECT * FROM users WHERE email=$1',[normalized]));
    if(users[0]&&!users[0].id.startsWith('sample:')&&!users[0].pending_verification){
      const token=randomBytes(32).toString('base64url');
      await this.db.transaction(async tx=>{await tx.query("DELETE FROM auth_challenges WHERE user_id=$1 AND kind='reset'",[users[0].id]);await tx.query('INSERT INTO auth_challenges(token_hash,kind,user_id,payload,expires_at) VALUES($1,$2,$3,$4,$5)',[digest(token),'reset',users[0].id,'{}',Date.now()+30*60000]);});
      await this.integrations.queueMail(users[0].id,'password-reset',{to:normalized,subject:'Reset your Avera password',text:'Reset your Avera password within 30 minutes: '+origin+'/reset-password?token='+token},30*60000);
    }
    return {sent:true};
  }
  async reset(input:any){
    const password=input.newPassword,token=input.resetToken;
    if(typeof password!=='string'||password.length<12||password.length>128||typeof token!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(token))invalid('Use a valid reset link and a password of 12 to 128 characters.');
    const salt=randomBytes(16).toString('hex'),hash=salt+':'+(await derive(password,salt)).toString('hex');
    const saved=await this.db.transaction(async tx=>{
      const rows=await tx.query("SELECT * FROM auth_challenges WHERE token_hash=$1 AND kind='reset'"+(this.db.dialect==='postgres'?' FOR UPDATE':''),[digest(token)]);
      const row=rows[0];if(!row||row.used||Number(row.expires_at)<Date.now())return false;
      await tx.query('UPDATE auth_challenges SET used=1 WHERE token_hash=$1',[row.token_hash]);
      await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,row.user_id]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1',[row.user_id]);return true;
    });
    if(!saved)throw new ApiError(400,'INVALID_RESET','The reset link is invalid or expired.');return {reset:true};
  }
  async update(userId: string, input: unknown) {
    const fields=object(input);
    if (Object.keys(fields).length!==1 || typeof fields.display_name !== 'string' || !fields.display_name.trim() || /[\u0000-\u001f\u007f]/.test(fields.display_name) || fields.display_name.trim().length>100) invalid('Enter a name of up to 100 characters.');
    const rows=await this.db.transaction(tx=>tx.query('UPDATE users SET display_name=$1 WHERE id=$2 RETURNING *',[fields.display_name.trim(),userId]));
    return publicUser(rows[0]);
  }
}
