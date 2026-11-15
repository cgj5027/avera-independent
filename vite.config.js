import react from '@vitejs/plugin-react';
import { defineConfig,loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { frontendNotices } from './scripts/frontend-notices.mjs';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');
 if(env.VITE_AVERA_BACKEND!==undefined&&env.VITE_AVERA_BACKEND!=='http')throw Error('Only the independent HTTP backend is supported.');
 const backend=new URL(env.AVERA_DEV_BACKEND_URL??'http://127.0.0.1:4175');
 if(backend.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(backend.hostname)||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw Error('AVERA_DEV_BACKEND_URL must be an HTTP loopback origin.');
 const proxy={target:backend.origin,changeOrigin:true,configure(instance){instance.on('proxyReq',(outgoing,incoming)=>{
  // Trust only a request originating in this loopback development UI. Preserve
  // hostile/missing origins so the backend still enforces its normal CSRF rules.
  if(incoming.headers.origin==='http://'+incoming.headers.host)outgoing.setHeader('Origin',backend.origin);
 });}};
 return {plugins:[react(),frontendNotices()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},build:{target:'es2022',outDir:'dist-local'},server:{host:'127.0.0.1',allowedHosts:['localhost','127.0.0.1'],proxy:Object.fromEntries(['/api','/oauth/authorize','/oauth/token','/oauth/register','/oauth/revoke','/mcp','/.well-known'].map(path=>[path,proxy]))}};
});
