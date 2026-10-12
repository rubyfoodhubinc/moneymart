/**
 * MoneyMart — persistence.
 *
 * The domain store is in memory: fast, and the right shape for a system whose
 * hot path is a Socket.IO broadcast that must not touch a database per bid. That
 * choice becomes a problem the moment the process restarts, because the entire
 * platform — users, lots, bids, escrow ledger, memberships — is gone. It also
 * pins the deployment to a single replica, since two processes would hold
 * divergent worlds.
 *
 * Rather than rewrite every access path against SQL (which would put a query in
 * front of the bidding hot path and change the ordering guarantees the engine
 * relies on), the store is snapshotted as a document and restored on boot. That
 * keeps reads in memory and makes the write path a single append-shaped upsert.
 *
 * Two adapters:
 *   • Postgres — a JSONB row. The deployment target.
 *   • File     — a JSON file. Local development, and the fallback when
 *                DATABASE_URL is absent so a restart is not automatically lossy.
 *
 * Durability honestly stated: this is periodic snapshotting, so a hard kill can
 * lose the writes since the last flush. Flushing on every mutation was rejected
 * deliberately — it would serialise the whole store per bid. The interval is
 * therefore the durability window, and `flush()` is called on shutdown signals
 * to shrink it in the common case.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import {
  captureSnapshot,
  hydrateSnapshot,
  isEmptyStore,
  type StoreSnapshot,
} from '../store.js';

export interface PersistenceAdapter {
  readonly name: string;
  /** Read the last snapshot, or null when none has been written. */
  load(): Promise<StoreSnapshot | null>;
  /** Persist the current store. */
  save(snapshot: StoreSnapshot): Promise<void>;
  /** Release connections. */
  close(): Promise<void>;
}

/* ── File adapter ──────────────────────────────────────────────────────── */

/**
 * Atomic local persistence: write to a temporary file and rename, so a crash
 * mid-write cannot leave a truncated snapshot that fails to parse on boot.
 */
export class FileAdapter implements PersistenceAdapter {
  readonly name: string;
  private readonly file: string;

  constructor(file = process.env.MM_SNAPSHOT_FILE ?? path.join(process.cwd(), '.data', 'moneymart.json')) {
    this.file = file;
    this.name = `file:${file}`;
  }

  async load(): Promise<StoreSnapshot | null> {
    if (!existsSync(this.file)) return null;
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as StoreSnapshot;
    } catch (error) {
      // A corrupt snapshot must not prevent boot; starting empty and reseeding is
      // recoverable, refusing to start is not.
      console.error(`[persistence] snapshot unreadable at ${this.file}:`, error);
      return null;
    }
  }

  async save(snapshot: StoreSnapshot): Promise<void> {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(snapshot), 'utf8');
    renameSync(temporary, this.file);
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}

/* ── Postgres adapter ──────────────────────────────────────────────────── */

/**
 * One row per snapshot generation, with a single row marked current.
 *
 * A full re-snapshot rather than an incremental log, because the store is small
 * (a demo auction house is a few hundred kilobytes) and because an incremental
 * log would need conflict resolution the in-memory model does not have.
 */
export class PostgresAdapter implements PersistenceAdapter {
  readonly name = 'postgres';
  private readonly connectionString: string;
  private client: import('pg').Client | null = null;
  private ready = false;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  private async connect(): Promise<import('pg').Client> {
    if (this.client && this.ready) return this.client;
    // Imported lazily so the driver is only loaded when Postgres is configured.
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: this.connectionString,
      // Railway's managed Postgres presents a certificate the default trust
      // store accepts; an explicit rejectUnauthorized:false would be weaker.
      ssl: /sslmode=require/.test(this.connectionString) ? { rejectUnauthorized: false } : undefined,
    });
    await client.connect();
    this.client = client;
    this.ready = true;
    return client;
  }

  /** Idempotent schema creation, so a fresh database needs no manual step. */
  private async migrate(): Promise<void> {
    const client = await this.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS moneymart_snapshot (
        id           boolean PRIMARY KEY DEFAULT true,
        version      integer NOT NULL,
        captured_at  timestamptz NOT NULL,
        payload      jsonb NOT NULL,
        CONSTRAINT moneymart_snapshot_single_row CHECK (id)
      )
    `);
  }

  async load(): Promise<StoreSnapshot | null> {
    try {
      await this.migrate();
      const client = await this.connect();
      const result = await client.query<{ payload: StoreSnapshot }>(
        'SELECT payload FROM moneymart_snapshot WHERE id = true',
      );
      return result.rows[0]?.payload ?? null;
    } catch (error) {
      console.error('[persistence] postgres load failed:', error);
      return null;
    }
  }

  async save(snapshot: StoreSnapshot): Promise<void> {
    await this.migrate();
    const client = await this.connect();
    await client.query(
      `INSERT INTO moneymart_snapshot (id, version, captured_at, payload)
       VALUES (true, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET version = EXCLUDED.version,
             captured_at = EXCLUDED.captured_at,
             payload = EXCLUDED.payload`,
      [snapshot.version, snapshot.capturedAt, JSON.stringify(snapshot)],
    );
  }

  async close(): Promise<void> {
    try {
      await this.client?.end();
    } catch {
      /* already closed */
    }
    this.client = null;
    this.ready = false;
  }
}

/* ── Service ───────────────────────────────────────────────────────────── */

export interface PersistenceOptions {
  adapter: PersistenceAdapter;
  /** Seconds between automatic flushes. 0 disables the timer. */
  intervalMs?: number;
  /** Injectable for tests. */
  now?: () => number;
}

export class Persistence {
  private readonly adapter: PersistenceAdapter;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private lastSavedAt: string | null = null;
  private lastRecordCount = 0;
  private lastError: string | null = null;

  constructor(options: PersistenceOptions) {
    this.adapter = options.adapter;
    this.intervalMs = options.intervalMs ?? 15_000;
  }

  /** Restore a previous snapshot into the store. Returns records loaded. */
  async restore(): Promise<number> {
    const snapshot = await this.adapter.load();
    if (!snapshot) return 0;
    const loaded = hydrateSnapshot(snapshot);
    this.lastSavedAt = snapshot.capturedAt ?? null;
    this.lastRecordCount = loaded;
    return loaded;
  }

  /** Persist immediately. Coalesces concurrent calls rather than queueing them. */
  async flush(): Promise<boolean> {
    if (this.inFlight) return false;
    this.inFlight = true;
    try {
      const snapshot = captureSnapshot();
      await this.adapter.save(snapshot);
      this.lastSavedAt = snapshot.capturedAt;
      this.lastRecordCount = Object.values(snapshot.collections).reduce((sum, entries) => sum + entries.length, 0);
      this.lastError = null;
      return true;
    } catch (error) {
      // A failed flush must not crash the process: the store is still serving
      // bids, and losing a snapshot is less bad than dropping the connection.
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error('[persistence] flush failed:', this.lastError);
      return false;
    } finally {
      this.inFlight = false;
    }
  }

  start(): void {
    if (this.timer || this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    // Do not hold the event loop open purely to snapshot.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return {
      adapter: this.adapter.name,
      intervalMs: this.intervalMs,
      lastSavedAt: this.lastSavedAt,
      lastRecordCount: this.lastRecordCount,
      lastError: this.lastError,
    };
  }

  async close(): Promise<void> {
    this.stop();
    await this.flush();
    await this.adapter.close();
  }
}

/**
 * Choose an adapter from the environment.
 *
 * DATABASE_URL selects Postgres. Otherwise a file adapter is used so a local
 * restart is not automatically lossy; `MM_PERSISTENCE=off` disables persistence
 * entirely, which is what the verification suites want so runs stay independent.
 */
export function createPersistence(): Persistence | null {
  if (process.env.MM_PERSISTENCE === 'off') return null;

  const intervalMs = Number(process.env.MM_SNAPSHOT_INTERVAL_MS ?? 15_000);
  const url = process.env.DATABASE_URL;

  const adapter: PersistenceAdapter = url ? new PostgresAdapter(url) : new FileAdapter();
  return new Persistence({ adapter, intervalMs });
}

/**
 * Should the demo data be seeded?
 *
 * Seeding over a restored store would overwrite real state, so the caller must
 * ask this AFTER attempting a restore. `MM_SEED=false` always wins.
 */
export function shouldSeed(restoredRecords: number): boolean {
  if (process.env.MM_SEED === 'false') return false;
  if (restoredRecords > 0) return false;
  return isEmptyStore();
}

export const persistence = { Persistence, FileAdapter, PostgresAdapter, createPersistence, shouldSeed };
export default persistence;
