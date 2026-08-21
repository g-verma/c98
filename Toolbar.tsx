'use client'

import { useState } from 'react'
import { LANGUAGE_OPTIONS } from '@/types'

interface ToolbarProps {
  roomId: string
  displayName?: string
  language: string
  userCount: number
  userName: string
  connected: boolean
  onLanguageChange: (lang: string) => void
  onClearCode: () => void
  onClearAll: () => void
}

export default function Toolbar({ roomId, displayName, language, userCount, userName, connected, onLanguageChange, onClearCode, onClearAll }: ToolbarProps) {
  const [copied, setCopied] = useState(false)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = window.location.href
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-[#010409] border-b border-gray-800 flex-wrap shrink-0" style={{ minHeight: '48px' }}>
      {/* Brand */}
      <div className="flex items-center gap-1.5 mr-1">
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="currentColor" className="text-blue-400 shrink-0" viewBox="0 0 16 16">
          <path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8z"/>
        </svg>
        <span className="text-blue-400 font-bold text-sm hidden sm:block">CodeShare</span>
      </div>

      {/* Room name badge — room name IS the unique id */}
      <div className="flex items-center gap-1 bg-[#161b22] border border-gray-700/60 rounded px-2.5 py-1 text-xs shrink-0 max-w-[200px]">
        <span className="text-blue-500/70 font-bold">#</span>
        <span className="text-gray-200 font-medium truncate">{displayName || roomId}</span>
      </div>

      {/* Copy link */}
      <button
        onClick={copyLink}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-[#161b22] border border-gray-700/60 hover:border-blue-500/50 text-gray-400 hover:text-blue-400 rounded text-xs transition-colors shrink-0"
      >
        {copied ? (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" className="text-green-400" viewBox="0 0 16 16">
              <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/>
            </svg>
            <span className="text-green-400">Copied!</span>
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1z"/>
              <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0z"/>
            </svg>
            Share Link
          </>
        )}
      </button>

      {/* Language */}
      <select
        value={language}
        onChange={(e) => onLanguageChange(e.target.value)}
        className="px-2 py-1 bg-[#161b22] border border-gray-700/60 text-gray-200 rounded text-xs focus:outline-none focus:border-black-500/50 cursor-pointer"
      >
        {LANGUAGE_OPTIONS.map((lang) => (
          <option key={lang.id} value={lang.id}>{lang.name}</option>
        ))}
      </select>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User + count */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="hidden sm:block text-xs text-gray-500 max-w-[120px] truncate" title={userName}>
          👤 {userName}
        </span>
        <div className="flex items-center gap-1 px-2 py-0.5 bg-green-950/30 border border-green-900/40 text-green-400 rounded-full text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          {userCount} online
        </div>
      </div>

      {/* Clear code */}
      <button
        onClick={onClearCode}
        disabled={!connected}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-red-950/20 hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed border border-red-900/40 hover:border-red-700/50 text-red-400 hover:text-red-300 rounded text-xs transition-colors shrink-0"
        title="Clear the code editor for everyone"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16">
          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
          <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
        </svg>
        Clear Code
      </button>

      {/* Clear code + chat together */}
      <button
        onClick={onClearAll}
        disabled={!connected}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-red-900/30 hover:bg-red-800/50 disabled:opacity-40 disabled:cursor-not-allowed border border-red-700/50 hover:border-red-600/70 text-red-300 hover:text-red-200 rounded text-xs font-medium transition-colors shrink-0"
        title="Clear code and chat for everyone"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16">
          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
          <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
        </svg>
        Clear All
      </button>
    </div>
  )
}
