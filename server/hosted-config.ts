import { isAbsolute,join } from 'node:path';
import { readServerConfig } from './config.ts';
import { recoveryOptions } from './recovery/service.ts';
/** Explicit hosted entry only; desktop startup never infers a public listener. */
export function hostedApplicationConfig(input:Record<string,string|undefined>){
 const env={...input};
 if(env.AVERA_DATA_STORE!=='postgres')throw Error('Hosted Avera requires its own PostgreSQL database.');
 const origin=env.AVERA_PUBLIC_ORIGIN??env.RENDER_EXTERNAL_URL;
 try{if(!origin)throw Error();const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw Error();}catch{throw Error('Hosted Avera requires an exact public HTTPS origin (AVERA_PUBLIC_ORIGIN or RENDER_EXTERNAL_URL).');}
 const raw=env.PORT??env.AVERA_PORT??'10000';
 if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>65535)throw Error('Invalid hosted application port. Use the platform PORT or a numeric AVERA_PORT.');
 const home=env.AVERA_HOSTED_DATA_DIR;
 if(!home||!isAbsolute(home)||home.includes('\0'))throw Error('AVERA_HOSTED_DATA_DIR must name an absolute private persistent-disk folder.');
 if(!env.AVERA_VAULT_KEY||!/^[A-Za-z0-9+/]{43}=$/.test(env.AVERA_VAULT_KEY)||Buffer.from(env.AVERA_VAULT_KEY,'base64').length!==32)throw Error('Set a dedicated hosted AVERA_VAULT_KEY: 32 random bytes encoded as base64.');
 env.AVERA_FILES_PATH??=join(home,'files');env.AVERA_BACKUP_DIR??=join(home,'backups');env.AVERA_BACKUP_KEY_PATH??=join(home,'backup.key');
 for(const key of ['AVERA_FILES_PATH','AVERA_BACKUP_DIR','AVERA_BACKUP_KEY_PATH','AVERA_BACKUP_COPY_DIR'])if(env[key]&&!isAbsolute(env[key]))throw Error(key+' must be an absolute private path for hosted Avera.');
 const config=readServerConfig(env);
 if(config.integrations.mode==='gateway'&&(!config.integrations.gatewayUrl?.startsWith('https://')||!env.AVERA_GATEWAY_TOKEN||!/^[\w-]{43,128}$/.test(env.AVERA_GATEWAY_TOKEN)))throw Error('Configure an HTTPS gateway URL and a dedicated hosted installation grant.');
 let healthHost:string|undefined;
 if(env.RENDER_EXTERNAL_HOSTNAME){if(!/^[a-z0-9-]+\.onrender\.com$/.test(env.RENDER_EXTERNAL_HOSTNAME))throw Error('Invalid Render health hostname.');healthHost=env.RENDER_EXTERNAL_HOSTNAME;}
 return {env,config,recovery:recoveryOptions(env),network:{host:'0.0.0.0' as const,port:Number(raw),publicOrigin:origin!,healthHost,hostedApplication:true}};
}
