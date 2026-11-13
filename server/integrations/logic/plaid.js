export class PlaidFailure extends Error {constructor(code='PLAID_UNAVAILABLE'){super('Plaid request unavailable.');this.code=code;}}
export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}
export async function allRecords(entity, query, options = {}) {
  const rows = []; const seen = new Set(); let cursor; let pages = 0;
  do {
    if (++pages > 100) throw new Error('Record pagination limit exceeded');
    if (rows.length >= 5000) throw new Error('Record limit exceeded; no partial totals returned');
    const page = await entity.filter(query, { ...options, limit: 100, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page.items)) throw new Error('Invalid entity response');
    if (rows.length + page.items.length > 5000) throw new Error('Record limit exceeded; no partial totals returned');
    rows.push(...page.items);
    if (!page.has_more) return rows;
    if (!page.next_cursor || seen.has(page.next_cursor)) throw new Error('Invalid entity cursor');
    cursor = page.next_cursor; seen.add(cursor);
  } while (cursor);
  return rows;
}
export function safeError(error) {
  const codes = ['ITEM_LOGIN_REQUIRED','INVALID_ACCESS_TOKEN','ITEM_NOT_FOUND','PRODUCT_NOT_READY','TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION','NOT_CONFIGURED'];
  return error instanceof PlaidFailure && codes.includes(error.code) ? error.code : 'SYNC_FAILED';
}
// Bounded details only. Never use this for totals that require every record.
export async function recentRecords(entity, query, options = {}, maximum = 120) {
  const rows = []; const seen = new Set(); let cursor;
  do {
    const page = await entity.filter(query, { ...options, limit: Math.min(100, maximum - rows.length), ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page.items)) throw new Error('Invalid entity response');
    rows.push(...page.items.slice(0, maximum - rows.length));
    if (rows.length >= maximum || !page.has_more) return rows;
    if (!page.next_cursor || seen.has(page.next_cursor)) throw new Error('Invalid entity cursor');
    cursor = page.next_cursor; seen.add(cursor);
  } while (cursor);
  return rows;
}
