import {it,expect} from 'vitest';
import {setModeOwner,getDataMode,setDataMode,setDemoWorkspace,activateSampleWorkspace,getDemoWorkspace,getModeSnapshot,subscribeToModeChanges} from '../src/lib/mode';
it('migrates legacy preferences and keeps mode/scenario together across tabs and reloads',()=>{
 setModeOwner('owner');sessionStorage.setItem('avera_data_mode:owner','demo');localStorage.setItem('avera_demo_workspace:owner',JSON.stringify({profile:'early_career'}));
 expect(getDataMode()).toBe('demo');expect(JSON.parse(localStorage.getItem('avera_workspace:owner')).workspace.profile).toBe('early_career');
 let count=0;const off=subscribeToModeChanges(()=>count++);activateSampleWorkspace({profile:'multi_income',plaid_item_id:null});expect(count).toBe(1);
 const saved=JSON.parse(localStorage.getItem('avera_workspace:owner'));expect(saved.mode).toBe('demo');expect(saved.workspace.profile).toBe('multi_income');
 localStorage.setItem('avera_workspace:owner',JSON.stringify({mode:'manual',workspace:saved.workspace}));window.dispatchEvent(new StorageEvent('storage',{key:'avera_workspace:owner'}));
 expect(getDataMode()).toBe('manual');expect(getDemoWorkspace().profile).toBe('multi_income');off();
});
it('isolates preferences per owner, ignores malformed state and emits a new dataset identity on reset',()=>{
 setModeOwner('one');activateSampleWorkspace({profile:'early_career'});const first=getModeSnapshot();activateSampleWorkspace({profile:'early_career'});expect(getModeSnapshot()).not.toBe(first);
 setModeOwner('two');expect(getDemoWorkspace()).toBeNull();setDataMode('manual');setDemoWorkspace({profile:'multi_income'});
 setModeOwner('one');expect(getDemoWorkspace().profile).toBe('early_career');
 localStorage.setItem('avera_workspace:one','invalid json');expect(()=>getModeSnapshot()).not.toThrow();
});
