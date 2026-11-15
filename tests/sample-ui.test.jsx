import { FixtureServiceError as FixtureError } from './fixtures/service-error';
import ModeEntry from '../src/pages/ModeEntry';
import { Routes, Route } from 'react-router-dom';
import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from './test-utils';
import { matches } from './queryFixture';
const sdk=vi.hoisted(()=>({auth:{me:vi.fn()},app:{getPublicSettings:vi.fn()},entities:{},functions:{invoke:vi.fn()}}));
vi.mock('./fixtures/params',()=>({appParams:{token:'fixture'}}));
vi.mock('./fixtures/client',()=>({fixtureClient:sdk}));
import {application} from '@/api/application';
import * as data from '../src/services/dataService';
import { buildDemoDataset, DEMO_PROFILE_KEYS, createDemoRecords } from '../src/services/demoProfiles';
import { demoSandboxConfig } from './fixtures/contracts/shared/demoPlaidConfigs.ts';
import { removeDemoData, loadDemoProfile, resetDemoProfile } from '../src/services/demoMode';
import { setModeOwner, setDataMode, setDemoWorkspace, getDemoWorkspace, getDataMode } from '../src/lib/mode';
import { connectBank } from '../src/services/plaidClient';
import { estimateFromTransactions } from '../src/services/plaidEstimates';
import { incomeInMonth, spentInMonth } from '../src/services/financialCalculations';
import BankConnections from '../src/components/settings/BankConnections';
import DemoModeBar from '../src/components/layout/DemoModeBar';
let rows,user;
beforeEach(()=>{
  vi.clearAllMocks();sdk.app.getPublicSettings.mockResolvedValue({id:'fixture',public_settings:{}});user={id:'a'};rows={};setModeOwner('a');sdk.auth.me.mockImplementation(async()=>user);
  for(const name of Object.values(data.DATA_ENTITIES)) {
    rows[name]=[];sdk.entities[name]={
      filter:vi.fn(async q=>({items:rows[name].filter(r=>matches(r,q)),has_more:false})),
      get:vi.fn(async id=>rows[name].find(r=>r.id===id)),
      create:vi.fn(async values=>{const row={...values,id:`${name}-${rows[name].length}`,created_by_id:user.id};rows[name].push(row);return row;}),
      update:vi.fn(async(id,values)=>Object.assign(rows[name].find(r=>r.id===id),values)),
      delete:vi.fn(async id=>{rows[name]=rows[name].filter(r=>r.id!==id);}),
    };sdk.entities[name].bulkCreate=vi.fn(async values=>Promise.all(values.map(v=>sdk.entities[name].create(v))));
  }
});
describe('demo and UI fixtures, distinct from real Plaid Sandbox',()=>{
  it.each(DEMO_PROFILE_KEYS)('%s generates labeled finite records and a valid Sandbox configuration',async profile=>{
    const today=new Date(2026,9,28);const dataset=buildDemoDataset(profile,today);const cfg=demoSandboxConfig(profile,today);
    for(const values of Object.values(dataset).filter(Array.isArray))for(const row of values){expect(row.source).toBe('Sample data');expect(row.demo_profile).toBe(profile);if('amount'in row)expect(Number.isFinite(row.amount)&&row.amount>=0).toBe(true);}
    expect(dataset.budgetCategory.some(c=>dataset.bill.some(b=>b.category===c.name))).toBe(false);
    expect(dataset.transaction.every(t=>t.date<='2026-10-28')).toBe(true);
    const created=await createDemoRecords(dataset,async(key,values)=>Promise.all(values.map(v=>sdk.entities[data.DATA_ENTITIES[key]].create(v))),async()=>true);
    for(const mortgage of rows.MortgageRecord)expect(created.property.some(p=>p.id===mortgage.property_id)).toBe(true);
    expect(cfg.institution_id).toBeTruthy();expect(cfg.products).toEqual(['transactions']);
    expect(buildDemoDataset(profile,today,{includeTransactionData:false}).transaction).toEqual([]);
    expect(rows.HouseholdProfile).toHaveLength(1);
  });
  it('deduplicates provider IDs and excludes transfers from tracked/estimated cash flows',()=>{
    const imported={amount:100,type:'income',date:'2026-10-01',plaid_item_id:'item',plaid_transaction_id:'txn',source:'Plaid Sandbox'};
    const transfer={...imported,plaid_transaction_id:'transfer',exclude_from_cashflow:true};
    expect(estimateFromTransactions([imported,{...imported},transfer]).monthlyIncome).toBe(100);
    const range={start:'2026-10-01',end:'2026-10-31'};
    expect(incomeInMonth([imported,transfer],range)).toBe(100);expect(spentInMonth([{...transfer,type:'expense'}],undefined,range)).toBe(0);
  });
  it('separates ordinary and active demo reads and stamps entries made in a demo',async()=>{
    rows.Account=[{id:'ordinary',balance:999,created_by_id:'a'},{id:'demo',balance:100,created_by_id:'a',demo_profile:'early_career'},{id:'other',balance:888,created_by_id:'b'}];
    expect((await data.listRecords('account')).map(r=>r.id)).toEqual(['ordinary']);
    setDemoWorkspace({profile:'early_career'});setDataMode('demo');
    expect((await data.listRecords('account')).map(r=>r.id)).toEqual(['demo']);
    expect((await data.createRecord('goal',{name:'Demo goal',target_amount:100})).demo_profile).toBe('early_career');
    user={id:'b'};setModeOwner('b');expect((await data.listRecords('account')).map(r=>r.id)).toEqual(['other']);expect(getDemoWorkspace()).toBeNull();expect(getDataMode()).toBeNull();
    setModeOwner('a');expect(getDemoWorkspace().profile).toBe('early_career');
  });
  it('ignores injected ordinary Item IDs during demo cleanup and preserves other users',async()=>{
    rows.PlaidItem=[{id:'ordinary-item',item_id:'ordinary',created_by_id:'a'}];
    rows.Account=[{id:'ordinary',created_by_id:'a'},{id:'other-demo',created_by_id:'b',demo_profile:'early_career'},{id:'own-demo',created_by_id:'a',demo_profile:'early_career'}];
    await removeDemoData('early_career',['ordinary']);
    expect(rows.Account.map(r=>r.id)).toEqual(['ordinary','other-demo']);expect(rows.PlaidItem).toHaveLength(1);expect(sdk.functions.invoke).not.toHaveBeenCalled();
  });
  it('rejects owned record mutations outside the active dataset and prevents retagging',async()=>{
    rows.Bill=[{id:'ordinary',created_by_id:'a',demo_profile:''},{id:'demo',created_by_id:'a',demo_profile:'early_career'}];
    await expect(data.updateRecord('bill','demo',{amount:10})).rejects.toThrow('active dataset');
    setDemoWorkspace({profile:'early_career'});setDataMode('demo');
    await expect(data.deleteRecord('bill','ordinary')).rejects.toThrow('active dataset');
    await data.updateRecord('bill','demo',{amount:20,demo_profile:''});expect(rows.Bill[1].demo_profile).toBe('early_career');
  });
  it('resets only active user demo bill dismissals',async()=>{
    rows.BillSuggestionDismissal=[{id:'active',created_by_id:'a',demo_profile:'early_career'},{id:'ordinary',created_by_id:'a'},{id:'other-user',created_by_id:'b',demo_profile:'early_career'},{id:'other-profile',created_by_id:'a',demo_profile:'multi_income'}];
    await removeDemoData('early_career');
    expect(rows.BillSuggestionDismissal.map(r=>r.id)).toEqual(['ordinary','other-user','other-profile']);
  });
  it('propagates deletion failures instead of falsely reporting demo reset success',async()=>{
    rows.Account=[{id:'demo',created_by_id:'a',demo_profile:'early_career'}];sdk.entities.Account.delete.mockRejectedValue(new Error('offline'));
    await expect(removeDemoData('early_career')).rejects.toThrow('offline');expect(rows.Account).toHaveLength(1);
  });
  it('loads labeled local data while preserving ordinary profiles',async()=>{
    rows.HouseholdProfile=[{id:'ordinary',household_name:'Real',created_by_id:'a'}];
    expect(await loadDemoProfile('multi_income')).toEqual({plaid_used:false,warning:''});
    expect(rows.HouseholdProfile).toHaveLength(2);expect(rows.Account.every(r=>r.source==='Sample data')).toBe(true);expect(rows.Property).toHaveLength(2);expect(rows.MortgageRecord).toHaveLength(2);
  });
  it('reports a sync Item error instead of a successful connection sync',async()=>{
    rows.PlaidItem=[{id:'i',item_id:'item',institution_name:'Test bank',created_by_id:'a',status:'error'}];sdk.functions.invoke.mockResolvedValue({data:{results:[{item_id:'item',status:'error',error:'ITEM_LOGIN_REQUIRED'}]}});
    render(<BankConnections />);fireEvent.click(await screen.findByRole('button',{name:'Sync now'}));expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it('announces connection-load failures and offers retry',async()=>{
    sdk.entities.PlaidItem.filter.mockRejectedValue(new Error('network'));
    render(<BankConnections />);expect(await screen.findByRole('button',{name:'Retry loading connections'})).toBeTruthy();
  });
  it('confirms demo reset and distinguishes mixed Sandbox plus sample planning data',()=>{
    setDemoWorkspace({profile:'early_career',plaid_item_id:'item'});setDataMode('demo');render(<DemoModeBar />);
    expect(screen.getByText(/Dataset: Plaid Sandbox \+ Avera sample plans/)).toBeTruthy();fireEvent.click(screen.getByText(/Sample data —/));fireEvent.click(screen.getByRole('button',{name:'Reset sample scenario'}));expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('orchestrates Link open, public-token exchange and destroy with a widget fixture',async()=>{
    sdk.functions.invoke.mockResolvedValueOnce({data:{link_token:'link-sandbox-fixture'}}).mockResolvedValueOnce({data:{item_id:'item',accounts_imported:1}});
    const handler={open:vi.fn(),destroy:vi.fn()};let callbacks;
    window.Plaid={create:vi.fn(options=>{callbacks=options;return handler;})};
    const promise=connectBank();await vi.waitFor(()=>expect(handler.open).toHaveBeenCalled());
    await callbacks.onSuccess('public-sandbox-fixture',{institution:{name:'Test bank',institution_id:'ins_fixture'}});
    expect(await promise).toMatchObject({item_id:'item'});expect(sdk.functions.invoke).toHaveBeenLastCalledWith('plaidExchangeToken',expect.objectContaining({public_token:'public-sandbox-fixture'}));expect(handler.destroy).toHaveBeenCalled();delete window.Plaid;
  });
  it('clears a disconnected demo Item from the workspace and removes stale sync errors',async()=>{
    setDemoWorkspace({profile:'early_career',plaid_item_id:'item'});setDataMode('demo');
    rows.PlaidItem=[{id:'i',item_id:'item',institution_name:'Test bank',created_by_id:'a',status:'error'}];
    sdk.functions.invoke.mockImplementation(async name=> name==='plaidSync' ? {data:{results:[{status:'error'}]}} : {data:{disconnected:true}});
    render(<BankConnections />);fireEvent.click(await screen.findByRole('button',{name:'Sync now'}));await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'Disconnect Test bank'}));fireEvent.click(screen.getByRole('button',{name:'Delete',exact:true}));
    await waitFor(()=>expect(getDemoWorkspace().plaid_item_id).toBeNull());expect(screen.queryByText(/Some connections could not sync/)).toBeNull();
  });

});

it('demo reset removes only this user demo contributions, retaining ordinary and foreign ledgers',async()=>{
 rows.GoalContribution=[
  {id:'own-demo',created_by_id:'a',goal_id:'g',amount:10,contribution_key:'demo',demo_profile:'early_career'},
  {id:'ordinary',created_by_id:'a',goal_id:'h',amount:20,contribution_key:'ordinary',demo_profile:''},
  {id:'foreign',created_by_id:'b',goal_id:'k',amount:30,contribution_key:'foreign',demo_profile:'early_career'},
 ];
 await removeDemoData('early_career');
 expect(rows.GoalContribution.map(r=>r.id)).toEqual(['ordinary','foreign']);
});

it('retries Sandbox preparation errors and empty syncs without replacing the connection',async()=>{
 vi.useFakeTimers();
 try {
  sdk.functions.invoke.mockResolvedValueOnce({data:{item_id:'preparing-item'}})
   .mockResolvedValueOnce({data:{results:[{item_id:'preparing-item',status:'error',error:'PRODUCT_NOT_READY'}]}})
   .mockResolvedValueOnce({data:{results:[{item_id:'preparing-item',status:'synced',transactions:0}]}})
   .mockResolvedValueOnce({data:{results:[{item_id:'preparing-item',status:'synced',transactions:12}]}});
  const pending=loadDemoProfile('early_career',{viaPlaid:true});
  await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toEqual({plaid_used:true,warning:''});
  expect(sdk.functions.invoke.mock.calls.filter(([name])=>name==='demoSandboxConnect')).toHaveLength(1);
  expect(getDemoWorkspace().plaid_item_id).toBe('preparing-item');
  expect(rows.Transaction).toEqual([]);
 } finally {vi.useRealTimers();}
});
it('keeps a clear setup explanation when quotas are unavailable',async()=>{
 sdk.functions.invoke.mockRejectedValueOnce({response:{status:503,data:{code:'SERVICE_LIMITS_UNAVAILABLE',error:'sensitive diagnostic'}}});
 const result=await loadDemoProfile('early_career',{viaPlaid:true});
 expect(result.plaid_used).toBe(false);expect(result.warning).toContain('needs an app update');
 expect(result.warning).not.toContain('sensitive');expect(getDemoWorkspace().plaid_item_id).toBeNull();
});
it('maps safe Link setup errors for the user instead of Axios diagnostics',async()=>{
 sdk.functions.invoke.mockRejectedValueOnce({response:{status:503,data:{code:'SANDBOX_NOT_CONFIGURED',error:'sensitive diagnostic'}}});
 await expect(connectBank()).rejects.toThrow('not configured');
});
it('returns from a non-overview page without deleting sample or personal records',async()=>{
 setDemoWorkspace({profile:'early_career'});setDataMode('demo');
 rows.Account=[{id:'demo-account',created_by_id:'a',demo_profile:'early_career'},{id:'ordinary',created_by_id:'a'}];
 render(<Routes><Route path="/bills-budget" element={<DemoModeBar/>}/><Route path="/" element={<h1>Your finances</h1>}/></Routes>,{route:'/bills-budget'});
 fireEvent.click(screen.getByText(/Sample data —/));fireEvent.click(screen.getByRole('button',{name:'Return to personal finances'}));
 expect(await screen.findByRole('heading',{name:'Your finances'})).toBeTruthy();
 expect(getDataMode()).toBe('manual');expect(getDemoWorkspace().profile).toBe('early_career');
 expect(rows.Account.map(r=>r.id)).toEqual(['demo-account','ordinary']);expect(sdk.entities.Account.delete).not.toHaveBeenCalled();
});
it('makes sample scenarios a secondary disclosure and opens personal finances first',async()=>{
 render(<Routes><Route path="/welcome" element={<ModeEntry/>}/><Route path="/" element={<h1>Your finances</h1>}/></Routes>,{route:'/welcome'});
 expect(screen.queryByRole('button',{name:/Explore Early Career/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Try sample data'}));expect(screen.getByRole('button',{name:'Explore Early Career Professional'})).toBeTruthy();
 await screen.findByRole('button',{name:'Sign out'});fireEvent.click(screen.getByRole('button',{name:'Get started'}));
 expect(await screen.findByRole('heading',{name:'Your finances'})).toBeTruthy();expect(getDataMode()).toBe('manual');
});
it('handles the retained service-error shape for Sandbox setup and request limits',async()=>{
 sdk.functions.invoke.mockRejectedValueOnce(new FixtureError('sensitive diagnostic',503,'SANDBOX_NOT_CONFIGURED',{}));
 await expect(connectBank()).rejects.toThrow('not configured');
 sdk.functions.invoke.mockRejectedValueOnce(new FixtureError('sensitive diagnostic',429,undefined,{}));
 const result=await loadDemoProfile('early_career',{viaPlaid:true});
 expect(result.warning).toContain('Wait a minute');expect(result.warning).not.toContain('sensitive');
});

it('uses concise reset wording and an explicit reset action',()=>{
 setDemoWorkspace({profile:'early_career'});setDataMode('demo');
 render(<DemoModeBar/>);
 fireEvent.click(screen.getByText(/Sample data —/));fireEvent.click(screen.getByRole('button',{name:'Reset sample scenario'}));
 expect(screen.getByRole('dialog',{name:'Reset sample scenario?'})).toBeTruthy();
 expect(screen.getByText('Restore this scenario’s original sample records. Changes to this scenario will be removed; personal finances and other scenarios are kept.')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Reset sample',exact:true})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Delete',exact:true})).toBeNull();
});
it('shows only allowlisted connection references for a failed hosted step',async()=>{
 sdk.functions.invoke.mockRejectedValueOnce(new FixtureError('private provider diagnostic',502,'SANDBOX_IMPORT_FAILED',{}));
 const result=await loadDemoProfile('early_career',{viaPlaid:true});
 expect(result.warning).toContain('Connection reference: SANDBOX_IMPORT_FAILED');
 expect(result.warning).not.toContain('private provider diagnostic');
});

it('reports a daily Sandbox cooldown accurately using the native SDK response',async()=>{
 sdk.functions.invoke.mockRejectedValueOnce(new FixtureError('raw diagnostic',429,'REQUEST_LIMITED',{retry_after:7200}));
 const result=await loadDemoProfile('early_career',{viaPlaid:true});
 expect(result.warning).toContain('about 2 hours');expect(result.warning).not.toContain('Wait a minute');
});

it('rejects a late record response after the selected dataset changes',async()=>{
 setDataMode('manual');let complete; sdk.entities.Account.filter.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 const pending=data.listRecords('account');await vi.waitFor(()=>expect(complete).toBeTruthy());
 setDemoWorkspace({profile:'early_career'});setDataMode('demo');complete({items:[{id:'personal',created_by_id:'a'}],has_more:false});
 await expect(pending).rejects.toThrow('workspace changed');
});
it('does not mutate a record when account verification completes after switching scenarios',async()=>{
 setDataMode('manual');let complete; sdk.auth.me.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 const pending=data.createRecord('bill',{name:'Stale form',amount:10});await vi.waitFor(()=>expect(complete).toBeTruthy());
 setDemoWorkspace({profile:'early_career'});setDataMode('demo');complete({id:'a'});
 await expect(pending).rejects.toThrow('workspace changed');expect(sdk.entities.Bill.create).not.toHaveBeenCalled();
});

it('does not activate a scenario after another tab changes the selected workspace',async()=>{
 const previous=application.capabilities;application.capabilities={sampleWorkspaces:true};
 try{
  setDataMode('manual');let complete;
  sdk.functions.invoke.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  const pending=loadDemoProfile('early_career');await vi.waitFor(()=>expect(complete).toBeTruthy());
  setDataMode('sandbox');complete({data:{workspace:{profile:'early_career',plaid_item_id:null}}});
  await expect(pending).rejects.toThrow('changed');expect(getDataMode()).toBe('sandbox');
 }finally{application.capabilities=previous;}
});

it('refuses sample loading/reset when another account replaced the current session',async()=>{
 const previous=application.capabilities;application.capabilities={sampleWorkspaces:true};
 try{
  setDemoWorkspace({profile:'early_career'});setDataMode('demo');sdk.auth.me.mockResolvedValue({id:'b'});
  await expect(loadDemoProfile('multi_income')).rejects.toThrow('changed');await expect(resetDemoProfile()).rejects.toThrow('changed');
  expect(sdk.functions.invoke).not.toHaveBeenCalled();expect(getDemoWorkspace().profile).toBe('early_career');
 }finally{application.capabilities=previous;}
});
