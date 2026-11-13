/** One owner-scoped preference holds the mode and scenario atomically. No financial records. */
import { DEMO_PROFILES } from '@/services/demoProfiles';
export const DATA_MODES={demo:{indicator:'Sample data'},sandbox:{indicator:'Plaid Sandbox — Test account'},manual:{indicator:'Personal finances'}};
let ownerId=null;
const memory=new Map(),listeners=new Set();
const key=()=>`avera_workspace:${ownerId||'visitor'}`;
const legacy=prefix=>ownerId?`${prefix}:${ownerId}`:prefix;
function emit(){for(const listener of listeners)listener();}
function read(){
 try{
  const saved=localStorage.getItem(key());
  if(saved){const value=JSON.parse(saved);return {mode:DATA_MODES[value.mode]?value.mode:null,workspace:DEMO_PROFILES[value.workspace?.profile]?value.workspace:null};}
  const oldMode=sessionStorage.getItem(legacy('avera_data_mode'));
  const oldWorkspace=JSON.parse(localStorage.getItem(legacy('avera_demo_workspace'))||'null');
  const value={mode:DATA_MODES[oldMode]?oldMode:null,workspace:DEMO_PROFILES[oldWorkspace?.profile]?oldWorkspace:null};
  memory.set(key(),value);if(oldMode||oldWorkspace)localStorage.setItem(key(),JSON.stringify(value));return value;
 }catch{return memory.get(key())||{mode:null,workspace:null};}
}
function write(value){memory.set(key(),value);try{localStorage.setItem(key(),JSON.stringify(value));}catch{/* In-memory preferences when storage is disabled. */}emit();}
export function setModeOwner(id){const next=id||null;if(next!==ownerId){ownerId=next;emit();}}
export function getModeOwner(){return ownerId;}
export function getDataMode(){return read().mode;}
export function getDemoWorkspace(){return read().workspace;}
export function setDataMode(mode){if(DATA_MODES[mode])write({...read(),mode});}
export function clearDataMode(){write({...read(),mode:null});}
export function setDemoWorkspace(workspace){if(DEMO_PROFILES[workspace?.profile])write({...read(),workspace});}
export function clearDemoWorkspace(){write({...read(),workspace:null});}
export function activateSampleWorkspace(workspace){if(!DEMO_PROFILES[workspace?.profile])throw Error('Choose a sample scenario.');write({mode:'demo',workspace:{...workspace,generation:crypto.randomUUID()}});}
export function getModeSnapshot(){return JSON.stringify([ownerId,read()]);}
export function subscribeToModeChanges(listener){listeners.add(listener);return()=>listeners.delete(listener);}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===key()||event.key===null){memory.delete(key());emit();}});
export function hasChosenMode(){return Boolean(getDataMode());}
export function modeLabel(mode){if(mode==='demo'){const p=DEMO_PROFILES[getDemoWorkspace()?.profile];return p?`Sample data — ${p.label}`:'Sample data';}return DATA_MODES[mode]?.indicator||'Personal finances';}
