import { useEffect, useState } from 'react';
import { application } from '@/api/application';
import SettingSection from './SettingSection';
import { Button } from '@/components/ui/button';

export default function ConnectedServices() {
  const [status,setStatus]=useState(null);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    if(!application.capabilities?.privacyControls)return;
    let active=true;
    application.services.invoke('getIntegrationStatus').then(({data})=>{if(active)setStatus(data);}).catch(()=>{if(active)setError('Connected services are unavailable. Your stored finances remain available.');});
    return ()=>{active=false;};
  },[]);
  if(!application.capabilities?.privacyControls)return null;
  async function toggle(){
    setSaving(true);setError('');
    try{const {data}=await application.services.invoke('setAiConsent',{enabled:!status.ai_consent});setStatus({...status,ai_consent:data.enabled});}
    catch{setError('The sharing preference could not be saved. Please retry.');}
    finally{setSaving(false);}
  }
  return <SettingSection title="Connected services and AI" description="Your financial records stay in the database selected for this installation.">
    {error&&<p role="alert" className="text-danger mb-3">{error}</p>}
    {!status&&!error&&<p role="status">Checking services…</p>}
    {status&&<div className="space-y-3">
      <p className="text-base">Connection: {status.mode==='gateway'?'Avera gateway':'Direct providers'}. AI: {status.ai?'configured':'unavailable'}. Plaid Sandbox: {status.plaid?'configured':'unavailable'}.</p>
      <p className="text-base text-muted-foreground" id="ai-sharing-details">Online AI sends selected financial context or your job-search profile through the configured gateway and AI/search providers. Local storage does not mean local AI. Credentials and full account numbers are excluded. Conversation history is not stored by Avera. Provider retention terms still apply. Resume uploads require separate consent and temporary provider files are deleted after processing; failed deletions are retried.</p>
      <Button type="button" variant="outline" className="min-h-11 whitespace-normal h-auto" aria-pressed={status.ai_consent} aria-describedby="ai-sharing-details" onClick={toggle} disabled={saving}>{saving?'Saving…':status.ai_consent?'Turn off online AI processing':'Allow online AI processing'}</Button>
      <p className="text-sm text-muted-foreground">Manual finances and recurring-payment detection work without AI. Bank refresh and current job searches require internet access. Multi-device synchronization is unavailable in this release.</p>
    </div>}
  </SettingSection>;
}
