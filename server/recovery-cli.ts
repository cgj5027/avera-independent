import { readFile,writeFile,mkdir,stat } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { prepareMigration } from './recovery/migration.ts';
import { summary } from './recovery/records.ts';
import { decryptArchive,encryptArchive,MAX_ARCHIVE_BYTES } from './recovery/archive.ts';
import { recoveryKey } from './recovery/service.ts';
import { unpackInstallation } from './recovery/installation.ts';
import { ApiError } from './errors.ts';
process.umask(0o077);
const [command,input,output,owner]=process.argv.slice(2);
try{
 if(!input||!output||resolve(input)===resolve(output))throw Error('Use distinct input/output files.');
 if((await stat(input)).size>MAX_ARCHIVE_BYTES)throw Error('Input exceeds 32 MiB.');
 let document;
 if(command==='prepare-migration')document=prepareMigration(JSON.parse(await readFile(input,'utf8')),owner||'');
 else if(command==='rewrap-automatic'||command==='unpack-installation'){
  const keyPath=owner||process.env.AVERA_BACKUP_KEY_PATH;if(!keyPath)throw Error('Set AVERA_BACKUP_KEY_PATH to the original installation backup key.');
  await stat(keyPath);
  const key=await recoveryKey({directory:dirname(resolve(input)),keyPath});if(command==='unpack-installation'){const result=await unpackInstallation(await readFile(input),key,output);console.log('Installation recovery staged and verified. Schema version: '+result.schema_version);process.exit(0);}
  document=await decryptArchive(await readFile(input),key);
  if(document.format!=='avera-records')throw Error('Use installation recovery for a pre-upgrade database snapshot.');
 }else throw Error('Commands: prepare-migration INPUT OUTPUT SOURCE_OWNER, rewrap-automatic INPUT OUTPUT KEY_PATH, or unpack-installation INPUT NEW_DIRECTORY KEY_PATH.');
 await mkdir(dirname(resolve(output)),{recursive:true,mode:0o700});
 if(command==='prepare-migration'){
  await writeFile(output,JSON.stringify(document,null,2),{flag:'wx',mode:0o600});
  console.log('Prepared migration. Review counts/totals in Settings before importing. Records: '+summary(document).records);
 }else{
  if(!process.stdin.isTTY)throw Error('Use an interactive terminal; passphrases must not be arguments or environment variables.');
  // Disable terminal echo while reading the new passphrase.
  const tty=process.stdin as typeof process.stdin&{setRawMode?:(value:boolean)=>void};
  async function hidden(prompt:string){process.stdout.write(prompt);let value='';tty.setRawMode?.(true);process.stdin.resume();try{return await new Promise<string>((resolve,reject)=>{const onData=(data:Buffer)=>{for(const char of data.toString()){if(char==='\u0003'){process.stdin.off('data',onData);reject(Error('Cancelled.'));return;}if(char==='\r'||char==='\n'){process.stdin.off('data',onData);resolve(value);return;}if(char==='\u007f')value=value.slice(0,-1);else value+=char;}};process.stdin.on('data',onData);});}finally{tty.setRawMode?.(false);process.stdin.pause();process.stdout.write('\n');}}
  const first=await hidden('New portable recovery passphrase: '),second=await hidden('Repeat passphrase: ');if(first!==second)throw Error('Passphrases did not match.');
  await writeFile(output,await encryptArchive(document,first),{flag:'wx',mode:0o600});console.log('Encrypted portable archive created.');
 }
}catch(error){console.error(error instanceof ApiError?error.message:error instanceof SyntaxError?'The input JSON could not be parsed.':error instanceof Error&&!(error as NodeJS.ErrnoException).code?error.message:'Recovery preparation failed. Check file paths and permissions.');process.exitCode=1;}
