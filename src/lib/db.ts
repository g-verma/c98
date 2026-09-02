import { Pool } from 'pg'

// Reuse the pool across hot reloads in dev, like the Redis client in lib/redis.ts
const g = global as typeof global & { _pgPool?: Pool | null; _pgSchemaReady?: Promise<void> | null }

export function getPool(): Pool | null {
  if (g._pgPool !== undefined) return g._pgPool
  if (!process.env.DATABASE_URL) {
    g._pgPool = null
    return null
  }
  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // required for Neon's managed Postgres
      max: 5,
    })
    pool.on('error', (err) => { if (process.env.NODE_ENV !== 'production') console.warn('[postgres]', err.message) })
    g._pgPool = pool
    return pool
  } catch {
    g._pgPool = null
    return null
  }
}

// Idempotent schema setup, run lazily on first use — mirrors a lightweight migration
export function ensureSchema(): Promise<void> {
  const pool = getPool()
  if (!pool) return Promise.resolve()
  if (!g._pgSchemaReady) {
    g._pgSchemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS chat_rooms (
        room_id TEXT PRIMARY KEY,
        name TEXT,
        password_enc TEXT,
        disappear_after BIGINT,
        angrybird_owner_name TEXT,
        last_active BIGINT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        room_id TEXT PRIMARY KEY,
        data_enc TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS chat_activities (
        room_id TEXT NOT NULL,
        activity_date TEXT NOT NULL,
        data_enc TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (room_id, activity_date)
      );
      CREATE TABLE IF NOT EXISTS chat_black_box (
        room_id TEXT PRIMARY KEY,
        data_enc TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `).then(() => {}).catch((err) => {
      if (process.env.NODE_ENV !== 'production') console.warn('[postgres] schema setup failed', err.message)
    })
  }
  return g._pgSchemaReady
}
