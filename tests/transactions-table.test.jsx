import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import TransactionsTable from '../src/components/bills/TransactionsTable';
afterEach(()=>{cleanup();localStorage.clear();});
const transactions=[{id:'1',description:'Groceries',amount:20,type:'expense',date:'2026-11-12',category:'Food',source:'Manual'},{id:'2',description:'Pay',amount:100,type:'income',date:'2026-11-13',source:'Sample data'}];
const props={transactions,categories:[],onSaveTransaction:vi.fn(),onAddTransaction:vi.fn(),onSuggestCategories:vi.fn()};
it('migrates saved column preferences and removes recurring status and controls',()=>{
 localStorage.setItem('transactions-table-columns','date,name,amount,status');render(<TransactionsTable {...props}/>);
 const table=screen.getByRole('table',{name:'Transactions'});
 expect(within(table).getAllByRole('columnheader').map(h=>h.textContent)).toEqual(['Date','Description','Amount']);
 expect(screen.queryByText('Recurring')).toBeNull();expect(screen.queryByText('Add as bill')).toBeNull();expect(screen.queryByText('Status')).toBeNull();
 expect(within(table).getAllByRole('row')[1].textContent).toContain('Pay');expect(screen.getByText('+$100.00')).toBeTruthy();expect(screen.getByText('-$20.00')).toBeTruthy();
});
it('filters and clears results while retaining category editing',()=>{
 render(<TransactionsTable {...props}/>);fireEvent.change(screen.getByRole('textbox',{name:'Search transactions'}),{target:{value:'Groceries'}});
 expect(screen.queryByText('Pay')).toBeNull();expect(screen.getByRole('status').textContent).toContain('1 transaction');
 fireEvent.click(screen.getByText('Filter transactions'));fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect(screen.getByText('Pay')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Edit category for Groceries'}));expect(screen.getByRole('dialog')).toBeTruthy();
});
