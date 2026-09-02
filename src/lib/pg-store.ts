import type { ChatMessage } from '@/types'
import { getPool, ensureSchema } from './db'
import { encryptText, decryptText } from './crypto'

export interface PgRoomMetaPatch {
  name?: string | null
  password?: string | null
  disappearAfter?: number | null
  angryBirdOwnerName?: string | null
  lastActive?: number | null
}

export interface PgRoomMeta {
  name?: string
  password?: string
  disappearAfter?: number
  angryBirdOwnerName?: string | null
  lastActive?: number
}

// Partial update: any key omitted from `patch` keeps its current stored value;
// passing `null` explicitly clears that field (e.g. releasing the Ditch lock).
export async function savePgRoomMeta(roomId: string, patch: PgRoomMetaPatch): Promise<void> {
  const pool = getPool()
  if (!pool) return
  await ensureSchema()
  try {
    const current = await pool.query(
      'SELECT name, password_enc, disappear_after, angrybird_owner_name, last_active FROM chat_rooms WHERE room_id = $1',
      [roomId],
    )
    const row = current.rows[0]
    const name = 'name' in patch ? patch.name ?? null : row?.name ?? null
    const passwordEnc = 'password' in patch
      ? (patch.password ? encryptText(patch.password) : null)
      : row?.password_enc ?? null
    const disappearAfter = 'disappearAfter' in patch ? patch.disappearAfter ?? null : row?.disappear_after ?? null
    const angryBirdOwnerName = 'angryBirdOwnerName' in patch ? patch.angryBirdOwnerName ?? null : row?.angrybird_owner_name ?? null
    const lastActive = 'lastActive' in patch ? patch.lastActive ?? null : row?.last_active ?? null

    await pool.query(
      `INSERT INTO chat_rooms (room_id, name, password_enc, disappear_after, angrybird_owner_name, last_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (room_id) DO UPDATE SET
         name = EXCLUDED.name,
         password_enc = EXCLUDED.password_enc,
         disappear_after = EXCLUDED.disappear_after,
         angrybird_owner_name = EXCLUDED.angrybird_owner_name,
         last_active = EXCLUDED.last_active,
         updated_at = now()`,
      [roomId, name, passwordEnc, disappearAfter, angryBirdOwnerName, lastActive],
    )
  } catch {}
}

export async function loadPgRoomMeta(roomId: string): Promise<PgRoomMeta | null> {
  const pool = getPool()
  if (!pool) return null
  await ensureSchema()
  try {
    const res = await pool.query(
      'SELECT name, password_enc, disappear_after, angrybird_owner_name, last_active FROM chat_rooms WHERE room_id = $1',
      [roomId],
    )
    const row = res.rows[0]
    if (!row) return null
    return {
      name: row.name ?? undefined,
      password: decryptText(row.password_enc) ?? undefined,
      disappearAfter: row.disappear_after != null ? Number(row.disappear_after) : undefined,
      angryBirdOwnerName: row.angrybird_owner_name ?? null,
      lastActive: row.last_active != null ? Number(row.last_active) : undefined,
    }
  } catch {
    return null
  }
}

export async function savePgMessages(roomId: string, messages: ChatMessage[]): Promise<void> {
  const pool = getPool()
  if (!pool) return
  await ensureSchema()
  const enc = encryptText(JSON.stringify(messages))
  if (!enc) return
  try {
    await pool.query(
      `INSERT INTO chat_messages (room_id, data_enc, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (room_id) DO UPDATE SET data_enc = EXCLUDED.data_enc, updated_at = now()`,
      [roomId, enc],
    )
  } catch {}
}

export async function loadPgMessages(roomId: string): Promise<ChatMessage[] | null> {
  const pool = getPool()
  if (!pool) return null
  await ensureSchema()
  try {
    const res = await pool.query('SELECT data_enc FROM chat_messages WHERE room_id = $1', [roomId])
    const plain = decryptText(res.rows[0]?.data_enc)
    return plain ? (JSON.parse(plain) as ChatMessage[]) : null
  } catch {
    return null
  }
}

export async function savePgActivities(roomId: string, date: string, data: Record<string, { first: number; last: number }>): Promise<void> {
  const pool = getPool()
  if (!pool) return
  await ensureSchema()
  const enc = encryptText(JSON.stringify(data))
  if (!enc) return
  try {
    await pool.query(
      `INSERT INTO chat_activities (room_id, activity_date, data_enc, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (room_id, activity_date) DO UPDATE SET data_enc = EXCLUDED.data_enc, updated_at = now()`,
      [roomId, date, enc],
    )
  } catch {}
}

export async function loadPgActivities(roomId: string, date: string): Promise<Record<string, { first: number; last: number }> | null> {
  const pool = getPool()
  if (!pool) return null
  await ensureSchema()
  try {
    const res = await pool.query('SELECT data_enc FROM chat_activities WHERE room_id = $1 AND activity_date = $2', [roomId, date])
    const plain = decryptText(res.rows[0]?.data_enc)
    return plain ? JSON.parse(plain) : null
  } catch {
    return null
  }
}

export type PgBlackBox = { ownerName: string; photos: string[]; expiresAt: number | null }

export async function savePgBlackBox(roomId: string, data: PgBlackBox | null): Promise<void> {
  const pool = getPool()
  if (!pool) return
  await ensureSchema()
  try {
    if (!data || data.photos.length === 0) {
      await pool.query('DELETE FROM chat_black_box WHERE room_id = $1', [roomId])
      return
    }
    const enc = encryptText(JSON.stringify(data))
    if (!enc) return
    await pool.query(
      `INSERT INTO chat_black_box (room_id, data_enc, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (room_id) DO UPDATE SET data_enc = EXCLUDED.data_enc, updated_at = now()`,
      [roomId, enc],
    )
  } catch {}
}

export async function loadPgBlackBox(roomId: string): Promise<PgBlackBox | null> {
  const pool = getPool()
  if (!pool) return null
  await ensureSchema()
  try {
    const res = await pool.query('SELECT data_enc FROM chat_black_box WHERE room_id = $1', [roomId])
    const plain = decryptText(res.rows[0]?.data_enc)
    return plain ? (JSON.parse(plain) as PgBlackBox) : null
  } catch {
    return null
  }
}
