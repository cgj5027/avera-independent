import { useState } from 'react';
import { Link,useNavigate,useLocation } from 'react-router-dom';
import { ArrowRight,ChartNoAxesCombined,Receipt,ShieldCheck,LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { setDataMode } from '@/lib/mode';
import { DEMO_PROFILES,DEMO_PROFILE_KEYS } from '@/services/demoProfiles';
import { loadDemoProfile } from '@/services/demoMode';
import { application } from '@/api/application';
import SignOutButton from '@/components/SignOutButton';

/** One landing page: personal finances first, a secondary sample-data disclosure. */
export default function ModeEntry(){
 const {user,startSample,leaveSample}=useAuth();
 const navigate=useNavigate();
 const query=useLocation().search;
 const [expanded,setExpanded]=useState(new URLSearchParams(query).get('sample')==='1'),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const personal=async()=>{
  if(busy)return;setBusy('personal');setError('');
  try{if(user?.is_sample)await leaveSample();setDataMode('manual');navigate(user&&!user.is_sample?'/':'/register');}
  catch{setError('Unable to switch right now. Please retry.');setBusy('');}
 };
 const sample=async profile=>{
  if(busy)return;setBusy(profile);setError('');
  try{if(!user){if(!application.auth.startSample){navigate('/login?returnTo=%2Fwelcome');return;}await startSample();}
   await loadDemoProfile(profile);navigate('/');
  }catch{setError('Sample data could not be loaded. Your previous workspace has been kept. Please retry.');setBusy('');}
 };
 return <div className="min-h-dvh bg-background">
  <a href="#landing-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-3">Skip to main content</a>
  <header className="border-b border-border bg-surface">
   <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
    <Link to="/welcome" className="flex min-h-11 items-center gap-3 text-xl font-semibold text-foreground"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">A</span>Avera</Link>
    {user&&!user.is_sample?<SignOutButton/>:<Link to="/login" className="rounded-lg px-3 py-3 font-medium text-primary underline-offset-4 hover:underline">Sign in</Link>}
   </div>
  </header>
  <main id="landing-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
   <div className="grid items-start gap-10 lg:grid-cols-[1.4fr_1fr]">
    <section aria-labelledby="landing-title">
     <p className="text-sm font-semibold uppercase tracking-widest text-primary">Your finances. Your direction.</p>
     <h1 id="landing-title" className="mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">A clearer view of your money.</h1>
     <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">Bring your bills, budget and goals together. Understand where you stand today and plan your next step with confidence.</p>
     <Button className="mt-7 min-h-12 rounded-xl px-6 text-base" onClick={personal} disabled={Boolean(busy)}>Get started<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true"/></Button>
     <p className="mt-3 text-sm text-muted-foreground">{user&&!user.is_sample?'Continue with your personal finances.':'Create your account to save your own financial information.'}</p>
     <button type="button" aria-expanded={expanded} aria-controls="sample-scenarios" onClick={()=>setExpanded(!expanded)} disabled={Boolean(busy)} className="mt-5 min-h-11 rounded-lg text-base font-medium text-primary underline underline-offset-4">{expanded?'Hide sample data':'Try sample data'}</button>
     <p className="text-sm text-muted-foreground">Explore three scenarios without connecting a bank. {application.capabilities?.sampleWorkspaces?'No registration needed.':'Sign in to explore sample data.'}</p>
    </section>
    <aside aria-label="Plan with Avera" className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
     <h2 className="text-xl font-semibold text-foreground">Space to see the whole picture</h2>
     {[{icon:Receipt,title:'Everyday clarity',text:'Keep upcoming bills and monthly spending in view.'},{icon:ChartNoAxesCombined,title:'Room to plan ahead',text:'Connect today’s choices to your goals and yearly plan.'},{icon:ShieldCheck,title:'Your information, your choice',text:'Keep records on your installation. Choose when to use connected services.'}].map(item=><div key={item.title} className="mt-6 flex gap-3"><item.icon className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true"/><div><h3 className="font-semibold text-foreground">{item.title}</h3><p className="mt-1 text-base text-muted-foreground">{item.text}</p></div></div>)}
    </aside>
   </div>
   {expanded&&<section id="sample-scenarios" aria-labelledby="sample-heading" className="mt-10 rounded-2xl border border-border bg-surface p-5 sm:p-7">
    <h2 id="sample-heading" className="text-xl font-semibold text-foreground">Choose a sample scenario</h2>
    <p className="mt-2 text-muted-foreground">Fictional finances, clearly labeled throughout. Your personal records stay separate. Returning to a scenario keeps your changes; reset is a separate action.</p>
    <div className="mt-5 grid gap-4 md:grid-cols-3">{DEMO_PROFILE_KEYS.map(key=><div key={key} className="flex flex-col rounded-xl border border-border p-5"><h3 className="font-semibold text-foreground">{DEMO_PROFILES[key].label}</h3><p className="mb-5 mt-2 flex-1 text-sm text-muted-foreground">{DEMO_PROFILES[key].tagline}</p><Button variant="outline" className="min-h-11" onClick={()=>sample(key)} disabled={Boolean(busy)} aria-label={`Explore ${DEMO_PROFILES[key].label}`}>{busy===key&&<LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true"/>}Explore scenario</Button></div>)}</div>
    {busy&&<p role="status" className="mt-4 text-muted-foreground">Preparing your workspace…</p>}
   </section>}
   {error&&<p role="alert" className="mt-5 text-danger-text">{error}</p>}
   <p className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">Avera helps you plan. It never executes payments or transfers.</p>
  </main>
 </div>;
}
