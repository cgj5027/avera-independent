import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
const search=vi.hoisted(()=>vi.fn());
vi.mock('@/services/assistantService',()=>({searchOpportunities:search,jobSearchErrorMessage:()=> 'Search unavailable'}));
import OpportunityResults from '../src/components/opportunities/OpportunityResults';
afterEach(cleanup);beforeEach(()=>search.mockReset());
describe('posting availability disclosures',()=>{
 it('shows a check time and distinguishes closed listings from unconfirmed pages',async()=>{
  search.mockResolvedValue({items:[{title:'Bookkeeper',company:'Fixture Employer',url:'https://careers.employer.com/jobs/123',source_provider:'web_search',availability_checked_at:'2026-11-13T12:00:00Z'}],sources:[{provider:'web_search',status:'searched'}],availabilitySummary:{checked:3,excluded_closed:1,excluded_unverified:1}});
  render(<OpportunityResults profile={{skills:'Bookkeeping'}}/>);fireEvent.click(screen.getByRole('button',{name:'Find opportunities'}));
  expect(await screen.findByText(/Posting checked/)).toBeTruthy();expect(screen.getByText(/Availability can change/)).toBeTruthy();
  expect(screen.getByText(/Excluded 1 closed or expired and 1/)).toBeTruthy();expect(screen.getByText(/Inaccessible pages are not assumed closed/)).toBeTruthy();
 });
 it('does not substitute sample openings when all source postings fail availability checks',async()=>{
  search.mockResolvedValue({items:[],sources:[{provider:'web_search',status:'searched'}],availabilitySummary:{checked:2,excluded_closed:1,excluded_unverified:1}});
  render(<OpportunityResults profile={{skills:'Bookkeeping'}}/>);fireEvent.click(screen.getByRole('button',{name:'Find opportunities'}));
  expect(await screen.findByText(/No matching postings with confirmed availability/)).toBeTruthy();expect(screen.queryByRole('link',{name:'View source listing'})).toBeNull();
 });
});
