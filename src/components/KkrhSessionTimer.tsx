'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function KkrhSessionTimer({ expiresAt }: { expiresAt: number }) {
  const router = useRouter()

  useEffect(() => {
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) { router.refresh(); return }
    // Refresh the page when the cookie expires so the server shows the auth gate
    const t = setTimeout(() => router.refresh(), remaining)
    return () => clearTimeout(t)
  }, [expiresAt, router])

  return null
}
