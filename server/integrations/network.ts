import { PlaidFailure } from './logic/plaid.js';
import { ApiError } from '../errors.ts';
export async function fetchJson(fetcher: typeof fetch,url: string,init: RequestInit={},maxBytes=2*1024*1024,timeout=20000,errorFactory?:(value:any,status:number)=>Error):Promise<any>{
  try {
    const response=await fetcher(url,{...init,redirect:'error',signal:AbortSignal.timeout(timeout)});
    const reader=response.body?.getReader();if(!reader)throw new Error();
    const chunks:Uint8Array[]=[];let size=0;
    try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new Error();chunks.push(part.value);}}
    finally {await reader.cancel().catch(()=>{});}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!response.ok){
      if(errorFactory)throw errorFactory(value,response.status);
      const code=response.status===429?'PROVIDER_RATE_LIMITED':'PROVIDER_UNAVAILABLE';
      throw new ApiError(503,code,'The online provider is unavailable. Please retry later.');
    }
    return value;
  }catch(error){if(error instanceof ApiError || error instanceof PlaidFailure)throw error;throw new ApiError(503,'PROVIDER_UNAVAILABLE','The online provider is unavailable. Please retry later.');}
}
export function validateStructured(schema:any,value:any,depth=0):boolean{
  if(depth>12)return false;
  if(schema.enum&&!schema.enum.includes(value))return false;
  if(schema.type==='object')return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    (schema.required??[]).every((key:string)=>Object.hasOwn(value,key))&&
    Object.entries(value).every(([key,v])=>schema.properties?.[key]&&validateStructured(schema.properties[key],v,depth+1));
  if(schema.type==='array')return Array.isArray(value)&&value.length<=100&&value.every(v=>validateStructured(schema.items,v,depth+1));
  if(schema.type==='string')return typeof value==='string'&&value.length<=20000;
  if(schema.type==='number'||schema.type==='integer')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isInteger(value));
  return schema.type==='boolean'&&typeof value==='boolean';
}
export function strictSchema(schema:any):any{
  if(schema.type==='object')return {...schema,additionalProperties:false,required:Object.keys(schema.properties),properties:Object.fromEntries(Object.entries(schema.properties).map(([k,v])=>[k,strictSchema(v)]))};
  if(schema.type==='array')return {...schema,items:strictSchema(schema.items)};
  return schema;
}
