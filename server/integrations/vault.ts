import { createCipheriv,createDecipheriv,randomBytes,randomUUID } from 'node:crypto';
import { readFileSync,mkdirSync,writeFileSync,lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database } from '../database.ts';
import { ApiError } from '../errors.ts';

export class SecretBox {
  private key: Buffer;
  constructor(key: Buffer) { if(key.length!==32)throw new Error('Use a 32-byte vault key.');this.key=key; }
  seal(value: unknown) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
  }
  open(value: string): any {
    try {
      const bytes=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));
      decipher.setAuthTag(bytes.subarray(12,28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
    } catch { throw new ApiError(503,'VAULT_UNAVAILABLE','Private credentials could not be read. Check the installation key.'); }
  }
}
export function loadSecretBox(env: Record<string,string|undefined>, path: string, hosted=false) {
  if(env.AVERA_VAULT_KEY) {
    const key=Buffer.from(env.AVERA_VAULT_KEY,'base64');
    if(key.length!==32)throw new Error('Invalid AVERA_VAULT_KEY.');
    return new SecretBox(key);
  }
  if(hosted)throw new Error('Hosted integrations require AVERA_VAULT_KEY.');
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  try {writeFileSync(path,randomBytes(32),{flag:'wx',mode:0o600});}
  catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  if(!lstatSync(path).isFile())throw new Error('Invalid vault key file.');
  return new SecretBox(readFileSync(path));
}
export class PrivateVault {
  db: Database; box: SecretBox;
  constructor(db: Database,box: SecretBox){this.db=db;this.box=box;}
  async list(owner: string,collection: string) {
    const rows=await this.db.transaction(tx=>tx.query('SELECT * FROM private_data WHERE owner_id=$1 AND collection=$2 LIMIT 1001',[owner,collection]));
    if(rows.length>1000)throw new ApiError(413,'RECORD_LIMIT','Too many private connection records.');
    return rows.map(row=>({...this.box.open(row.ciphertext),owner_id:owner,id:row.id}));
  }
  async put(owner: string,collection: string,key: string,value: unknown) {
    const id=randomUUID(),ciphertext=this.box.seal(value);
    const rows=await this.db.transaction(tx=>tx.query(`INSERT INTO private_data(owner_id,collection,natural_key,id,ciphertext) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(owner_id,collection,natural_key) DO UPDATE SET ciphertext=excluded.ciphertext RETURNING id`,[owner,collection,key,id,ciphertext]));
    return rows[0].id as string;
  }
  async removeVersion(owner:string,collection:string,id:string,version:string){
    await this.db.transaction(async tx=>{
      const rows=await tx.query('SELECT ciphertext FROM private_data WHERE owner_id=$1 AND collection=$2 AND id=$3'+(this.db.dialect==='postgres'?' FOR UPDATE':''),[owner,collection,id]);
      if(rows[0]&&this.box.open(rows[0].ciphertext).version===version)await tx.query('DELETE FROM private_data WHERE owner_id=$1 AND collection=$2 AND id=$3',[owner,collection,id]);
    });
  }
  async remove(owner: string,collection: string,id: string) {
    await this.db.transaction(tx=>tx.query('DELETE FROM private_data WHERE owner_id=$1 AND collection=$2 AND id=$3',[owner,collection,id]));
  }
}
