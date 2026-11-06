import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readServerConfig } from './config.ts';
import { openDatabase } from './database.ts';
import { startLocalServer } from './http.ts';

process.umask(0o077);
const config=readServerConfig(process.env);
const port=Number(process.env.AVERA_PORT ?? 4175);
if (!Number.isInteger(port) || port<0 || port>65535) throw new Error('Invalid AVERA_PORT.');
const publicOrigin=process.env.AVERA_PUBLIC_ORIGIN;
if (publicOrigin) {
  const url=new URL(publicOrigin);
  if (url.protocol!=='https:' || url.origin!==publicOrigin) throw new Error('AVERA_PUBLIC_ORIGIN must be an HTTPS origin.');
}
const dist=resolve('dist-local');
if (!existsSync(resolve(dist,'index.html'))) throw new Error('Run npm run build:local before starting the local application.');
const runtime=await startLocalServer({db:openDatabase(config),port,dist,publicOrigin,env:process.env});
console.log(`Avera is available at ${runtime.url}`);
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{ void runtime.close().then(()=>process.exit(0)); });
