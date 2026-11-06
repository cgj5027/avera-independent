import { createHash } from 'node:crypto';
import { recordSchemas, object } from './validation.ts';
import { invalid } from './errors.ts';

export function recordQuery(dialect: 'sqlite' | 'postgres', owner: string, name: string, query: unknown, options: unknown) {
  const params: unknown[] = [owner, name];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const metadata: Record<string, string> = { id:'id',created_by_id:'owner_id',created_date:'created_at',updated_date:'updated_at' };
  function field(key: string): string {
    if (Object.hasOwn(metadata,key)) return metadata[key];
    if (!Object.hasOwn(recordSchemas[name].properties,key) || !/^[a-z_]+$/.test(key)) invalid('Invalid query field.');
    const type = recordSchemas[name].properties[key].type;
    if (dialect === 'sqlite') return `json_extract(body,'$.${key}')`;
    if (type === 'number' || type === 'integer') return `CAST(body->>'${key}' AS DOUBLE PRECISION)`;
    if (type === 'boolean') return `CAST(body->>'${key}' AS BOOLEAN)`;
    return `(body->>'${key}')`;
  }
  let count = 0;
  function condition(value: unknown, depth = 0): string {
    if (depth > 5 || ++count > 100) invalid('Query is too complex.');
    const parts = Object.entries(object(value)).map(([key, value]) => {
      if (key === '$or' || key === '$and') {
        if (!Array.isArray(value) || !value.length || value.length > 100) invalid();
        return '(' + value.map(v => condition(v, depth+1)).join(key === '$or' ? ' OR ' : ' AND ') + ')';
      }
      const column = field(key);
      if (value === null) return `${column} IS NULL`;
      if (typeof value === 'object') {
        const operators = Object.entries(object(value));
        if (!operators.length) invalid();
        return '(' + operators.map(([op, v]) => {
          if (op === '$exists' && typeof v === 'boolean') {
            // Preserve the distinction between absent and explicit null.
            if (Object.hasOwn(metadata,key)) return `${column} IS ${v ? 'NOT ' : ''}NULL`;
            return dialect === 'sqlite' ? `json_type(body,'$.${key}') IS ${v ? 'NOT ' : ''}NULL`
              : `${v ? '' : 'NOT '}(body ? ${bind(key)})`;
          }
          if (op === '$in' && Array.isArray(v) && v.length > 0 && v.length <= 100 && v.every(x => typeof x === 'string' || typeof x === 'number')) {
            return `${column} IN (${v.map(bind).join(',')})`;
          }
          invalid('Unsupported query operator.');
        }).join(' AND ') + ')';
      }
      if (!['string','number','boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) invalid();
      return `${column}=${bind(dialect === 'sqlite' && typeof value === 'boolean' ? Number(value) : value)}`;
    });
    return parts.length ? '(' + parts.join(' AND ') + ')' : '1=1';
  }
  const q = object(query ?? {}), opts = object(options ?? {});
  if (Object.keys(opts).some(key => !['limit','cursor','sort'].includes(key))) invalid('Unsupported page option.');
  const limit = opts.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('Invalid page limit.');
  const sort = opts.sort ?? 'id';
  if (typeof sort !== 'string' || !['id','created_date','updated_date','date','name'].includes(sort.replace(/^-/,''))) invalid('Invalid sort.');
  const descending = sort.startsWith('-');
  const expression = `COALESCE(${field(sort.replace(/^-/,''))},'')`;
  const scope = createHash('sha256').update(JSON.stringify([owner,name,q,sort])).digest('hex');
  let where = `owner_id=$1 AND collection=$2 AND deleted_at IS NULL AND ${condition(q)}`;
  if (opts.cursor !== undefined) {
    let cursor;
    try { if (typeof opts.cursor !== 'string' || opts.cursor.length > 2000) invalid(); cursor = object(JSON.parse(Buffer.from(opts.cursor,'base64url').toString())); }
    catch { invalid('Invalid cursor.'); }
    if (cursor.scope !== scope || typeof cursor.value !== 'string' || typeof cursor.id !== 'string') invalid('Invalid cursor.');
    const a = bind(cursor.value), id = bind(cursor.id), compare = descending ? '<' : '>';
    where += ` AND (${expression}${compare}${a} OR (${expression}=${a} AND id${compare}${id}))`;
  }
  return {
    sql: `SELECT *, ${expression} AS sort_value FROM records WHERE ${where} ORDER BY ${expression} ${descending ? 'DESC':'ASC'},id ${descending ? 'DESC':'ASC'} LIMIT ${bind(limit+1)}`,
    params, limit,
    cursor: (row: Record<string, any>) => Buffer.from(JSON.stringify({ scope, value:String(row.sort_value),id:row.id })).toString('base64url'),
  };
}
