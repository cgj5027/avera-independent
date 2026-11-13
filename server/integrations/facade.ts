import type { RecordStore } from '../store.ts';
import type { PrivateVault } from './vault.ts';
import { missing,invalid } from '../errors.ts';

export function recordsFor(store:RecordStore,owner:string) {
  return new Proxy({} as Record<string,any>,{get(_target,name:string){
    const clean=(input:any)=>{const {id,created_by_id,owner_id,created_date,updated_date,revision,...fields}=input;return fields;};
    const entity={
      filter:async(query:any={},options:any={})=>{const {fields,...rest}=options;const page=await store.list(owner,name,query,rest);return fields ? {...page,items:page.items.map(row=>Object.fromEntries(['id','created_by_id',...fields].filter(key=>Object.hasOwn(row,key)).map(key=>[key,(row as Record<string,any>)[key]])))}:page;},
      get:(id:string)=>store.get(owner,name,id),
      create:(input:any)=>store.db.transaction(tx=>store.insert(tx,owner,name,clean(input),true)),
      update:(id:string,input:any)=>store.update(owner,name,id,clean(input),true),
      delete:(id:string)=>store.delete(owner,name,id,true),
      upsert:async(rows:any[],options:any)=>{
        if(!['item_id','import_key'].includes(options?.key))invalid('Invalid service key.');
        const results=[];
        for(const row of rows){
          const found=await store.list(owner,name,{[options.key]:row[options.key]});
          if(found.items.length)results.push(await store.update(owner,name,found.items[0].id,clean(row),true));
          else {try{results.push(await entity.create(row));}catch(error){
            const retry=await store.list(owner,name,{[options.key]:row[options.key]});
            if(!retry.items.length)throw error;
            results.push(await store.update(owner,name,retry.items[0].id,clean(row),true));
          }}
        }return results;
      },
      bulkUpdate:async(rows:any[])=>{for(const row of rows)await store.update(owner,name,row.id,clean(row.data??row),true);},
    };return entity;
  }});
}
export function privateRecordsFor(vault:PrivateVault,owner:string){
  return {PlaidCredential:{
    filter:async(query:any)=>({items:(await vault.list(owner,'PlaidCredential')).filter(row=>Object.entries(query).every(([key,value])=>row[key]===value)),has_more:false,next_cursor:null}),
    upsert:async(rows:any[])=>{for(const row of rows)await vault.put(owner,'PlaidCredential',row.credential_key,{...row,owner_id:owner});},
    update:async(id:string,fields:any)=>{const row=(await vault.list(owner,'PlaidCredential')).find(row=>row.id===id)??missing();await vault.put(owner,'PlaidCredential',row.credential_key,{...row,...fields,owner_id:owner});},
    delete:(id:string)=>vault.remove(owner,'PlaidCredential',id),
  }};
}
