import { spawn } from 'node:child_process';
import { mkdir,readFile,writeFile,unlink,lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve,join,dirname,isAbsolute,relative,sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { verifyDesktop } from './verify-desktop.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<18)){
 console.error('Avera requires Node.js 22.18 or newer supported LTS. Install it from https://nodejs.org.');process.exit(1);
}
if(args.some(arg=>!['--no-browser','--check'].includes(arg))){console.error('Options: --no-browser, --check');process.exit(1);}
process.umask(0o077);
let child,lockPath,lockValue,stopping=false;
async function release(){if(lockPath){try{if(await readFile(lockPath,'utf8')===lockValue)await unlink(lockPath);}catch{/* Only remove our own lock. */}}}
async function stop(){if(stopping)return;stopping=true;if(child&&child.exitCode===null){if(child.connected)child.send('avera:shutdown',()=>{});else child.kill('SIGTERM');const timeout=setTimeout(()=>child.kill('SIGKILL'),15000);timeout.unref();}else await release();}
try{
 await verifyDesktop(root);
 if(args.includes('--check')){console.log('Avera desktop package and Node.js runtime verified.');process.exit(0);}
 if(process.env.AVERA_PUBLIC_ORIGIN||process.env.AVERA_LISTEN_HOST)throw Error('Use the desktop launcher only for a local loopback installation.');
 const fallback=process.platform==='win32'?join(process.env.APPDATA||join(homedir(),'AppData','Roaming'),'Avera'):process.platform==='darwin'?join(homedir(),'Library','Application Support','Avera'):join(process.env.XDG_DATA_HOME||join(homedir(),'.local','share'),'avera');
 const home=process.env.AVERA_HOME||fallback;
 if(!isAbsolute(home))throw Error('AVERA_HOME must be an absolute private data-folder path.');
 const inPackage=path=>{const part=relative(root,resolve(path));return !part||(!part.startsWith('..'+sep)&&part!=='..'&&!isAbsolute(part));};
 if(inPackage(home))throw Error('Keep your data folder outside the replaceable application package.');
 await mkdir(home,{recursive:true,mode:0o700});
 if((await lstat(home)).isSymbolicLink())throw Error('The Avera data folder must be a regular private directory.');
 const config=join(home,'installation.env');
 try{await writeFile(config,'# Private Avera desktop configuration. Do not share or commit.\nAVERA_INTEGRATION_MODE=gateway\nAVERA_SYNC_ENABLED=false\n# AVERA_GATEWAY_URL=https://your-gateway.example\n# AVERA_GATEWAY_TOKEN=your-unique-installation-grant\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
 if(!(await lstat(config)).isFile()||(await lstat(config)).isSymbolicLink())throw Error('installation.env must be a regular private file.');
 process.loadEnvFile(config);
 if(process.env.AVERA_PUBLIC_ORIGIN||process.env.AVERA_LISTEN_HOST)throw Error('The desktop configuration must use local loopback hosting.');
 if(existsSync(join(root,'data','avera.sqlite')))throw Error('An older data folder was found inside this package. Preserve it and migrate using the recovery guide.');
 const defaults={AVERA_DATA_STORE:'sqlite',AVERA_SQLITE_PATH:join(home,'avera.sqlite'),AVERA_FILES_PATH:join(home,'files'),AVERA_VAULT_KEY_PATH:join(home,'vault.key'),AVERA_BACKUP_DIR:join(home,'backups'),AVERA_BACKUP_KEY_PATH:join(home,'backup.key'),AVERA_INTEGRATION_MODE:'gateway',AVERA_SYNC_ENABLED:'false'};
 for(const key of Object.keys(defaults))process.env[key]??=defaults[key];
 for(const key of ['AVERA_SQLITE_PATH','AVERA_FILES_PATH','AVERA_VAULT_KEY_PATH','AVERA_BACKUP_DIR','AVERA_BACKUP_KEY_PATH','AVERA_BACKUP_COPY_DIR'])if(process.env[key]){if(!isAbsolute(process.env[key]))throw Error(key+' must be an absolute path in desktop configuration.');if(inPackage(process.env[key]))throw Error('Keep private data and key paths outside the replaceable application package.');}
 lockPath=join(home,'desktop.lock');lockValue=JSON.stringify({pid:process.pid,nonce:randomUUID()});
 try{await writeFile(lockPath,lockValue,{flag:'wx',mode:0o600});}catch(error){
  if(error.code==='EEXIST')throw Error('This data folder is locked. Close the other Avera installation. After an unexpected shutdown, confirm Avera is stopped before removing desktop.lock.');
  throw error;
 }
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop();});
 if(process.send){process.on('message',message=>{if(message==='avera:shutdown')void stop();});process.once('disconnect',()=>{void stop();});}
 child=spawn(process.execPath,['--experimental-strip-types',join(root,'server','index.ts')],{cwd:root,env:process.env,stdio:['ignore','pipe','inherit','ipc']});
 let output='',opened=false;
 const startup=setTimeout(()=>{console.error('Avera did not start in time. Check the private configuration and port availability.');void stop();},30000);startup.unref();
 child.stdout.on('data',bytes=>{process.stdout.write(bytes);output=(output+String(bytes)).slice(-4096);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match&&!opened){opened=true;clearTimeout(startup);console.log('Leave this terminal open. Press Ctrl+C to stop Avera.');if(!args.includes('--no-browser')){const command=process.platform==='win32'?'cmd.exe':process.platform==='darwin'?'open':'xdg-open';const browserArgs=process.platform==='win32'?['/d','/c','start','',match[0]]:[match[0]];const browser=spawn(command,browserArgs,{stdio:'ignore',windowsHide:true});browser.on('error',()=>console.log('Open the local URL above in your browser.'));browser.unref();}}});
 child.on('error',async()=>{clearTimeout(startup);console.error('Avera could not start. Check the Node.js installation.');await release();if(process.connected)process.disconnect();process.exitCode=1;});
 child.on('exit',async(code)=>{clearTimeout(startup);await release();if(process.connected)process.disconnect();process.exitCode=stopping?0:(code??1);});
}catch(error){await release();console.error(error.message||'Avera desktop could not start.');if(process.connected)process.disconnect();process.exitCode=1;}
