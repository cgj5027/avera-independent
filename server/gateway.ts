import { openDatabase } from './database.ts';
import { readServerConfig } from './config.ts';
import { startLocalServer } from './http.ts';
process.umask(0o077);
if(!process.env.AVERA_GATEWAY_GRANTS_FILE)throw new Error('Configure a private gateway grant file.');
const port=Number(process.env.AVERA_PORT??4175);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid AVERA_PORT.');
const publicOrigin=process.env.AVERA_PUBLIC_ORIGIN;
if(publicOrigin){const url=new URL(publicOrigin);if(url.protocol!=='https:'||url.origin!==publicOrigin)throw new Error('AVERA_PUBLIC_ORIGIN must be an HTTPS origin.');}
const runtime=await startLocalServer({db:openDatabase(readServerConfig(process.env)),port,publicOrigin,gatewayOnly:true,env:process.env});
console.log(`Avera gateway is available at ${runtime.url}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void runtime.close().then(()=>process.exit(0));});
