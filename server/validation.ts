import schemas from '../shared/record-schemas.json' with { type: 'json' };
import { invalid } from './errors.ts';
export const recordSchemas: Record<string, any> = schemas;
export function collectionName(name: string) {
  if (!Object.hasOwn(recordSchemas, name)) invalid('Unknown collection.');
  return name;
}
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, any>;
}
const profiles = ['', 'early_career', 'multi_income', 'financial_improvement'];
export function validateRecord(name: string, input: unknown, previous?: Record<string, any>, trusted = false) {
  const schema = recordSchemas[collectionName(name)];
  const fields = object(input);
  if (!trusted && (name === 'PlaidItem' || name === 'GoalContribution')) invalid('This collection is managed by a service.');
  const result: Record<string, any> = {};
  for (const [key, rule] of Object.entries(schema.properties) as [string, any][]) {
    if (rule.default !== undefined) result[key] = rule.default;
  }
  Object.assign(result, previous ?? {});
  for (const [key, value] of Object.entries(fields)) {
    if (!Object.hasOwn(schema.properties, key)) invalid('Unknown or protected record field.');
    result[key] = value;
  }
  for (const key of schema.required) {
    if (result[key] === undefined || result[key] === null || (typeof result[key] === 'string' && !result[key].trim())) invalid(`Missing ${key}.`);
  }
  for (const [key, value] of Object.entries(result)) {
    const rule = schema.properties[key];
    if (!rule) invalid();
    if (rule.type === 'string') {
      if (typeof value !== 'string' || value.length > (key === 'notes' || key === 'assumptions' ? 12000 : 4000) || value.includes('\0')) invalid(`Invalid ${key}.`);
      if (rule.format === 'date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) invalid(`Invalid ${key}.`);
    } else if (rule.type === 'number' || rule.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12 ||
        (rule.type === 'integer' && !Number.isInteger(value)) || (rule.minimum !== undefined && value < rule.minimum) ||
        (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum) || (rule.maximum !== undefined && value > rule.maximum)) invalid(`Invalid ${key}.`);
    } else if (rule.type === 'boolean') { if (typeof value !== 'boolean') invalid(`Invalid ${key}.`); }
    else if (rule.type === 'array') { if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 4000)) invalid(`Invalid ${key}.`); }
    else invalid('Unsupported field type.');
    if (rule.enum && !rule.enum.includes(value)) invalid(`Invalid ${key}.`);
  }
  if (!profiles.includes(result.demo_profile ?? '')) invalid('Invalid demo profile.');
  if (previous && (previous.demo_profile ?? '') !== (result.demo_profile ?? '')) invalid('A record cannot change datasets.');
  if (!trusted) {
    if (fields.source === 'Plaid Sandbox' && previous?.source !== 'Plaid Sandbox') invalid('Imported bank fields are managed by a service.');
    if (['plaid_item_id','plaid_account_id','plaid_transaction_id','import_key'].some(key => fields[key] && fields[key] !== previous?.[key])) invalid('Imported bank fields are managed by a service.');
    if (previous?.plaid_item_id) {
      const editable=name === 'Transaction' ? ['category','not_recurring','exclude_from_cashflow','notes'] : ['name','notes'];
      if (Object.keys(fields).some(key=>!editable.includes(key))) invalid('Imported financial values are managed by a service.');
    }
  }
  for (const key of ['amount','monthly_limit','target_amount','saved_amount','estimated_value','outstanding_balance','monthly_payment','taxes_monthly','insurance_monthly','hoa_monthly','maintenance_monthly']) {
    if (typeof result[key] === 'number' && result[key] < 0) invalid(`Invalid ${key}.`);
  }
  return result;
}
