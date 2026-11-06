import { application } from '@/api/application';
import { getDataMode, getDemoWorkspace, setModeOwner } from '@/lib/mode';
export async function billSuggestionRequest(action, payload = {}) {
  const user=await application.auth.currentUser();
  if(!user?.id) throw new Error('Sign in to continue.');
  setModeOwner(user.id);
  const dataset=getDataMode()==='demo'?{mode:'demo',profile:getDemoWorkspace()?.profile}:{mode:'ordinary'};
  let timer;
  try {
    const response=await Promise.race([application.services.invoke('suggestBills',{...payload,action,dataset}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Suggestions timed out. Scan again before retrying.')),60000);})]);
    if((await application.auth.currentUser())?.id!==user.id || JSON.stringify(dataset)!==JSON.stringify(getDataMode()==='demo'?{mode:'demo',profile:getDemoWorkspace()?.profile}:{mode:'ordinary'})) throw new Error('Your active dataset changed. Scan again.');
    if(response.data?.error) throw new Error(response.data.error);
    return response.data;
  } finally {clearTimeout(timer);}
}
