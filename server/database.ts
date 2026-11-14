import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import type { readServerConfig } from './config.ts';

export type Row = Record<string, any>;
export interface Transaction { query(sql: string, params?: unknown[]): Promise<Row[]> }
export interface Database {
  dialect: 'sqlite' | 'postgres';
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  snapshot?(destination: string): Promise<void>;
  close(): Promise<void>;
}
export function sqliteDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  let queue: Promise<unknown> = Promise.resolve();
  const tx: Transaction = { async query(sql, params = []) {
    const args: any[] = [];
    const statement = sql.replace(/\$(\d+)/g, (_, n) => { args.push(params[Number(n) - 1]); return '?'; });
    return db.prepare(statement).all(...args);
  } };
  return {
    dialect: 'sqlite',
    transaction(work) {
      const result = queue.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try { const value = await work(tx); db.exec('COMMIT'); return value; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      });
      queue = result.catch(() => {});
      return result;
    },
    snapshot(destination) {
      const result=queue.then(async()=>{await backup(db,destination);});
      queue=result.catch(()=>{});return result;
    },
    async close() { await queue; db.close(); },
  };
}
export function postgresDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  return {
    dialect: 'postgres',
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await work({ query: async (sql, params = []) => (await client.query(sql, params)).rows });
        await client.query('COMMIT'); return value;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}
export function openDatabase(config: ReturnType<typeof readServerConfig>): Database {
  return config.storage.driver === 'sqlite'
    ? sqliteDatabase(config.storage.path!) : postgresDatabase(config.storage.connectionString!);
}
export async function migrate(db: Database, targetVersion: 1 | 2 | 3 | 4 = 4) {
  await db.transaction(async tx => {
    if (db.dialect === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(718303)');
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const versions = await tx.query('SELECT MAX(version) AS version FROM schema_migrations');
    const version = Number(versions[0].version ?? 0);
    if (version > targetVersion) throw new Error('This database needs a newer Avera version.');
    if (version < 1) {
    await tx.query(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, display_name TEXT NOT NULL, created_at TEXT NOT NULL)`);
    await tx.query(`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL)`);
    await tx.query(`CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id), body ${db.dialect === 'sqlite' ? 'TEXT' : 'JSONB'} NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      deleted_at TEXT, dedupe_key TEXT, PRIMARY KEY(collection,id))`);
    await tx.query('CREATE INDEX record_owner ON records(owner_id,collection,deleted_at,id)');
    await tx.query('CREATE UNIQUE INDEX record_dedupe ON records(owner_id,collection,dedupe_key) WHERE deleted_at IS NULL AND dedupe_key IS NOT NULL');
    await tx.query(`CREATE TABLE changes (seq ${db.dialect === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGSERIAL PRIMARY KEY'},
      owner_id TEXT NOT NULL, collection TEXT NOT NULL, record_id TEXT NOT NULL,
      revision INTEGER NOT NULL, operation TEXT NOT NULL, changed_at TEXT NOT NULL)`);
    await tx.query(`CREATE TABLE feedback (owner_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
      rating INTEGER NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,request_id))`);
    await tx.query('INSERT INTO schema_migrations(version,applied_at) VALUES(1,$1)', [new Date().toISOString()]);
    }
    if (version < 2 && targetVersion >= 2) {
      await tx.query(`CREATE TABLE private_data(owner_id TEXT NOT NULL, collection TEXT NOT NULL,
        natural_key TEXT NOT NULL, id TEXT NOT NULL UNIQUE, ciphertext TEXT NOT NULL,
        PRIMARY KEY(owner_id,collection,natural_key))`);
      await tx.query('CREATE TABLE service_leases(lease_key TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at BIGINT NOT NULL)');
      await tx.query('CREATE TABLE service_usage(usage_key TEXT PRIMARY KEY, used INTEGER NOT NULL, expires_at BIGINT NOT NULL)');
      await tx.query('CREATE TABLE ai_consent(owner_id TEXT PRIMARY KEY REFERENCES users(id), enabled INTEGER NOT NULL, updated_at TEXT NOT NULL)');
      await tx.query('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
      await tx.query('ALTER TABLE users ADD COLUMN pending_verification INTEGER NOT NULL DEFAULT 0');
      await tx.query(`CREATE TABLE auth_challenges(token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL,
        user_id TEXT REFERENCES users(id), payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        expires_at BIGINT NOT NULL, used INTEGER NOT NULL DEFAULT 0)`);
      await tx.query(`CREATE TABLE oauth_accounts(provider TEXT NOT NULL, subject TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(provider,subject))`);
      await tx.query('INSERT INTO schema_migrations(version,applied_at) VALUES(2,$1)',[new Date().toISOString()]);
    }
    if(version < 3 && targetVersion >= 3){
      await tx.query('CREATE TABLE sample_workspaces(owner_id TEXT NOT NULL REFERENCES users(id), profile TEXT NOT NULL, initialized_at TEXT NOT NULL, PRIMARY KEY(owner_id,profile))');
      await tx.query('INSERT INTO schema_migrations(version,applied_at) VALUES(3,$1)',[new Date().toISOString()]);
    }
    if(version < 4 && targetVersion >= 4){
      await tx.query(`CREATE TABLE owner_files(owner_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL,
        name TEXT NOT NULL, mime_type TEXT NOT NULL, content_base64 TEXT NOT NULL, sha256 TEXT NOT NULL,
        record_collection TEXT, record_id TEXT, PRIMARY KEY(owner_id,id))`);
      await tx.query(`CREATE TABLE recovery_backups(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,created_at TEXT NOT NULL,bytes BIGINT NOT NULL)`);
      await tx.query(`CREATE TABLE recovery_status(owner_id TEXT PRIMARY KEY REFERENCES users(id),
        last_success TEXT,last_attempt TEXT,last_error TEXT,copy_error TEXT)`);
      await tx.query('CREATE TABLE recovery_bank_rows(owner_id TEXT NOT NULL REFERENCES users(id), collection TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(owner_id,collection,id))');
      await tx.query(`CREATE TABLE recovery_imports(owner_id TEXT NOT NULL REFERENCES users(id),fingerprint TEXT NOT NULL,
        applied_at TEXT NOT NULL,PRIMARY KEY(owner_id,fingerprint))`);
      await tx.query('INSERT INTO schema_migrations(version,applied_at) VALUES(4,$1)',[new Date().toISOString()]);
    }
  });
}
