import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import type { Database, Row } from './database.ts';
import { ApiError, invalid } from './errors.ts';
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
function publicUser(row: Row) { return { id:row.id,email:row.email,display_name:row.display_name,role:'user' }; }
export class AuthService {
  db: Database;
  private attempts=new Map<string,{count:number;expires:number}>();
  constructor(db: Database) { this.db=db; }
  limit(key: string) {
    const now=Date.now();
    for (const [k,v] of this.attempts) if (v.expires<now) this.attempts.delete(k);
    const item=this.attempts.get(key) ?? {count:0,expires:now+60000};
    if (++item.count>20 || (!this.attempts.has(key) && this.attempts.size>=1000)) throw new ApiError(429,'REQUEST_LIMITED','Please wait before trying again.');
    this.attempts.set(key,item);
  }
  private async session(userId: string) {
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
    await this.db.transaction(tx=>tx.query('INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES($1,$2,$3,$4,$5)',[id,email,hash,'',new Date().toISOString()]));
    return {token:await this.session(id),data:{requires_verification:false}};
  }
  async signIn(input: unknown) {
    const {email,password}=credentials(input);
    const rows=await this.db.transaction(tx=>tx.query('SELECT * FROM users WHERE email=$1',[email]));
    const [salt,expected]=(rows[0]?.password_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual=await derive(password,salt);
    if (!rows.length || !timingSafeEqual(actual,Buffer.from(expected,'hex'))) throw new ApiError(401,'AUTH_REQUIRED','Email or password was not recognized.');
    return {token:await this.session(rows[0].id),data:publicUser(rows[0])};
  }
  async current(token: string | undefined) {
    if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new ApiError(401,'AUTH_REQUIRED','Sign in to continue.');
    const rows=await this.db.transaction(tx=>tx.query(`SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id
      WHERE sessions.token_hash=$1 AND sessions.expires_at>$2`,[digest(token),Date.now()]));
    if (!rows.length) throw new ApiError(401,'AUTH_REQUIRED','Sign in to continue.');
    return publicUser(rows[0]);
  }
  async signOut(token: string | undefined) {
    if (token) await this.db.transaction(tx=>tx.query('DELETE FROM sessions WHERE token_hash=$1',[digest(token)]));
  }
  async update(userId: string, input: unknown) {
    const fields=object(input);
    if (Object.keys(fields).length!==1 || typeof fields.display_name !== 'string' || !fields.display_name.trim() || /[\u0000-\u001f\u007f]/.test(fields.display_name) || fields.display_name.trim().length>100) invalid('Enter a name of up to 100 characters.');
    const rows=await this.db.transaction(tx=>tx.query('UPDATE users SET display_name=$1 WHERE id=$2 RETURNING *',[fields.display_name.trim(),userId]));
    return publicUser(rows[0]);
  }
}
