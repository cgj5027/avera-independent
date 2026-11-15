import { spawnSync } from 'node:child_process';
import { resolve,join } from 'node:path';
import { readdir,readFile } from 'node:fs/promises';
const canary='avera-private-build-environment-canary';
const result=spawnSync(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build'],{
  env:{...process.env,VITE_AVERA_BACKEND:'http',VITE_AVERA_DISTRIBUTION_CANARY:canary},stdio:'inherit',
});
if(result.error) throw result.error;
if(result.status!==0)process.exit(result.status??1);
// Fail if an entry point spreads the complete public build environment into a download.
async function check(directory){for(const name of await readdir(directory,{withFileTypes:true})){const path=join(directory,name.name);if(name.isDirectory())await check(path);else if(/\.(?:js|html|json|map)$/.test(name.name)&&(await readFile(path,'utf8')).includes(canary))throw Error('Independent assets included the build environment. Use explicit public configuration fields.');}}
await check(resolve('dist-local'));
