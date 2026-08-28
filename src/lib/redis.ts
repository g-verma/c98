import Redis from 'ioredis'

export interface PersistedRoom {
  code: string
  language: string
  password?: string
  name?: string
  disappearAfter?: number
}

// Reuse connection across hot reloads in dev
const g = global as typeof global & { _redisClient?: Redis | null }

function getClient(): Redis | null {
  if (g._redisClient !== undefined) return g._redisClient
  if (!process.env.REDIS_URL) {
    g._redisClient = null
    return null
  }
  try {
    const client = new Redis(process.env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })
    client.on('error', (err) => { if (process.env.NODE_ENV !== 'production') console.warn('[redis]', err.message) })
    g._redisClient = client
    return client
  } catch {
    g._redisClient = null
    return null
  }
}

const key = (roomId: string) => `room:${roomId}`

export async function saveRoom(roomId: string, data: PersistedRoom): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.set(key(roomId), JSON.stringify(data))
  } catch {}
}

export async function loadRoom(roomId: string): Promise<PersistedRoom | null> {
  const client = getClient()
  if (!client) return null
  try {
    const raw = await client.get(key(roomId))
    return raw ? (JSON.parse(raw) as PersistedRoom) : null
  } catch {
    return null
  }
}

export type ActivityRecord = Record<string, { first: number; last: number }>

const actKey = (roomId: string, date: string) => `activity:${roomId}:${date}`

export async function saveActivity(roomId: string, date: string, data: ActivityRecord): Promise<void> {
  const client = getClient()
  if (!client) return
  try { await client.set(actKey(roomId, date), JSON.stringify(data), 'EX', 172800) } catch {}
}

export async function loadActivity(roomId: string, date: string): Promise<ActivityRecord | null> {
  const client = getClient()
  if (!client) return null
  try {
    const raw = await client.get(actKey(roomId, date))
    return raw ? (JSON.parse(raw) as ActivityRecord) : null
  } catch { return null }
}

const lastActiveKey = (roomId: string) => `room-lastactive:${roomId}`

export async function saveLastActive(roomId: string, ts: number): Promise<void> {
  const client = getClient()
  if (!client) return
  try { await client.set(lastActiveKey(roomId), String(ts)) } catch {}
}

export async function loadLastActive(roomId: string): Promise<number | null> {
  const client = getClient()
  if (!client) return null
  try {
    const raw = await client.get(lastActiveKey(roomId))
    return raw ? Number(raw) : null
  } catch { return null }
}
