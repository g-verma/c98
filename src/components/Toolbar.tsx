'use client'

import { useState, useEffect } from 'react'
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
  onRenameUser: (name: string) => void
  onLogout?: () => void
  currentPassword?: string
  onChangePassword?: (newPassword: string) => void
}

export default function Toolbar({ roomId, displayName, language, userCount, userName, connected, onLanguageChange, onClearCode, onRenameUser, onLogout, currentPassword, onChangePassword }: ToolbarProps) {
  const [copied, setCopied] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(userName)
  const [showPwdModal, setShowPwdModal] = useState(false)
  const [newPwd, setNewPwd] = useState('')
  const [showOldPwd, setShowOldPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [pwdSaved, setPwdSaved] = useState(false)

  useEffect(() => { setDraftName(userName) }, [userName])

  const confirmRename = () => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== userName) onRenameUser(trimmed)
    else setDraftName(userName)
    setEditingName(false)
  }

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

  const closePwdModal = () => {
    setShowPwdModal(false)
    setNewPwd('')
    setShowOldPwd(false)
    setShowNewPwd(false)
    setPwdSaved(false)
  }

  const submitPwdChange = () => {
    if (!onChangePassword) return
    onChangePassword(newPwd.trim())
    setPwdSaved(true)
    setTimeout(closePwdModal, 1500)
  }

  return (
    <>
      {showPwdModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 sm:items-center sm:pt-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closePwdModal() }}
        >
          <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4" style={{ backgroundColor: '#161b22', border: '1px solid #30363d' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">🔒</span>
                <h2 className="text-white font-semibold text-base">Change Password</h2>
              </div>
              <button onClick={closePwdModal} className="text-gray-600 hover:text-gray-400 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/></svg>
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-500">Current password</label>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ backgroundColor: '#0d1117', border: '1px solid #30363d' }}>
                <span className="flex-1 text-sm font-mono text-gray-400 select-all">
                  {currentPassword ? (showOldPwd ? currentPassword : '•'.repeat(currentPassword.length)) : <span className="text-gray-600">none</span>}
                </span>
                {currentPassword && (
                  <button onClick={() => setShowOldPwd((v) => !v)} className="text-gray-600 hover:text-gray-400 transition-colors shrink-0">
                    {showOldPwd
                      ? <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="m10.79 12.912-1.614-1.615a3.5 3.5 0 0 1-4.474-4.474l-2.06-2.06C.938 6.278 0 8 0 8s3 5.5 8 5.5a7 7 0 0 0 2.79-.588M5.21 3.088A7 7 0 0 1 8 2.5c5 0 8 5.5 8 5.5s-.939 1.721-2.641 3.238l-2.062-2.062a3.5 3.5 0 0 0-4.474-4.474z"/><path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829zm4.95.708-2.829-2.83a2.5 2.5 0 0 1 2.829 2.829zm3.171 6-12-12 .708-.708 12 12z"/></svg>
                      : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/></svg>
                    }
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-500">New password <span className="text-gray-700">(leave empty to remove)</span></label>
              <div className="flex items-center gap-2 px-3 rounded-xl" style={{ backgroundColor: '#0d1117', border: '1px solid #30363d' }}>
                <input
                  type={showNewPwd ? 'text' : 'password'}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitPwdChange() }}
                  placeholder="Enter new password"
                  autoFocus
                  className="flex-1 py-2.5 bg-transparent text-sm text-white focus:outline-none placeholder-gray-600"
                />
                <button onClick={() => setShowNewPwd((v) => !v)} className="text-gray-600 hover:text-gray-400 transition-colors shrink-0">
                  {showNewPwd
                    ? <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="m10.79 12.912-1.614-1.615a3.5 3.5 0 0 1-4.474-4.474l-2.06-2.06C.938 6.278 0 8 0 8s3 5.5 8 5.5a7 7 0 0 0 2.79-.588M5.21 3.088A7 7 0 0 1 8 2.5c5 0 8 5.5 8 5.5s-.939 1.721-2.641 3.238l-2.062-2.062a3.5 3.5 0 0 0-4.474-4.474z"/><path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829zm4.95.708-2.829-2.83a2.5 2.5 0 0 1 2.829 2.829zm3.171 6-12-12 .708-.708 12 12z"/></svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/></svg>
                  }
                </button>
              </div>
            </div>
            <button
              onClick={submitPwdChange}
              className="w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-colors"
              style={{ backgroundColor: pwdSaved ? '#16a34a' : '#2563eb' }}
            >
              {pwdSaved ? '✓ Password updated' : 'Update Password'}
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#010409] border-b border-gray-800 flex-wrap shrink-0" style={{ minHeight: '48px' }}>
      {/* Brand */}
      <div className="hidden md:flex items-center gap-1.5 mr-1">
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="currentColor" className="text-blue-400 shrink-0" viewBox="0 0 16 16">
          <path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8z"/>
        </svg>
        <span className="text-blue-400 font-bold text-sm hidden sm:block">CodeShare</span>
      </div>

      {/* Room name badge — room name IS the unique id */}
      <div className="hidden md:flex items-center gap-1 bg-[#161b22] border border-gray-700/60 rounded px-2.5 py-1 text-xs shrink-0 max-w-[200px]">
        <span className="text-blue-500/70 font-bold">#</span>
        <span className="text-gray-200 font-medium truncate">{displayName || roomId}</span>
      </div>

      {/* Copy link */}
      <button
        onClick={copyLink}
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-[#161b22] border border-gray-700/60 hover:border-blue-500/50 text-gray-400 hover:text-blue-400 rounded text-xs transition-colors shrink-0"
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
        className="hidden md:block px-2 py-1 bg-[#161b22] border border-gray-700/60 text-gray-200 rounded text-xs focus:outline-none focus:border-blue-500/50 cursor-pointer"
      >
        {LANGUAGE_OPTIONS.map((lang) => (
          <option key={lang.id} value={lang.id}>{lang.name}</option>
        ))}
      </select>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User + count */}
      <div className="flex items-center gap-2 shrink-0">
        {editingName ? (
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={confirmRename}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') { setDraftName(userName); setEditingName(false) } }}
            autoFocus
            maxLength={20}
            className="text-xs text-gray-200 bg-[#161b22] border border-blue-500/50 rounded px-1.5 py-0.5 w-28 focus:outline-none"
          />
        ) : (
          <button
            onClick={() => { setDraftName(userName); setEditingName(true) }}
            title="Click to change username"
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 max-w-[130px] truncate transition-colors"
          >
            👤 {userName}
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" fill="currentColor" viewBox="0 0 16 16" className="shrink-0 opacity-50"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z"/></svg>
          </button>
        )}
        <div className="flex items-center gap-1 px-2 py-0.5 bg-green-950/30 border border-green-900/40 text-green-400 rounded-full text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          {userCount}
        </div>
      </div>

      {onChangePassword && (
        <button
          onClick={() => setShowPwdModal(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-[#161b22] border border-gray-700/60 hover:border-blue-500/50 text-gray-400 hover:text-blue-400 rounded text-xs transition-colors shrink-0"
          title="Change room password"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2m3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2"/></svg>
        </button>
      )}

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

      {onLogout && (
        <button
          onClick={onLogout}
          title="Clear session and go home"
          className="flex items-center gap-1 px-2.5 py-1 border border-gray-700/40 hover:border-gray-500/60 text-gray-600 hover:text-gray-300 rounded text-xs transition-colors shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16">
            <path fillRule="evenodd" d="M6 12.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-8a.5.5 0 0 0-.5.5v2a.5.5 0 0 1-1 0v-2A1.5 1.5 0 0 1 6.5 2h8A1.5 1.5 0 0 1 16 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 5 12.5v-2a.5.5 0 0 1 1 0z"/>
            <path fillRule="evenodd" d="M.146 8.354a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L1.707 7.5H10.5a.5.5 0 0 1 0 1H1.707l2.147 2.146a.5.5 0 0 1-.708.708z"/>
          </svg>
          Leave
        </button>
      )}
    </div>
    </>
  )
}
