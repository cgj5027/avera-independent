import { useEffect,useState } from 'react';
import { application } from '@/api/application';
import SettingSection from './SettingSection';
import { Button } from '@/components/ui/button';
export default function ConnectedClients(){
 const [grants,setGrants]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const enabled=application.capabilities?.mcp;
 useEffect(()=>{let active=true;if(enabled)application.mcp.list().then(data=>{if(active)setGrants(data.grants);}).catch(()=>{if(active)setError('Connected AI clients could not be loaded.');});return()=>{active=false;};},[enabled]);
 if(!enabled)return null;
 const revoke=async id=>{setBusy(true);setError('');try{await application.mcp.revoke(id);setGrants(rows=>rows.filter(row=>row.id!==id));}catch{setError('Access could not be revoked. Please retry.');}finally{setBusy(false);}};
 return <SettingSection title="Connected AI clients" description="Separate read-only access granted through Avera’s MCP connection.">
  <p className="mb-3 text-sm text-muted-foreground">Only clients you approve can read your personal records. They cannot change records or access provider credentials or private files. Revoking access stops future requests; it cannot retract information a client already received.</p>
  {grants.length?<ul className="space-y-3">{grants.map(row=><li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"><div><p className="font-medium">{row.client_name}</p><p className="text-sm text-muted-foreground">Approved {new Date(row.created_at).toLocaleString()}</p></div><Button className="min-h-11" variant="outline" disabled={busy} onClick={()=>revoke(row.id)} aria-label={`Revoke access for ${row.client_name}`}>Revoke access</Button></li>)}</ul>:<p className="text-muted-foreground">No AI clients have access.</p>}
  {error&&<p role="alert" className="mt-3 text-danger-text">{error}</p>}
 </SettingSection>;
}
