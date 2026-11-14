import { DatabaseSync } from 'node:sqlite';
import { lstat,readdir,readFile,writeFile,mkdir,rm } from 'node:fs/promises';
import { join,dirname,resolve,sep } from 'node:path';
import { decryptArchive,fromBase64,sha } from './archive.ts';
import { invalid } from '../errors.ts';
import { RECOVERY_SCHEMA } from './records.ts';
const safe=(value:any)=>typeof value==='string'&&value.length>0&&value.length<=500&&!/[\\:\u0000-\u001f]/.test(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..');
export async function legacyFiles(root?:string){
 const files:any[]=[];if(!root)return files;
 let bytes=0;
 async function walk(dir:string,prefix:string){
  let entries;try{entries=await readdir(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  for(const name of entries){const file=join(dir,name),s=await lstat(file),path=prefix+name;if(s.isSymbolicLink())invalid('Private-file backups do not follow symbolic links.');if(s.isDirectory())await walk(file,path+'/');else{
   if(!safe(path)||!s.isFile()||s.size>4*1024*1024||files.length>=200)invalid('Private files exceed the supported upgrade-backup limits.');
   const content=await readFile(file);bytes+=content.length;if(bytes>4*1024*1024)invalid('Private files exceed the 4 MiB upgrade-backup allowance.');files.push({path,content_base64:content.toString('base64'),sha256:sha(content)});
  }}
 }
 try{const s=await lstat(resolve(root));if(s.isSymbolicLink()||!s.isDirectory())invalid('Private files must use a regular directory.');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return files;throw error;}
 await walk(resolve(root),'');return files;
}
/** Stage a verified installation snapshot in a new directory. Never overwrite a running installation. */
export async function unpackInstallation(archive:Buffer,key:string,destination:string){
 const doc=await decryptArchive(archive,key);
 if(doc.format!=='avera-installation-sqlite'||doc.version!==1||!Number.isInteger(doc.schema_version)||doc.schema_version<1||doc.schema_version>RECOVERY_SCHEMA||!Array.isArray(doc.files??[])||(doc.files??[]).length>200)invalid('This is not a supported installation snapshot.');
 const database=fromBase64(doc.database_base64,20*1024*1024),files=(doc.files??[]).map((f:any)=>{if(!safe(f.path))invalid('Unsafe backup file path.');const bytes=fromBase64(f.content_base64,4*1024*1024);if(sha(bytes)!==f.sha256)invalid('A private file failed its integrity check.');return {...f,bytes};});
 const out=resolve(destination);await mkdir(dirname(out),{recursive:true,mode:0o700});await mkdir(out,{mode:0o700});
 try{
  const path=join(out,'records.sqlite');await writeFile(path,database,{flag:'wx',mode:0o600});
  const check=new DatabaseSync(path);try{
   const integrity=check.prepare('PRAGMA integrity_check').all();if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')invalid('The restored SQLite snapshot failed integrity verification.');
   const version=check.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();if(Number(version?.version)!==doc.schema_version)invalid('Snapshot schema metadata does not match.');
   for(const table of ['sessions','auth_challenges','service_leases'])if(check.prepare("SELECT name FROM sqlite_master WHERE name=? AND type='table'").get(table))check.exec('DELETE FROM '+table);
   if(check.prepare("SELECT name FROM sqlite_master WHERE name='private_data' AND type='table'").get())check.exec("DELETE FROM private_data WHERE collection='AccountMail'");
  }finally{check.close();}
  for(const f of files){const target=join(out,'files',...f.path.split('/'));if(!target.startsWith(join(out,'files')+sep))invalid('Unsafe backup file path.');await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,f.bytes,{flag:'wx',mode:0o600});}
  await writeFile(join(out,'RESTORE.txt'),'Verified staged recovery only. Stop Avera before replacing its SQLite database and private files with these copies. Move old database/WAL/SHM files aside first. Use the matching application version and restore the original vault key, gateway grant and backend configuration separately. All old sessions/challenges were removed; sign in again. Never overwrite your only working copy.\n',{mode:0o600});
  return {schema_version:doc.schema_version,files:files.length};
 }catch(error){await rm(out,{recursive:true,force:true});throw error;}
}
