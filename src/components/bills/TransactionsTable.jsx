import { useEffect, useMemo, useState } from 'react';
import { Search, Pencil, Download, Sparkles, Plus, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import ManualTransactionDialog from '@/components/bills/ManualTransactionDialog';
import { formatCurrency } from '@/utils/format';
import SourceChip from '@/components/states/SourceChip';

const PAGE_SIZE = 25;
const UNCATEGORIZED = 'uncategorized';
const CUSTOM_CATEGORY = '__custom__';

const isSynced = (t) => Boolean(t.plaid_item_id) || t.source === 'Plaid Sandbox';

const csvCell = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';

/* User-selectable table columns; the choice persists between visits. */
const COLUMN_DEFS = [
  { key: 'date', label: 'Date' },
  { key: 'name', label: 'Description' },
  { key: 'account', label: 'Account' },
  { key: 'category', label: 'Category' },
  { key: 'source', label: 'Source' },
  { key: 'amount', label: 'Amount' },
];
const DEFAULT_COLUMNS = ['date', 'name', 'category', 'source', 'amount'];
const COLUMNS_STORAGE_KEY = 'transactions-table-columns';
const loadColumns = () => {
  let saved;
  try { saved = localStorage.getItem(COLUMNS_STORAGE_KEY); } catch { return DEFAULT_COLUMNS; }
  const list = saved ? saved.split(',').filter((key) => COLUMN_DEFS.some((c) => c.key === key)) : [];
  return list.length > 0 ? list : DEFAULT_COLUMNS;
};

/**
 * Combined table of every transaction: imported from linked Plaid accounts and
 * manual entries, each labeled with its source. Filterable by search, date
 * range, account, transaction category, type, and source; paginated,
 * exportable, with editable names and budget-category assignment.
 */
export default function TransactionsTable({
  transactions,
  accounts = [],
  categories = [],
  categoryRemaining = {},
  busy,
  onSaveTransaction,
  onAddTransaction,
  onSuggestCategories,
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [type, setType] = useState('all');
  const [account, setAccount] = useState('all');
  const [source, setSource] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null); // { transaction, category }
  const [saveError, setSaveError] = useState('');

  const rows = useMemo(
    () => transactions.slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    [transactions]
  );

  const accountNames = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.plaid_account_id, a.name]));
    const used = [...new Set(rows.map((t) => t.plaid_account_id).filter(Boolean))];
    return used.map((id) => ({ id, name: map.get(id) || 'Linked account' }));
  }, [accounts, rows]);

  /* Budget categories first (they count toward the Budget tab), then other categories used before. */
  const budgetNames = useMemo(() => new Set(categories.map((c) => c.name)), [categories]);
  const otherCategoryOptions = useMemo(
    () => [...new Set(rows.map((t) => t.category).filter(Boolean))].filter((name) => !budgetNames.has(name)),
    [rows, budgetNames]
  );

  /* Which columns the user has chosen to show. */
  const [visibleCols, setVisibleCols] = useState(loadColumns);
  const show = Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, visibleCols.includes(c.key)]));
  const toggleColumn = (key) =>
    setVisibleCols((cols) => {
      const next = cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key];
      const ordered = COLUMN_DEFS.filter((c) => next.includes(c.key)).map((c) => c.key);
      if (!ordered.length) return cols;
      try { localStorage.setItem(COLUMNS_STORAGE_KEY, ordered.join(',')); } catch { /* Preferences are optional. */ }
      return ordered;
    });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((t) => {
      if (category !== 'all') {
        const value = t.category || 'Uncategorized';
        if (category === UNCATEGORIZED ? value !== 'Uncategorized' : value !== category) return false;
      }
      if (type !== 'all' && (t.type === 'income' ? 'income' : 'expense') !== type) return false;
      if (account !== 'all' && (t.plaid_account_id || '') !== account) return false;
      if (source !== 'all' && (source === 'synced') !== isSynced(t)) return false;
      if (dateFrom && (t.date ?? '') < dateFrom) return false;
      if (dateTo && (t.date ?? '') > dateTo) return false;
      if (!q) return true;
      const haystack = `${t.description ?? ''} ${t.category ?? ''} ${t.source ?? ''} ${accountNames.find((a) => a.id === t.plaid_account_id)?.name ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, category, type, account, source, dateFrom, dateTo, accountNames]);

  useEffect(() => {
    setPage(0);
  }, [search, category, type, account, source, dateFrom, dateTo]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = visible.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(visible.length, safePage * PAGE_SIZE + PAGE_SIZE);

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!editing || busy) return;
    setSaveError('');
    try {
      await onSaveTransaction(editing.transaction.id, {
        category: String(editing.category ?? ''),
      });
      setEditing(null);
    } catch {
      setSaveError('Unable to save. Please try again.');
    }
  };

  const csvColumns = {
    date: (t) => t.date ?? '',
    name: (t) => t.description ?? '',
    account: (t) => accountNames.find((a) => a.id === t.plaid_account_id)?.name ?? '',
    category: (t) => t.category ?? '',
    source: (t) => (isSynced(t) ? 'Synced' : 'Manual'),
    amount: (t) => String(t.amount ?? ''),
  };

  /* Exports exactly the columns currently shown. */
  const exportCsv = () => {
    const lines = [
      visibleCols.map((key) => COLUMN_DEFS.find((c) => c.key === key).label).map(csvCell).join(','),
      ...visible.map((t) => visibleCols.map((key) => csvCell(csvColumns[key](t))).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'transactions.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">All transactions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review your linked-bank and manual transactions. Search, filter and edit budget categories.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setSaveError('');
              setAddOpen(true);
            }}
            disabled={busy}
            className="min-h-11 w-full rounded-xl sm:w-auto"
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add transaction
          </Button>
          <Button
            variant="secondary"
            onClick={onSuggestCategories}
            disabled={busy}
            className="min-h-11 w-full rounded-xl sm:w-auto"
          >
            <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
            Suggest categories
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={exportCsv}
            disabled={visible.length === 0}
            className="min-h-11 w-11 shrink-0 rounded-xl"
            aria-label="Export CSV"
            title="Export CSV"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="min-h-11 w-11 shrink-0 rounded-xl"
                aria-label="Choose columns"
                title="Choose columns"
              >
                <Columns3 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
              <p className="text-sm font-medium text-foreground">Columns shown</p>
              <div className="mt-2 space-y-2">
                {COLUMN_DEFS.map((col) => (
                  <Label key={col.key} htmlFor={`col-${col.key}`} className="flex items-center gap-2 font-normal">
                    <Checkbox
                      id={`col-${col.key}`}
                      checked={visibleCols.includes(col.key)}
                      disabled={visibleCols.length === 1 && visibleCols.includes(col.key)}
                      onCheckedChange={() => toggleColumn(col.key)}
                    />
                    {col.label}
                  </Label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="relative mt-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transactions"
          aria-label="Search transactions"
          className="w-full pl-9"
        />
      </div>

      <details className="mt-3 rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2">Filter transactions</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:!w-full">
          <label className="space-y-1 text-sm text-muted-foreground">
            <span>From date</span>
            <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="From date"
            className="w-full shrink-0 rounded-xl sm:w-40"
            />
          </label>
          <label className="space-y-1 text-sm text-muted-foreground">
            <span>To date</span>
            <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="To date"
            className="w-full shrink-0 rounded-xl sm:w-40"
            />
          </label>
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger className="w-full shrink-0 sm:w-40" aria-label="Filter by account">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accountNames.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full shrink-0 sm:w-48" aria-label="Filter by transaction category">
              <SelectValue placeholder="All transaction categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All transaction categories</SelectItem>
              <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
              {[...new Set([...categories.map((c) => c.name), ...otherCategoryOptions])].filter(name => name !== 'Uncategorized').map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full shrink-0 sm:w-32" aria-label="Filter by type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="expense">Expenses</SelectItem>
              <SelectItem value="income">Income</SelectItem>
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-full shrink-0 sm:w-44" aria-label="Filter by source">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="synced">Synced (linked bank)</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="ghost"
          className="mt-3 min-h-11"
          onClick={() => {
            setSearch('');
            setCategory('all');
            setType('all');
            setAccount('all');
            setSource('all');
            setDateFrom('');
            setDateTo('');
          }}
        >
          Clear filters
        </Button>
      </details>
      <p role="status" className="mt-4 text-sm text-muted-foreground">{visible.length} {visible.length === 1 ? 'transaction' : 'transactions'} · Newest first</p>

      {pageRows.length === 0 ? (
        <p className="mt-4 text-base text-muted-foreground">
          {rows.length === 0 ? 'No transactions yet.' : 'No transactions match these filters.'}
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <Table aria-label="Transactions">
            <caption className="sr-only">Transactions, newest first. Amounts show income with a plus sign and expenses with a minus sign.</caption>
            <TableHeader className="bg-surface-subtle [&_th]:px-4">
              <TableRow>
                {show.date && <TableHead>Date</TableHead>}
                {show.name && <TableHead>Description</TableHead>}
                {show.account && <TableHead>Account</TableHead>}
                {show.category && <TableHead>Category</TableHead>}
                {show.source && <TableHead>Source</TableHead>}
                {show.amount && <TableHead className="text-right">Amount</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((t) => {
                const isIncome = t.type === 'income';
                const synced = isSynced(t);
                return (
                  <TableRow key={t.id} className="[&>td]:px-4 [&>td]:py-4">
                    {show.date && (
                      <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{t.date}</TableCell>
                    )}
                    {show.name && (
                      <TableCell className="font-medium text-foreground">
                        {t.description || 'Unnamed'}
                        {t.exclude_from_cashflow && <span className="block text-xs text-muted-foreground">Transfer · excluded from cash flow</span>}
                      </TableCell>
                    )}
                    {show.account && (
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {accountNames.find((a) => a.id === t.plaid_account_id)?.name || '—'}
                      </TableCell>
                    )}
                    {show.category && (
                      <TableCell>
                        <span className="inline-flex items-center gap-1">
                        <span className="inline-flex items-center rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {t.category || 'Uncategorized'}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSaveError('');
                            setEditing({ transaction: t, category: t.category || '', custom: false });
                          }}
                          disabled={busy}
                          aria-label={`Edit category for ${t.description || 'transaction'}`}
                          className="min-h-11 min-w-11"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </span>
                      </TableCell>
                    )}
                    {show.source && (
                      <TableCell>
                        <SourceChip source={t.source || (synced ? 'Plaid Sandbox' : 'Manual')} />
                      </TableCell>
                    )}
                    {show.amount && (
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-foreground">
                        {isIncome ? '+' : '-'}
                        {formatCurrency(t.amount)}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {visible.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm tabular-nums text-muted-foreground">
            Showing {rangeStart}–{rangeEnd} of {visible.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="min-h-9 rounded-lg"
            >
              Previous
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              Page {safePage + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="min-h-9 rounded-lg"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link to budget category</DialogTitle>
            <DialogDescription>
              {editing?.transaction?.description || 'Unnamed'} · {editing?.transaction?.date || ''}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitEdit}>
            <div className="space-y-1.5">
              <Label htmlFor="txn-category">Budget category</Label>
              <Select
                value={
                  editing?.custom
                    ? CUSTOM_CATEGORY
                    : editing?.category || UNCATEGORIZED
                }
                onValueChange={(value) =>
                  setEditing((cur) => ({
                    ...cur,
                    custom: value === CUSTOM_CATEGORY,
                    category:
                      value === UNCATEGORIZED || value === CUSTOM_CATEGORY ? '' : value,
                  }))
                }
              >
                <SelectTrigger id="txn-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Budget categories</SelectLabel>
                    <SelectItem value={UNCATEGORIZED}>Not linked</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                        {categoryRemaining[c.name] !== undefined
                          ? ` · ${formatCurrency(categoryRemaining[c.name])} left`
                          : ''}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {otherCategoryOptions.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Other categories used before</SelectLabel>
                      {otherCategoryOptions.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectItem value={CUSTOM_CATEGORY}>Other (type a category)</SelectItem>
                </SelectContent>
              </Select>
              {editing?.custom && (
                <Input
                  value={editing?.category ?? ''}
                  onChange={(e) => setEditing((cur) => ({ ...cur, category: e.target.value }))}
                  placeholder="Type a category name"
                  aria-label="Custom transaction category"
                  className="mt-2 min-h-11 rounded-xl"
                  autoFocus
                />
              )}
              <p className="text-xs text-muted-foreground">
                Spending counts in the transaction’s month in the Budget tab. A new category creates a budget card with a $0 limit; edit its limit in Budget.
              </p>
            </div>
            {saveError && <p role="alert" className="text-base text-danger-text">{saveError}</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}>Save link</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ManualTransactionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        categories={categories}
        onSave={onAddTransaction}
      />
    </section>
  );
}