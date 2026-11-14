import { createCipheriv,createDecipheriv,createHash,randomBytes,scrypt } from 'node:crypto';
import { ApiError,invalid } from '../errors.ts';
export const MAX_ARCHIVE_BYTES=32*1024*1024;
const MAGIC=Buffer.from('AVERA-BACKUP-1\n');
export function sha(value:string|Buffer){return createHash('sha256').update(value).digest('hex');}
export function canonical(value:any):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function phrase(value:unknown):string{
 if(typeof value!=='string'||Buffer.byteLength(value)>1024)invalid('Use a recovery passphrase of at least 16 characters (maximum 1024 bytes).');
 const normalized=value.normalize('NFC');if([...normalized].length<16)invalid('Use a recovery passphrase of at least 16 characters (maximum 1024 bytes).');return normalized;
}

let cryptoQueue:Promise<unknown>=Promise.resolve();let waiting=0;
async function key(pass:string,salt:Buffer):Promise<Buffer>{
 if(waiting>=4)throw new ApiError(429,'RECOVERY_BUSY','Recovery encryption is busy. Please retry shortly.');
 waiting++;
 const result=cryptoQueue.then(()=>new Promise<Buffer>((resolve,reject)=>scrypt(pass,salt,32,{N:131072,r:8,p:1,maxmem:256*1024*1024},(error,derived)=>error?reject(error):resolve(derived))));
 cryptoQueue=result.catch(()=>{});try{return await result;}finally{waiting--;}
}

export async function encryptArchive(document:unknown,passphrase:unknown):Promise<Buffer>{
 const pass=phrase(passphrase),plaintext=Buffer.from(JSON.stringify(document));
 if(plaintext.length>MAX_ARCHIVE_BYTES-128)throw new ApiError(413,'BACKUP_TOO_LARGE','This backup exceeds the 32 MiB portable archive limit.');
 const salt=randomBytes(16),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await key(pass,salt),iv);
 cipher.setAAD(MAGIC);return Buffer.concat([MAGIC,salt,iv,cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
}
export async function decryptArchive(bytes:Buffer,passphrase:unknown):Promise<any>{
 const pass=phrase(passphrase);
 if(bytes.length>MAX_ARCHIVE_BYTES||bytes.length<MAGIC.length+45||!bytes.subarray(0,MAGIC.length).equals(MAGIC))throw new ApiError(400,'INVALID_BACKUP','Choose a supported Avera encrypted backup.');
 try{
  const p=MAGIC.length,salt=bytes.subarray(p,p+16),iv=bytes.subarray(p+16,p+28),decipher=createDecipheriv('aes-256-gcm',await key(pass,salt),iv);
  decipher.setAAD(MAGIC);decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(p+28,-16)),decipher.final()]).toString('utf8'));
 }catch(error){if(error instanceof ApiError&&error.code==='RECOVERY_BUSY')throw error;throw new ApiError(400,'BACKUP_DECRYPTION_FAILED','The passphrase is incorrect or this backup is damaged. No records were changed.');}
}
export function fromBase64(value:unknown,maximum=MAX_ARCHIVE_BYTES){
 if(typeof value!=='string'||value.length>Math.ceil(maximum/3)*4||!value.length)invalid('Choose a backup within the supported size limit.');
 const bytes=Buffer.from(value,'base64');if(bytes.length>maximum||bytes.toString('base64')!==value)invalid('The uploaded file is invalid.');return bytes;
}
