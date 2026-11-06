import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const result=spawnSync(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build'],{
  env:{...process.env,VITE_AVERA_BACKEND:'http'},stdio:'inherit',
});
if(result.error) throw result.error;
process.exit(result.status ?? 1);
