import { cp, mkdir, readFile, writeFile, readdir, lstat, chmod, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.length>1)throw Error('Usage: npm run package:desktop -- NEW_OUTPUT_DIRECTORY');
const output=resolve(args[0]??join(root,'release','avera-desktop'));
// Packages are built from an allowlist into a new directory; never copy an installation.
if(output===root||root.startsWith(output+sep)||['server','shared','scripts','desktop','dist-local','node_modules'].some(name=>output===join(root,name)||output.startsWith(join(root,name)+sep)))throw Error('Choose a new package directory.');
const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
const dependencies=new Map();
function dependency(name,parent=''){
 let search=parent,found;
 while(true){const key=(search?search+'/':'')+'node_modules/'+name;if(lock.packages[key]){found=key;break;}const index=search.lastIndexOf('/node_modules/');if(index>=0)search=search.slice(0,index);else if(search)search='';else break;}
 if(!found)throw Error('Runtime dependency missing from lockfile: '+name);
 if(dependencies.has(found))return;
 const info=lock.packages[found];dependencies.set(found,info);
 for(const child of Object.keys(info.dependencies??{}))dependency(child,found);
 for(const child of Object.keys(info.optionalDependencies??{})){try{dependency(child,found);}catch{/* Optional native/cloud packages are not required by local SQLite. */}}
}
for(const name of ['pg','parse5'])dependency(name);
async function safeCopy(source,target){
 const name=source.split(sep).at(-1);if(/^\.env(?:\.|$)/.test(name)||/\.(?:sqlite(?:-wal|-shm)?|key|avera)$/.test(name))throw Error('Private installation files must not enter a package.');
 const info=await lstat(source);if(info.isSymbolicLink())throw Error('Packages must not contain symbolic links.');
 if(info.isDirectory()){await mkdir(target,{recursive:true});for(const name of await readdir(source)){if(name==='node_modules')continue;await safeCopy(join(source,name),join(target,name));}}
 else if(info.isFile()){await cp(source,target);}
 else throw Error('Unsupported package file.');
}
await mkdir(dirname(output),{recursive:true});
await mkdir(output,{recursive:false});
try{
 for(const name of ['server','shared','dist-local'])await safeCopy(join(root,name),join(output,name));
 await mkdir(join(output,'scripts'));
 for(const name of ['desktop-launcher.mjs','verify-desktop.mjs'])await safeCopy(join(root,'scripts',name),join(output,'scripts',name));
 for(const name of ['Start Avera.cmd','Start Avera.command','start-avera.sh','README.txt'])await safeCopy(join(root,'desktop',name),join(output,name));
 await chmod(join(output,'Start Avera.command'),0o755);await chmod(join(output,'start-avera.sh'),0o755);
 for(const [path,info]of dependencies){
  const installed=JSON.parse(await readFile(join(root,path,'package.json'),'utf8'));
  if(installed.version!==info.version)throw Error('Installed runtime dependencies differ from the lockfile. Run npm ci.');
  await mkdir(dirname(join(output,path)),{recursive:true});await safeCopy(join(root,path),join(output,path));
 }
 await writeFile(join(output,'package.json'),JSON.stringify({name:'avera-desktop',version,private:true,type:'module',engines:{node:'>=22.18.0'},scripts:{start:'node scripts/desktop-launcher.mjs',verify:'node scripts/verify-desktop.mjs'},dependencies:Object.fromEntries(['pg','parse5'].map(name=>[name,lock.packages['node_modules/'+name].version]))},null,2)+'\n');
 const files={};
 async function inventory(dir){for(const name of (await readdir(dir)).sort()){const path=join(dir,name),info=await lstat(path);if(info.isDirectory())await inventory(path);else files[relative(output,path).split(sep).join('/')]=createHash('sha256').update(await readFile(path)).digest('hex');}}
 await inventory(output);
 const manifest={format:'avera-desktop',version:1,app_version:version,created_at:new Date().toISOString(),node_minimum:'22.18.0',runtime_bundled:false,platform:'portable-node',dependencies:Object.fromEntries([...dependencies].map(([path,info])=>[path,{version:info.version,integrity:info.integrity??null,license:info.license??null}])),files};
 await writeFile(join(output,'desktop-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const {verifyDesktop}=await import('./verify-desktop.mjs');await verifyDesktop(output);
 console.log('Verified desktop package: '+output+' ('+Object.keys(files).length+' files; Node.js 22.18+ required)');
}catch(error){await rm(output,{recursive:true,force:true});throw error;}
