'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const WARNING_WINDOW_MS = 2 * 60 * 1000

export default function KkrhSessionTimer({ expiresAt }: { expiresAt: number }) {
  const router = useRouter()
  const [showWarning, setShowWarning] = useState(false)
  const [extending, setExtending] = useState(false)

  useEffect(() => {
    setShowWarning(false)
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) { router.refresh(); return }
    // Refresh the page when the cookie expires so the server shows the auth gate
    const expireTimer = setTimeout(() => router.refresh(), remaining)
    // Warn 2 minutes before expiry so the user can extend the session
    const warnTimer = setTimeout(() => setShowWarning(true), Math.max(0, remaining - WARNING_WINDOW_MS))
    return () => { clearTimeout(expireTimer); clearTimeout(warnTimer) }
  }, [expiresAt, router])

  const handleExtend = async () => {
    setExtending(true)
    try {
      const res = await fetch('/api/kkrh-auth', { method: 'PATCH' })
      if (res.ok) {
        setShowWarning(false)
        router.refresh()
      }
    } finally {
      setExtending(false)
    }
  }

  if (!showWarning) return null

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-2xl border border-gray-700/60 shadow-2xl p-5 max-w-sm w-full" style={{ backgroundColor: '#161b22' }}>
        <p className="text-sm text-white font-medium mb-1">Your session is about to expire</p>
        <p className="text-xs text-gray-400 mb-4">Extend for another 15 minutes, or it will expire automatically.</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setShowWarning(false)}
            className="px-3 py-1.5 text-xs rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExtend}
            disabled={extending}
            className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
          >
            {extending ? 'Extending…' : 'Extend session'}
          </button>
        </div>
      </div>
    </div>
  )
}
