import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostedApplicationConfig } from './hosted-config.ts';
import { openDatabase } from './database.ts';
import { startLocalServer } from './http.ts';
import { recoveryKey } from './recovery/service.ts';
process.umask(0o077);
const settings=hostedApplicationConfig(process.env),dist=resolve('dist-local');
if(!existsSync(resolve(dist,'index.html')))throw Error('Build the independent app before starting hosted Avera.');
// Refuse a missing original key or unwritable private storage before opening a listener.
await recoveryKey(settings.recovery);
const runtime=await startLocalServer({db:openDatabase(settings.config),...settings.network,dist,env:settings.env,recoveryOptions:settings.recovery});
console.log('Hosted Avera is available at '+settings.network.publicOrigin);
let closing=false;
const shutdown=()=>{if(closing)return;closing=true;void runtime.close().then(()=>process.exit(0));};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,shutdown);
if(process.send){process.on('message',message=>{if(message==='avera:shutdown')shutdown();});process.once('disconnect',shutdown);}
