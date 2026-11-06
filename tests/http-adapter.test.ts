import { it, expect, vi } from 'vitest';
import { createHttpAdapter } from '../src/platform/adapters/http';

it('uses same-origin cookie requests and preserves local API error codes',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({id:'owner'}));
  const api=createHttpAdapter({fetcher});
  expect(await api.auth.currentUser()).toEqual({id:'owner'});
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/me');
  expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'same-origin',redirect:'error'});
  expect(api.capabilities?.emailVerification).toBe(false);
  fetcher.mockResolvedValue(Response.json({error:'Online services are not configured.',code:'INTEGRATIONS_UNAVAILABLE'},{status:503}));
  await expect(api.services.invoke('askAvera',{question:'Budget?'})).rejects.toMatchObject({status:503,code:'INTEGRATIONS_UNAVAILABLE'});
});
it('never navigates before session revocation succeeds and rejects external return targets',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline')),navigate=vi.fn();
  const api=createHttpAdapter({fetcher,navigate});
  await expect(api.auth.signOut('/login')).rejects.toMatchObject({code:'SERVICE_UNAVAILABLE'});
  expect(navigate).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(Response.json({signed_out:true}));
  await api.auth.signOut('https://untrusted.example');
  expect(navigate).toHaveBeenCalledWith('/');
});
it('routes record writes through the selected API and keeps bank credentials inaccessible',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({id:'bill'}));
  const api=createHttpAdapter({fetcher});
  await api.records.collection('Bill').create({name:'Rent',amount:100});
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/records/Bill');
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({name:'Rent',amount:100});
  expect(()=>api.records.collection('PlaidCredential')).toThrow('Unknown record collection');
});
