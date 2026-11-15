import { readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
if(Object.keys(lock.packages).some(path=>path.includes('node_modules/@base44/')))throw Error('Retired platform dependency remains in the lockfile.');
async function scan(directory){for(const item of await readdir(directory,{withFileTypes:true})){const file=join(directory,item.name);if(item.isDirectory())await scan(file);else if(/\.(?:[cm]?js|jsx|ts|tsx)$/.test(file)){
 const text=await readFile(file,'utf8');
 for(const match of text.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g))if(/@base44\/|(?:^|\/)base44\/|(?:^|\/)tests\//.test(match[1]))throw Error('Retired/test-only runtime import: '+file);
 if(/https?:\/\/[^\s'"`]*base44\.com/i.test(text))throw Error('Retired hosted asset in runtime source: '+file);
}}}
for(const directory of ['src','server','shared'])await scan(directory);
const files=await readdir('dist-local/assets');for(const file of files)if(file.endsWith('.js')){const text=await readFile(join('dist-local/assets',file),'utf8');if(/base44_access_token|media\.base44\.com|@base44\/sdk/.test(text))throw Error('Retired platform bootstrap found in built assets.');}
console.log('Independent source, lockfile and built assets verified; no retired platform runtime dependency.');
