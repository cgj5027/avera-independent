import { readFile,readdir,lstat } from 'node:fs/promises';
import { resolve,dirname,join,relative,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export async function verifyDesktop(root){
 root=resolve(root);const manifest=JSON.parse(await readFile(join(root,'desktop-manifest.json'),'utf8'));
 if(manifest.format!=='avera-desktop'||manifest.version!==1||!manifest.files||typeof manifest.files!=='object')throw Error('Unsupported desktop manifest.');
 const paths=new Set(Object.keys(manifest.files));if(!paths.size)throw Error('Empty desktop package.');
 async function walk(dir){for(const name of await readdir(dir)){const path=join(dir,name),key=relative(root,path).split(sep).join('/'),info=await lstat(path);if(info.isSymbolicLink())throw Error('Desktop package contains a symbolic link.');if(info.isDirectory())await walk(path);else{
  if(key==='desktop-manifest.json')continue;
  if(!paths.delete(key)||createHash('sha256').update(await readFile(path)).digest('hex')!==manifest.files[key])throw Error('Desktop package integrity check failed: '+key);
 }}}
 await walk(root);if(paths.size)throw Error('Desktop package is incomplete.');return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await verifyDesktop(resolve(dirname(fileURLToPath(import.meta.url)),'..'));console.log('Desktop package verified.');}catch{console.error('Desktop package verification failed. Extract a fresh verified download; keep your separate data folder.');process.exitCode=1;}
}
