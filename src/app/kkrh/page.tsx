import { cookies } from 'next/headers'
import KkrhAuthGate from '@/components/KkrhAuthGate'
import KkrhSessionTimer from '@/components/KkrhSessionTimer'
import RoomClient from '@/components/RoomClient'

function parseSession(value?: string): number | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot === -1) return null
  const expiresAt = parseInt(value.slice(dot + 1), 10)
  if (isNaN(expiresAt) || Date.now() >= expiresAt) return null
  return expiresAt
}

export default async function KkrhPage() {
  const store = await cookies()
  const session = store.get('kkrh-session')
  const expiresAt = parseSession(session?.value)

  if (!expiresAt) {
    return <KkrhAuthGate />
  }

  return (
    <>
      {/* Automatically refreshes the page when the 15-min session cookie expires */}
      <KkrhSessionTimer expiresAt={expiresAt} />
      <RoomClient roomId="kkrh" />
    </>
  )
}
