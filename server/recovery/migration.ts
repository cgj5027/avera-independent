import { recordSchemas,object } from '../validation.ts';
import { validateSnapshot,RECOVERY_SCHEMA } from './records.ts';
import { invalid } from '../errors.ts';
/** Convert an owner-authorized JSON export. Never fetch external credentials or records. */
export function prepareMigration(value:unknown,sourceOwner:string){
 const source=object(value);if(!sourceOwner||sourceOwner.length>200)invalid('Specify the owner whose authorized export is being migrated.');
 const records:any[]=[];const at=new Date().toISOString();
 for(const [collection,input] of Object.entries(source)){
  if(collection==='attachments')continue;
  if(collection==='PlaidItem')continue; // Authorizations are deliberately not portable.
  if(!recordSchemas[collection]||!Array.isArray(input))invalid('Use a JSON object containing named public entity arrays.');
  for(const raw of input){
   const row=object(raw),owner=row.created_by_id??row.created_by;
   if(owner!==sourceOwner)invalid('Every exported row must belong to the specified source owner. Separate mixed-owner exports first.');
   const fields=Object.fromEntries(Object.entries(row).filter(([key])=>Object.hasOwn(recordSchemas[collection].properties,key)&&!(row[key]===null&&!recordSchemas[collection].required.includes(key))));
   records.push({collection,id:row.id,fields,revision:1,created_at:row.created_date||at,updated_at:row.updated_date||row.created_date||at});
  }
 }
 const attachments=source.attachments??[];
 if(!Array.isArray(attachments)||attachments.some((file:any)=>(file.created_by_id??file.created_by)!==sourceOwner))invalid('Every migrated attachment must identify the authorized source owner.');
 // File bytes must be provided with the authorized export; URLs are never fetched by the server.
 const workspaces=[...new Set(records.map(row=>row.fields.demo_profile).filter(Boolean))];
 return validateSnapshot({format:'avera-records',version:1,schema_version:RECOVERY_SCHEMA,source:'base44',created_at:at,records,attachments,workspaces});
}
