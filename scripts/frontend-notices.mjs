import { readFile,readdir } from 'node:fs/promises';
import { dirname,join,parse } from 'node:path';
// Preserve third-party attribution for modules actually included in the independent build.
export function frontendNotices(){return {name:'avera-frontend-notices',async generateBundle(){
 const packages=new Map();
 for(const id of this.getModuleIds()){
  if(id.startsWith('\0')||!id.replaceAll('\\','/').includes('/node_modules/'))continue;
  let folder=dirname(id.split('?')[0]);
  while(folder!==parse(folder).root){
   try{const pkg=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));if(pkg.name&&pkg.version){if(!packages.has(folder))packages.set(folder,pkg);break;}}catch{/* Walk to the owning package. */}
   folder=dirname(folder);
  }
 }
 const notices=[];
 for(const [folder,pkg]of [...packages].sort((a,b)=>a[1].name.localeCompare(b[1].name))){
  let text=`${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license??'See package publisher')}\n`;
  for(const name of (await readdir(folder)).sort())if(/^(licen[sc]e|copying)(\.|$)/i.test(name)){try{text+='\n'+await readFile(join(folder,name),'utf8')+'\n';}catch{/* Some packages use a directory for license texts. */}}
  notices.push(text);
 }
 this.emitFile({type:'asset',fileName:'third-party-notices.txt',source:'Avera independent frontend: bundled third-party notices\n\n'+notices.join('\n'+'='.repeat(72)+'\n\n')});
}};}
