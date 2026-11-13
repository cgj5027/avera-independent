import {it,expect,vi} from 'vitest';
import {createJobArea} from '../server/integrations/logic/jobDistance.js';
const place=(lng,extra={})=>({location:{lat:40,lng},accuracy:1,accuracy_type:'place',address_components:{city:'Fixture City'},...extra});
it('filters distance, caches locations and uses only key-free Geocodio requests',async()=>{
 const fetcher=vi.fn(async raw=>{const url=new URL(raw);expect(url.origin).toBe('https://api.geocod.io');expect(url.searchParams.has('api_key')).toBe(false);return Response.json({results:[place(url.searchParams.get('q')==='Origin'?-75:-74.99)]});});
 const area=createJobArea({location:'Origin'},fetcher);
 expect(await area.filter([{location:'Near'},{location:'Near'}])).toHaveLength(2);expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects ambiguous, weak, non-local and malformed matches',async()=>{
 for(const results of [[place(-75),place(-100)],[place(-75,{accuracy:0.5})],[place(-75,{address_components:{}})],[place(-75,{location:{lat:NaN,lng:-75}})]]){
  await expect(createJobArea({location:'Origin'},async()=>Response.json({results})).validate()).rejects.toMatchObject({status:422,code:'LOCATION_REQUIRED'});
 }
});
it('fails closed on quota errors, malformed responses and network failures',async()=>{
 for(const fetcher of [async()=>new Response('quota',{status:429}),async()=>Response.json({}),async()=>{throw Error('private-key-detail');}]){
  await expect(createJobArea({location:'Origin'},fetcher).validate()).rejects.toMatchObject({status:503,code:'LOCATION_UNAVAILABLE'});
 }
});
it('skips blank locations and bounds charged lookups to thirteen per search',async()=>{
 const fetcher=vi.fn(async()=>Response.json({results:[place(-75)]}));
 await createJobArea({},fetcher).filter([{location:'Near'}]);expect(fetcher).not.toHaveBeenCalled();
 await createJobArea({location:'Origin'},fetcher).filter(Array.from({length:30},(_,i)=>({location:'Place '+i})));expect(fetcher).toHaveBeenCalledTimes(13);
});
it('preserves the requested radius and marks partial results when a destination fails',async()=>{
 const fetcher=async raw=>{const q=new URL(raw).searchParams.get('q');return q==='Broken'?new Response('unavailable',{status:503}):Response.json({results:[place(q==='Origin'?-75:q==='Far'?-73:-74.99)]});};
 const area=createJobArea({location:'Origin',distance_miles:25},fetcher);
 expect((await area.filter([{location:'Near'},{location:'Far'},{location:'Broken'}])).map(row=>row.location)).toEqual(['Near']);expect(area.partial).toBe(true);
});
