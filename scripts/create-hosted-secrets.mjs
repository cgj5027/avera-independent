import { randomBytes,randomUUID } from 'node:crypto';
import { mkdir,writeFile,readFile,rm,realpath } from 'node:fs/promises';
import { resolve,dirname,relative,isAbsolute,sep,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [destination,existing]=process.argv.slice(2);
if(!destination||process.argv.length>4)throw Error('Usage: node scripts/create-hosted-secrets.mjs NEW_PRIVATE_DIRECTORY [CURRENT_GATEWAY_GRANTS_FILE]');
const root=await realpath(resolve(dirname(fileURLToPath(import.meta.url)),'..')),target=resolve(destination);
const parent=await realpath(dirname(target)),actual=join(parent,target.split(sep).at(-1));
const part=relative(root,actual);if(!part||(!part.startsWith('..'+sep)&&part!=='..'&&!isAbsolute(part)))throw Error('Keep hosted credentials outside the repository.');
let prior;
if(existing){try{prior=JSON.parse(await readFile(existing,'utf8'));}catch{throw Error('The current gateway grants file could not be read as JSON.');}if(!Array.isArray(prior)||!prior.length||prior.length>=1000||new Set(prior.map(r=>r?.id)).size!==prior.length||prior.some(r=>!r||typeof r.id!=='string'||!/^[\w-]{1,80}$/.test(r.id)||typeof r.token!=='string'||!/^[\w-]{43,128}$/.test(r.token)))throw Error('The current gateway grants file is invalid.');}
process.umask(0o077);
await mkdir(actual,{mode:0o700});
try{
 const grant={id:randomUUID(),token:randomBytes(32).toString('base64url')},key=randomBytes(32).toString('base64');
 await writeFile(join(actual,'hosted-secrets.env'),'AVERA_GATEWAY_TOKEN='+grant.token+'\nAVERA_VAULT_KEY='+key+'\n',{flag:'wx',mode:0o600});
 await writeFile(join(actual,'gateway-grant-to-add.json'),JSON.stringify(grant,null,2)+'\n',{flag:'wx',mode:0o600});
 if(prior)await writeFile(join(actual,'gateway-grants.merged.json'),JSON.stringify([...prior,grant],null,2)+'\n',{flag:'wx',mode:0o600});
 await writeFile(join(actual,'README.txt'),'PRIVATE HOSTED CREDENTIALS — keep off-device securely, never commit or send in chat.\nCopy the two hosted-secrets.env values into the NEW avera-web Render service.\nAppend the object in gateway-grant-to-add.json to the EXISTING gateway grants array and retain every previous record.\nIf you supplied a current gateway file, gateway-grants.merged.json preserves those records plus this new grant. Verify it against the live gateway file before updating.\nRestart the gateway after updating its secret file. Never replace its grants array with only the new object.\nDo not change the existing gateway vault key or desktop installation grants.\n',{flag:'wx',mode:0o600});
 console.log('Private hosted credentials created. Follow README.txt; values were not printed.');
}catch(error){await rm(actual,{recursive:true,force:true});throw error;}
