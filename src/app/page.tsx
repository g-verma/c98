'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { slugifyRoomName } from '@/lib/utils'

const FEATURES = [{}];

export default function Home() {
  const router = useRouter()
  const [roomName, setRoomName] = useState('')
  const [password, setPassword] = useState('')

  const slug = slugifyRoomName(roomName)
  const canEnter = !!slug

  const enterRoom = () => {
    if (!canEnter) return
    if (password.trim()) {
      try { sessionStorage.setItem(`room-pwd-${slug}`, password.trim()) } catch {}
    }
    // Mark this navigation as a deliberate room creation so the server allows it
    try { sessionStorage.setItem(`room-new-${slug}`, '1') } catch {}
    router.push(`/${slug}`)
  }

  return (
    <div
      className="min-h-[50vh] flex flex-col items-center p-6"
      style={{ background: 'linear-gradient(135deg, #0d1117 0%, #0f1923 50%, #0d1117 100%)' }}
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-2 rounded-xl" style={{ backgroundColor: '#1c2333' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" className="text-blue-400" viewBox="0 0 16 16">
                <path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8z"/>
              </svg>
            </div>
            <h1 className="text-4xl font-bold text-white tracking-tight">CodeShare</h1>
          </div>
          <p className="text-gray-400 text-base leading-relaxed">
            Real-time collaborative coding.<br />
          </p>
        </div>

        {/* Room name input */}
        <div className="relative">
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enterRoom()}
            placeholder="Enter a url name…"
            maxLength={50}
            autoFocus
            className="w-full px-4 py-3.5 rounded-xl text-white text-base focus:outline-none transition-colors placeholder-gray-600"
            style={{ backgroundColor: '#161b22', border: `1px solid ${roomName && !slug ? '#ef4444' : '#30363d'}` }}
          />
          {/* URL preview */}
          {slug && (
            <p className="mt-1.5 text-xs text-gray-500 px-1">
              URL: <span className="text-gray-400 font-mono">c98.up.railway.app/{slug}</span>
            </p>
          )}
          {roomName && !slug && (
            <p className="mt-1.5 text-xs text-red-500 px-1">Name must contain letters or numbers</p>
          )}
        </div>

        {/* Optional room password */}
        <div className="mt-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enterRoom()}
            placeholder="Password (optional)"
            autoComplete="new-password"
            className="w-full px-4 py-3 rounded-xl text-sm text-white focus:outline-none transition-colors placeholder-gray-600"
            style={{ backgroundColor: '#161b22', border: '1px solid #21262d' }}
          />
        </div>

        {/* Enter button */}
        <button
          onClick={enterRoom}
          disabled={!canEnter}
          className="w-full mt-4 py-3.5 px-6 rounded-xl font-semibold text-base text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', boxShadow: canEnter ? '0 4px 24px rgba(37,99,235,0.35)' : 'none' }}
        >
          Enter Room →
        </button>


        {/* Features */}
        {/* <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {FEATURES?.map(({ icon, title, desc }) => (
            <div
              key={title}
              className="p-3 rounded-xl flex flex-col gap-1"
              style={{ backgroundColor: '#161b22', border: '1px solid #21262d' }}
            >
              <span className="text-xl">{icon}</span>
              <span className="text-gray-200 text-xs font-semibold">{title}</span>
              <span className="text-gray-500 text-xs leading-snug">{desc}</span>
            </div>
          ))}
        </div> */}
      </div>
    </div>
  )
}
