import { useEffect,useLayoutEffect,useState,useSyncExternalStore } from 'react';
import { Link,NavLink,Outlet,useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { PRIMARY_NAV,SETTINGS_NAV } from '@/config/navigation';
import { Sheet,SheetTrigger,SheetContent,SheetHeader,SheetTitle,SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { getModeSnapshot,subscribeToModeChanges } from '@/lib/mode';
import { queryClientInstance } from '@/lib/query-client';
import { application } from '@/api/application';
import DemoModeBar from './DemoModeBar';
import SignOutButton from '@/components/SignOutButton';
import FeedbackDialog from '@/components/settings/FeedbackDialog';
const destinations=[...PRIMARY_NAV,SETTINGS_NAV];
export default function AppLayout(){
 const snapshot=useSyncExternalStore(subscribeToModeChanges,getModeSnapshot);
 useLayoutEffect(()=>{application.cancelPendingRequests?.();void queryClientInstance.cancelQueries();queryClientInstance.clear();},[snapshot]);
 return <WebsiteShell key={snapshot}/>;
}
function WebsiteShell(){
 const {user}=useAuth(),location=useLocation();
 const [open,setOpen]=useState(false);
 const chat=location.pathname==='/ask-avera';
 useEffect(()=>{
  const title=destinations.find(item=>item.path===location.pathname)?.label||'Avera';document.title=`${title} · Avera`;
  document.getElementById('main-content')?.focus({preventScroll:true});
 },[location.pathname]);
 const navLinks=(mobile=false)=>destinations.map(item=><NavLink key={item.path} to={item.path} end={item.path==='/'} onClick={()=>setOpen(false)} className={({isActive})=>`${mobile?'flex min-h-12 items-center rounded-xl px-4 text-foreground':'inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-white'} ${isActive?(mobile?'bg-surface-selected font-semibold':'bg-white/15 font-semibold underline underline-offset-8'):(mobile?'hover:bg-surface-subtle':'hover:bg-white/10')} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}>{item.label}</NavLink>);
 return <div className={`flex flex-col bg-background ${chat?'h-dvh':'min-h-dvh'}`}>
  <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3 focus:text-foreground">Skip to main content</a>
  <header className="sticky top-0 z-40 shrink-0 bg-sidebar text-sidebar-foreground shadow-sm">
   <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
    <Link to="/" aria-label="Avera overview" className="flex min-h-11 items-center gap-2 rounded-lg font-semibold text-white"><span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/30">A</span><span className="text-lg">Avera</span></Link>
    <nav aria-label="Primary" className="hidden flex-wrap gap-1 xl:flex">{navLinks()}</nav>
    <div className="flex items-center gap-2">
     {!user?.is_sample&&<div className="hidden sm:block"><FeedbackDialog/></div>}
     <div className="hidden sm:block">{user?.is_sample?<Button asChild variant="secondary" className="min-h-11"><Link to="/register">Create account</Link></Button>:<SignOutButton/>}</div>
     <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button variant="secondary" className="min-h-11 xl:hidden" aria-label="Open navigation"><Menu className="mr-2 h-4 w-4" aria-hidden="true"/>Menu</Button></SheetTrigger>
      <SheetContent className="overflow-y-auto">
       <SheetHeader><SheetTitle>Explore Avera</SheetTitle><SheetDescription>Find your finances, plan and settings.</SheetDescription></SheetHeader>
       <nav aria-label="Mobile primary" className="mt-5 space-y-1">{navLinks(true)}</nav>
       <div className="mt-5 border-t border-border pt-5">{user?.is_sample?<Button asChild><Link to="/register">Create account</Link></Button>:<SignOutButton/>}</div>
      </SheetContent>
     </Sheet>
    </div>
   </div>
  </header>
  <main id="main-content" tabIndex={-1} className={`outline-none ${chat?'flex min-h-0 flex-1 flex-col':'flex-1'}`}>
   <DemoModeBar/>
   <Outlet/>
  </main>
  {!chat&&<footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-6 text-sm text-muted-foreground sm:px-6"><span>Avera · Your finances, in perspective.</span><Link to="/settings" className="min-h-11 py-3 underline underline-offset-4">Preferences & privacy</Link></footer>}
 </div>;
}
