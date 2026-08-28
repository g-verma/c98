'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import Link from 'next/link'

interface PasswordModalProps {
  roomId: string
  error: string
  onSubmit: (password: string) => void
}

export default function PasswordModal({ roomId, error, onSubmit }: PasswordModalProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    if (value.trim()) onSubmit(value.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 sm:items-center sm:pt-4" style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4" style={{ backgroundColor: '#161b22', border: '1px solid #30363d' }}>
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="text-2xl">🔒</div>
          <div>
            <h2 className="text-white font-semibold text-base">Enter To Awesomeness</h2>
            <p className="text-gray-500 text-xs mt-0.5">Room: <span className="font-mono text-gray-400">{roomId}</span></p>
          </div>
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleSubmit()}
          placeholder="Enter your thing here"
          className="w-full px-3 py-2.5 rounded-xl text-sm text-white focus:outline-none transition-colors placeholder-gray-600"
          style={{ backgroundColor: '#0d1117', border: `1px solid ${error ? '#f87171' : '#30363d'}` }}
        />

        {/* Error */}
        {error && (
          <p className="text-red-400 text-xs -mt-2 flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
              <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/>
            </svg>
            {error}
          </p>
        )}

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={!value.trim()}
          className="w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#000000' }}
        >
          Continue
        </button>

        <Link href="/" className="text-center text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ← Back to home
        </Link>
      </div>
    </div>
  )
}
