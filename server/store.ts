import { randomUUID } from 'node:crypto';
import type { Database, Transaction, Row } from './database.ts';
import { ApiError, invalid, missing } from './errors.ts';
import { validateRecord, collectionName, object } from './validation.ts';
import { recordQuery } from './query.ts';

export function body(row: Row): Record<string, any> { return typeof row.body === 'string' ? JSON.parse(row.body) : row.body; }
function dto(row: Row) {
  return { ...body(row),id:row.id,created_by_id:row.owner_id,created_date:row.created_at,updated_date:row.updated_at,revision:Number(row.revision) };
}
function dedupe(name: string, fields: Record<string, any>): string | null {
  if (name === 'BudgetCategory') return JSON.stringify([fields.demo_profile ?? '', fields.name.trim().toLowerCase()]);
  if ((name === 'Account' || name === 'Transaction') && fields.import_key) return fields.import_key;
  if (name === 'PlaidItem') return fields.item_id;
  if (name === 'GoalContribution') return fields.contribution_key;
  return null;
}
export class RecordStore {
  db: Database;
  constructor(db: Database) { this.db=db; }
  async raw(tx: Transaction, owner: string, name: string, id: string, lock = false): Promise<Row> {
    collectionName(name);
    const rows = await tx.query('SELECT * FROM records WHERE owner_id=$1 AND collection=$2 AND id=$3 AND deleted_at IS NULL' + (lock && this.db.dialect === 'postgres' ? ' FOR UPDATE' : ''), [owner,name,id]);
    return rows[0] ?? missing();
  }
  private async change(tx: Transaction, owner: string, name: string, id: string, revision: number, operation: string, at: string) {
    await tx.query('INSERT INTO changes(owner_id,collection,record_id,revision,operation,changed_at) VALUES($1,$2,$3,$4,$5,$6)', [owner,name,id,revision,operation,at]);
  }
  private async reference(tx: Transaction, owner: string, name: string, fields: Record<string, any>) {
    if (name !== 'MortgageRecord' && name !== 'GoalContribution') return;
    const parent = await this.raw(tx,owner,name === 'MortgageRecord' ? 'Property':'Goal',fields[name === 'MortgageRecord' ? 'property_id':'goal_id'],true);
    if ((body(parent).demo_profile ?? '') !== (fields.demo_profile ?? '')) invalid('Reference is outside this dataset.');
  }
  async insert(tx: Transaction, owner: string, name: string, input: unknown, trusted = false) {
    const fields = validateRecord(name,input,undefined,trusted);
    await this.reference(tx,owner,name,fields);
    const id=randomUUID(), at=new Date().toISOString();
    const rows=await tx.query(`INSERT INTO records(collection,id,owner_id,body,created_at,updated_at,dedupe_key)
      VALUES($1,$2,$3,$4,$5,$5,$6) RETURNING *`, [name,id,owner,JSON.stringify(fields),at,dedupe(name,fields)]);
    await this.change(tx,owner,name,id,1,'create',at);
    return dto(rows[0]);
  }
  create(owner: string, name: string, input: unknown) { return this.db.transaction(tx=>this.insert(tx,owner,name,input)); }
  createMany(owner: string, name: string, input: unknown) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 200) invalid('Use batches of 1 to 200 records.');
    return this.db.transaction(async tx => {
      const output=[];
      for (const fields of input) output.push(await this.insert(tx,owner,name,fields));
      return output;
    });
  }
  get(owner: string, name: string, id: string) { return this.db.transaction(async tx=>dto(await this.raw(tx,owner,name,id))); }
  list(owner: string, name: string, query: unknown = {}, options: unknown = {}) {
    collectionName(name);
    const plan=recordQuery(this.db.dialect,owner,name,query,options);
    return this.db.transaction(async tx => {
      const rows=await tx.query(plan.sql,plan.params), items=rows.slice(0,plan.limit);
      return { items:items.map(dto),has_more:rows.length>plan.limit,next_cursor:rows.length>plan.limit ? plan.cursor(items[items.length-1]) : null };
    });
  }
  update(owner: string, name: string, id: string, input: unknown, trusted=false) {
    return this.db.transaction(async tx => {
      const previous=await this.raw(tx,owner,name,id,true);
      const fields=validateRecord(name,input,body(previous),trusted);
      await this.reference(tx,owner,name,fields);
      const at=new Date().toISOString(), revision=Number(previous.revision)+1;
      const rows=await tx.query(`UPDATE records SET body=$1,updated_at=$2,revision=$3,dedupe_key=$4
        WHERE owner_id=$5 AND collection=$6 AND id=$7 RETURNING *`,[JSON.stringify(fields),at,revision,dedupe(name,fields),owner,name,id]);
      await this.change(tx,owner,name,id,revision,'update',at);
      return dto(rows[0]);
    });
  }
  delete(owner: string, name: string, id: string, trusted=false) {
    if (name === 'PlaidItem' && !trusted) invalid('This collection is managed by a service.');
    return this.db.transaction(async tx => {
      const parent=await this.raw(tx,owner,name,id,true);
      if (name === 'GoalContribution' && !body(parent).demo_profile) invalid('Delete the goal to remove its contributions.');
      const rows=[parent];
      if (name === 'Goal' || name === 'Property') {
        const child=name === 'Goal' ? 'GoalContribution':'MortgageRecord';
        const children=await tx.query('SELECT * FROM records WHERE owner_id=$1 AND collection=$2 AND deleted_at IS NULL',[owner,child]);
        rows.push(...children.filter(row=>body(row)[name === 'Goal' ? 'goal_id':'property_id'] === id));
      }
      for (const row of rows) {
        const at=new Date().toISOString(), revision=Number(row.revision)+1;
        await tx.query('UPDATE records SET deleted_at=$1,updated_at=$1,revision=$2,dedupe_key=NULL WHERE owner_id=$3 AND collection=$4 AND id=$5',[at,revision,owner,row.collection,row.id]);
        await this.change(tx,owner,row.collection,row.id,revision,'delete',at);
      }
      return { deleted:true };
    });
  }
  contribution(owner: string, input: unknown) {
    const data=object(input);
    if (typeof data.goal_id !== 'string' || typeof data.request_id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.request_id) ||
      typeof data.amount !== 'number' || data.amount <= 0 || data.amount > 1e9 || !Number.isFinite(data.amount) || Math.abs(data.amount*100-Math.round(data.amount*100))>0.0001) invalid('Enter a valid contribution.');
    const dataset=object(data.dataset);
    if (dataset.mode !== 'ordinary' && dataset.mode !== 'demo') invalid('Invalid dataset.');
    return this.db.transaction(async tx => {
      const goal=await this.raw(tx,owner,'Goal',data.goal_id,true), profile=body(goal).demo_profile ?? '';
      if ((dataset.mode === 'demo' ? dataset.profile : '') !== profile) missing();
      const key=JSON.stringify([owner,data.goal_id,data.request_id]);
      const existing=await tx.query('SELECT * FROM records WHERE owner_id=$1 AND collection=$2 AND dedupe_key=$3 AND deleted_at IS NULL',[owner,'GoalContribution',key]);
      if (existing.length) {
        if (body(existing[0]).amount !== data.amount) throw new ApiError(409,'CONFLICT','Use a new request for a different contribution.');
      } else await this.insert(tx,owner,'GoalContribution',{goal_id:data.goal_id,amount:data.amount,contribution_key:key,demo_profile:profile},true);
      return { saved:true };
    });
  }
}
