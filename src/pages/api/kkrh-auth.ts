import crypto from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

// Override via KKRH_PASSWORD env var in production
const KKRH_PASSWORD = process.env.KKRH_PASSWORD ?? 'C0deC0llab#kkrh!Secure@2024'
const SESSION_SECONDS = 15 * 60 // 15 minutes

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'kkrh-session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/')
    return res.status(204).end()
  }

  // Extend an already-valid session by another 15 minutes without re-entering the password
  if (req.method === 'PATCH') {
    const cookieHeader = req.headers.cookie ?? ''
    const match = cookieHeader.match(/(?:^|; )kkrh-session=([^;]*)/)
    const current = match ? decodeURIComponent(match[1]) : ''
    const dot = current.lastIndexOf('.')
    const currentExpiresAt = dot === -1 ? NaN : parseInt(current.slice(dot + 1), 10)
    if (dot === -1 || isNaN(currentExpiresAt) || Date.now() >= currentExpiresAt) {
      return res.status(401).json({ error: 'Session expired' })
    }
    const expiresAt = Date.now() + SESSION_SECONDS * 1000
    const token = `${crypto.randomBytes(16).toString('hex')}.${expiresAt}`
    res.setHeader(
      'Set-Cookie',
      `kkrh-session=${token}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}; Path=/`,
    )
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const { password } = req.body as { password?: string }
  const input = Buffer.from(String(password ?? ''))
  const expected = Buffer.from(KKRH_PASSWORD)
  // Timing-safe comparison to prevent timing attacks
  const valid =
    input.length === expected.length && crypto.timingSafeEqual(input, expected)

  if (!valid) {
    return res.status(401).json({ error: 'Incorrect password' })
  }

  const expiresAt = Date.now() + SESSION_SECONDS * 1000
  const token = `${crypto.randomBytes(16).toString('hex')}.${expiresAt}`

  res.setHeader(
    'Set-Cookie',
    `kkrh-session=${token}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}; Path=/`,
  )
  res.status(200).json({ ok: true })
}
