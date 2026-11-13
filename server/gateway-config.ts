/** Hosted networking is opt-in; the desktop entry never reads these settings. */
export function gatewayNetwork(env:Record<string,string|undefined>) {
  const host=env.AVERA_LISTEN_HOST??'127.0.0.1';
  if(host!=='127.0.0.1'&&host!=='0.0.0.0')throw new Error('Invalid AVERA_LISTEN_HOST.');
  const rawPort=env.AVERA_PORT??env.PORT??'4175';
  if(!/^\d+$/.test(rawPort))throw new Error('Invalid gateway port.');
  const port=Number(rawPort);
  if(!Number.isInteger(port)||port<0||port>65535||(host==='0.0.0.0'&&port===0))throw new Error('Invalid gateway port.');
  const publicOrigin=env.AVERA_PUBLIC_ORIGIN??env.RENDER_EXTERNAL_URL;
  if(publicOrigin){const url=new URL(publicOrigin);if(url.protocol!=='https:'||url.origin!==publicOrigin)throw new Error('Gateway public origin must be an exact HTTPS origin.');}
  if(host==='0.0.0.0'&&!publicOrigin)throw new Error('A public HTTPS origin is required for hosted gateways.');
  let healthHost:string|undefined;
  if(env.RENDER_EXTERNAL_HOSTNAME){
    const name=env.RENDER_EXTERNAL_HOSTNAME;
    if(!/^[a-z0-9-]+\.onrender\.com$/.test(name))throw new Error('Invalid Render health hostname.');
    healthHost=name;
  }
  return {host:host as '127.0.0.1'|'0.0.0.0',port,publicOrigin,healthHost};
}
