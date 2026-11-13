import { Link,useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import ConfirmDeleteDialog from '@/components/finance/ConfirmDeleteDialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { DEMO_PROFILES } from '@/services/demoProfiles';
import { resetDemoProfile,exitDemoMode } from '@/services/demoMode';
import { getDataMode,getDemoWorkspace } from '@/lib/mode';
export default function DemoModeBar(){
 const navigate=useNavigate(),{user,leaveSample}=useAuth(),{toast}=useToast();
 const [busy,setBusy]=useState(false),[resetOpen,setResetOpen]=useState(false);
 const ws=getDemoWorkspace();
 if(getDataMode()!=='demo'||!ws)return <div className="mx-auto flex w-full max-w-6xl justify-end px-4 pt-3 sm:px-6"><Link to="/welcome?sample=1" className="rounded-lg py-2 text-sm font-medium text-primary underline underline-offset-4">Try sample data</Link></div>;
 const reset=async()=>{setBusy(true);try{await resetDemoProfile();setResetOpen(false);setBusy(false);toast({title:'Sample scenario reset'});}catch(error){setBusy(false);toast({title:'Reset failed',description:error.code==='SAMPLE_BANK_CONNECTED'?'Disconnect this scenario’s test bank in Settings before resetting.':'Your previous workspace has been kept. Please retry.',variant:'destructive'});}};
 const exit=async()=>{setBusy(true);try{if(user?.is_sample){await leaveSample();navigate('/welcome');}else{await exitDemoMode();navigate('/');}}catch{setBusy(false);toast({title:'Unable to switch',description:'Please retry.',variant:'destructive'});}};
 return <details className="group mx-auto w-full max-w-6xl shrink-0 border-b border-border bg-surface-subtle">
  <summary className="flex min-h-12 cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 sm:px-6"><span>Sample data — {DEMO_PROFILES[ws.profile]?.label}</span><span className="text-xs text-muted-foreground">Scenario options</span></summary>
  <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-4 sm:px-6">
   <p className="w-full text-sm text-muted-foreground">{ws.plaid_item_id?'Dataset: Plaid Sandbox + Avera sample plans':'Dataset: Avera sample data'}. Your personal finances stay separate. Leaving keeps your changes.{user?.is_sample?' Guest scenarios are available for this browser session, up to eight hours. Create an account for personal records and connected services.':''}</p>
   <Button asChild variant="outline" className="min-h-11" disabled={busy}><Link to="/welcome?sample=1">Change scenario</Link></Button>
   <Button variant="outline" className="min-h-11" onClick={()=>setResetOpen(true)} disabled={busy}>Reset sample scenario</Button>
   <Button variant="secondary" className="min-h-11" onClick={exit} disabled={busy}>{user?.is_sample?'Back to landing page':'Return to personal finances'}</Button>
  </div>
  <ConfirmDeleteDialog open={resetOpen} onOpenChange={setResetOpen} title="Reset sample scenario?" description="Restore this scenario’s original sample records. Changes to this scenario will be removed; personal finances and other scenarios are kept." confirmLabel="Reset sample" cancelLabel="Keep exploring" onConfirm={reset} busy={busy}/>
 </details>;
}
