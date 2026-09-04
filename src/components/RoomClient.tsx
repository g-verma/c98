'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { io, Socket } from 'socket.io-client'
import { ChatMessage, RoomState } from '@/types'
import type { ActivityRecord } from '@/lib/redis'
import { generateUserName } from '@/lib/utils'
import dynamic from 'next/dynamic'
import type { CodeEditorApi } from './CodeEditor'
import Chat from './Chat'
import Toolbar from './Toolbar'
import PasswordModal from './PasswordModal'

const CodeEditor = dynamic(() => import('./CodeEditor'), { ssr: false })

interface RoomClientProps {
  roomId: string
}

export default function RoomClient({ roomId }: RoomClientProps) {
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [userCount, setUserCount] = useState(0)
  const [userName, setUserName] = useState('')
  const [socketId, setSocketId] = useState('')
  const [mobileTab, setMobileTab] = useState<'code' | 'chat'>('code')
  const [connected, setConnected] = useState(false)
  const [newMessages, setNewMessages] = useState(0)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [authError, setAuthError] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  // Default to the room slug; overwritten by room-state if the server has a separate name stored
  const [displayRoomName, setDisplayRoomName] = useState(roomId)
  const [disappearAfter, setDisappearAfter] = useState<number | null>(null)
  const [videoSendProgress, setVideoSendProgress] = useState<number | null>(null)
  const [liveMessages, setLiveMessages] = useState<Record<string, { userName: string; text: string }>>({})
  const [pokeLevel, setPokeLevel] = useState(0)
  const [angryBirdOwnerId, setAngryBirdOwnerId] = useState<string | null>(null)
  const [heartbeatActive, setHeartbeatActive] = useState(false)
  const [sinkCount, setSinkCount] = useState(0)
  const [sinkBurst, setSinkBurst] = useState(false)
  const [sinkBurstCount, setSinkBurstCount] = useState(0)
  const [sinkDragX, setSinkDragX] = useState(0)
  const [sinkDragging, setSinkDragging] = useState(false)
  const sinkDragRef = useRef<{ startX: number; moved: boolean } | null>(null)
  const [reactionEmoji, setReactionEmoji] = useState<string | null>(null)
  const [roomPassword, setRoomPassword] = useState<string | undefined>(undefined)
  const [activities, setActivities] = useState<ActivityRecord>({})
  const [lastActive, setLastActive] = useState<number | null>(null)
  const [theBlackData, setTheBlackData] = useState<{ userId: string; userName: string; photos: string[] } | null>(null)
  const [initialTheBlack, setInitialTheBlack] = useState<{ photos: string[]; expiresAt: number | null } | null>(null)
  const [focusedUserIds, setFocusedUserIds] = useState<string[]>([])

  const socketRef = useRef<Socket | null>(null)
  const editorApiRef = useRef<CodeEditorApi | null>(null)
  const mobileTabRef = useRef(mobileTab)
  const pendingCodeRef = useRef<string | null>(null)
  const userNameRef = useRef('')
  const lastPokeRef = useRef(0)
  // Read once from sessionStorage; persists across StrictMode double-mount
  const credentialsRef = useRef<{ password: string | undefined; isNew: boolean } | null>(null)
  const authPasswordRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    mobileTabRef.current = mobileTab
    if (mobileTab === 'chat') setNewMessages(0)
  }, [mobileTab])

  // Broadcast this tab's focus/visibility so peers can show the "active now" pulse
  useEffect(() => {
    if (!connected) return
    const emitFocus = () => {
      const focused = document.visibilityState === 'visible'
      socketRef.current?.emit('focus-state', { roomId, focused })
    }
    emitFocus()
    document.addEventListener('visibilitychange', emitFocus)
    window.addEventListener('focus', emitFocus)
    window.addEventListener('blur', emitFocus)
    return () => {
      document.removeEventListener('visibilitychange', emitFocus)
      window.removeEventListener('focus', emitFocus)
      window.removeEventListener('blur', emitFocus)
    }
  }, [connected, roomId])

  const handleEditorReady = useCallback((api: CodeEditorApi) => {
    editorApiRef.current = api
    // Apply any code that arrived before the editor was ready
    if (pendingCodeRef.current !== null) {
      api.updateCode(pendingCodeRef.current)
      pendingCodeRef.current = null
    }
  }, [])

  useEffect(() => {
    let name = ''
    try { name = localStorage.getItem('codeshare-username') ?? '' } catch {}
    if (!name) {
      name = generateUserName()
      try { localStorage.setItem('codeshare-username', name) } catch {}
    }
    setUserName(name)
    userNameRef.current = name

    // Read credentials once (guard prevents StrictMode's second run from seeing empty sessionStorage)
    if (!credentialsRef.current) {
      let joinPassword: string | undefined
      let isNewRoom = false
      try {
        joinPassword = sessionStorage.getItem(`room-pwd-${roomId}`) ?? undefined
        if (joinPassword) sessionStorage.removeItem(`room-pwd-${roomId}`)
      } catch {}
      try {
        isNewRoom = sessionStorage.getItem(`room-new-${roomId}`) === '1'
        if (isNewRoom) sessionStorage.removeItem(`room-new-${roomId}`)
      } catch {}
      // Fall back to a valid localStorage session (15-min TTL) if no fresh sessionStorage creds
      if (!joinPassword && !isNewRoom) {
        try {
          const raw = localStorage.getItem(`room-session-${roomId}`)
          if (raw) {
            const s = JSON.parse(raw) as { password?: string; expiresAt: number }
            if (Date.now() < s.expiresAt) { joinPassword = s.password }
            else localStorage.removeItem(`room-session-${roomId}`)
          }
        } catch {}
      }
      credentialsRef.current = { password: joinPassword, isNew: isNewRoom }
    }

    const socket = io({ path: '/api/socket', addTrailingSlash: false })
    socketRef.current = socket

    socket.on('connect', () => {
      if (socketRef.current !== socket) return  // ignore stale socket events after cleanup
      setConnected(true)
      setSocketId(socket.id ?? '')
      authPasswordRef.current = credentialsRef.current?.password
      socket.emit('join-room', { roomId, name: userNameRef.current, password: credentialsRef.current?.password, isNew: credentialsRef.current?.isNew ?? false })
    })

    socket.on('auth-error', (msg: string) => {
      setAuthError(msg)
      setShowPasswordModal(true)
    })

    socket.on('room-not-found', () => {
      // Room expired or was never created — let the user recreate it with a password
      setAuthError('Room not found. Enter a password to recreate it, or go home.')
      setShowPasswordModal(true)
    })

    socket.on('disconnect', () => {
      if (socketRef.current !== socket) return  // ignore disconnect from replaced socket
      setConnected(false)
    })

    socket.on('room-state', (state: RoomState) => {
      // Save password + 15-min TTL so refresh doesn't prompt again
      try { localStorage.setItem(`room-session-${roomId}`, JSON.stringify({ password: authPasswordRef.current, expiresAt: Date.now() + 15 * 60 * 1000 })) } catch {}
      setShowPasswordModal(false)
      setAuthError('')
      setIsAuthenticated(true)
      setCode(state.code)
      setLanguage(state.language)
      setMessages(state.messages)
      if (state.roomName) setDisplayRoomName(state.roomName)
      setDisappearAfter(state.disappearAfter ?? null)
      setAngryBirdOwnerId(state.angryBirdOwnerId ?? null)
      setRoomPassword(authPasswordRef.current)
      setActivities(state.activities ?? {})
      setLastActive(state.lastActive ?? null)
      setSinkCount(state.sinkCount ?? 0)
      // Restore BLACK feature state: owner sees their own gallery restored, others see the shared dot
      if (state.theBlack && state.theBlack.photos.length > 0 && (!state.theBlack.expiresAt || state.theBlack.expiresAt > Date.now())) {
        if (state.theBlack.ownerName === userNameRef.current) {
          setInitialTheBlack({ photos: state.theBlack.photos, expiresAt: state.theBlack.expiresAt })
          setTheBlackData(null)
        } else {
          setInitialTheBlack(null)
          setTheBlackData({ userId: '', userName: state.theBlack.ownerName, photos: state.theBlack.photos })
        }
      } else {
        setInitialTheBlack(null)
        setTheBlackData(null)
      }
      if (editorApiRef.current) {
        editorApiRef.current.updateCode(state.code)
      } else {
        pendingCodeRef.current = state.code
      }
      // Mark all existing messages from others as seen
      const seenIds = state.messages
        .filter((m) => m.type === 'message' && m.userId !== socket.id)
        .map((m) => m.id)
      if (seenIds.length > 0) socket.emit('mark-seen', { roomId, messageIds: seenIds })
    })

    socket.on('code-update', (newCode: string) => {
      setCode(newCode)
      if (editorApiRef.current) {
        editorApiRef.current.updateCode(newCode)
      } else {
        pendingCodeRef.current = newCode
      }
    })

    socket.on('language-update', (lang: string) => setLanguage(lang))

    socket.on('chat-message', (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg])
      if (mobileTabRef.current === 'code' && msg.type === 'message') {
        setNewMessages((n) => n + 1)
      }
      // Auto-mark others' messages as seen
      if (msg.userId !== socket.id && msg.type === 'message') {
        socket.emit('mark-seen', { roomId, messageIds: [msg.id] })
      }
    })

    socket.on('chat-cleared', (systemMsg?: ChatMessage) => setMessages(systemMsg ? [systemMsg] : []))

    socket.on('message-deleted', (messageId: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
    })

    socket.on('message-edited', ({ messageId, newContent, editedAt }: { messageId: string; newContent: string; editedAt: number }) => {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content: newContent, editedAt } : m))
    })

    socket.on('message-disappeared', (messageId: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
    })

    socket.on('chat-refreshed', ({ messages: refreshed, disappearAfter: refreshedDisappear }: { messages: ChatMessage[]; disappearAfter: number | null }) => {
      setMessages(refreshed)
      setDisappearAfter(refreshedDisappear)
    })

    socket.on('disappear-setting', (duration: number | null) => {
      setDisappearAfter(duration)
    })

    socket.on('messages-seen', ({ messageIds, byUserId }: { messageIds: string[]; byUserId: string }) => {
      setMessages((prev) => prev.map((m) =>
        messageIds.includes(m.id)
          ? { ...m, seenBy: [...(m.seenBy ?? []).filter(id => id !== byUserId), byUserId] }
          : m
      ))
    })

    socket.on('reaction-added', ({ messageId, reactions }: { messageId: string; reactions: Record<string, string[]> }) => {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions } : m))
    })

    socket.on('user-renamed', ({ userId, newName }: { userId: string; newName: string }) => {
      setMessages((prev) => prev.map((m) => m.userId === userId ? { ...m, userName: newName } : m))
    })

    socket.on('live-message', ({ userId, userName, text }: { userId: string; userName: string; text: string }) => {
      setLiveMessages((prev) => {
        if (!text) { const next = { ...prev }; delete next[userId]; return next }
        return { ...prev, [userId]: { userName, text } }
      })
    })

    socket.on('poke', () => {
      const now = Date.now()
      const level = now - lastPokeRef.current < 1500 ? 2 : 1
      lastPokeRef.current = now
      setPokeLevel(level)
      setTimeout(() => setPokeLevel(0), 2000)
    })

    socket.on('angrybird', ({ ownerId }: { ownerId: string | null }) => {
      setAngryBirdOwnerId(ownerId)
    })

    socket.on('sink', ({ fromUserId }: { fromUserId?: string }) => {
      setHeartbeatActive(true)
      setTimeout(() => setHeartbeatActive(false), 3000)
      // Only the recipient accumulates the floating bubble count, not the person who clicked Sink
      if (fromUserId && fromUserId !== socket.id) setSinkCount((c) => c + 1)
    })

    socket.on('reaction', ({ emoji }: { emoji: string }) => {
      setReactionEmoji(emoji)
      setTimeout(() => setReactionEmoji(null), 1000)
    })

    socket.on('password-changed', ({ newPassword }: { newPassword: string }) => {
      authPasswordRef.current = newPassword || undefined
      if (credentialsRef.current) credentialsRef.current.password = newPassword || undefined
      setRoomPassword(newPassword || undefined)
      try { localStorage.setItem(`room-session-${roomId}`, JSON.stringify({ password: authPasswordRef.current, expiresAt: Date.now() + 15 * 60 * 1000 })) } catch {}
    })

    socket.on('activity-update', (acts: ActivityRecord) => {
      setActivities(acts)
    })

    socket.on('theblack', ({ userId, userName, photos }: { userId: string; userName: string; photos: string[] }) => {
      setTheBlackData(photos.length > 0 ? { userId, userName, photos } : null)
    })

    socket.on('focus-update', (ids: string[]) => setFocusedUserIds(ids))

    socket.on('user-count', (count: number) => setUserCount(count))

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [roomId])

  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode)
    socketRef.current?.emit('code-change', { roomId, code: newCode })
  }, [roomId])

  const handleLanguageChange = useCallback((lang: string) => {
    setLanguage(lang)
    socketRef.current?.emit('language-change', { roomId, language: lang })
  }, [roomId])

  const handleClear = useCallback(() => {
    if (window.confirm('Clear the code editor for everyone in this room?')) {
      setCode('')
      if (editorApiRef.current) {
        editorApiRef.current.updateCode('')
      } else {
        pendingCodeRef.current = ''
      }
      socketRef.current?.emit('clear-code', { roomId })
    }
  }, [roomId])

  const handleClearAll = useCallback(() => {
    if (window.confirm('Clear both the code editor and chat for everyone in this room?')) {
      setCode('')
      setMessages([])
      if (editorApiRef.current) {
        editorApiRef.current.updateCode('')
      } else {
        pendingCodeRef.current = ''
      }
      socketRef.current?.emit('clear-all', { roomId })
    }
  }, [roomId])

  const handleClearChat = useCallback(() => {
    if (window.confirm('Clear chat history for everyone in this room?')) {
      setMessages([])
      socketRef.current?.emit('clear-chat', { roomId })
    }
  }, [roomId])

  // Panic wipe — instant, no confirmation; wipes code + chat together (BLACK is cleared by Chat itself)
  const handlePanicWipe = useCallback(() => {
    setCode('')
    setMessages([])
    if (editorApiRef.current) {
      editorApiRef.current.updateCode('')
    } else {
      pendingCodeRef.current = ''
    }
    socketRef.current?.emit('clear-all', { roomId })
  }, [roomId])

  const handleSendMessage = useCallback(async (content: string, imageData?: string, videoData?: string, audioData?: string, replyTo?: { id: string; userName: string; content: string }): Promise<void> => {
    if (videoData) {
      const CHUNK = 512 * 1024 // 512 KB — safe through reverse proxies and serverless platforms
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const total = Math.ceil(videoData.length / CHUNK)
      setVideoSendProgress(0)
      try {
        for (let i = 0; i < total; i++) {
          const chunk = videoData.slice(i * CHUNK, (i + 1) * CHUNK)
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('chunk timeout')), 20_000)
            socketRef.current?.emit(
              'video-chunk',
              { uploadId, roomId, chunkIndex: i, totalChunks: total, data: chunk, ...(i === 0 ? { content, imageData, replyTo } : {}) },
              () => { clearTimeout(t); resolve() },
            )
          })
          setVideoSendProgress(Math.round(((i + 1) / total) * 100))
        }
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('finalize timeout')), 20_000)
          socketRef.current?.emit('video-finalize', { uploadId, roomId }, () => { clearTimeout(t); resolve() })
        })
      } finally {
        setVideoSendProgress(null)
      }
    } else {
      await new Promise<void>((resolve, reject) => {
        if (!socketRef.current) { reject(new Error('socket not connected')); return }
        const t = setTimeout(() => reject(new Error('send-message timeout')), 8_000)
        socketRef.current.emit('send-message', { roomId, content, imageData, audioData, replyTo }, (res?: { ok: boolean }) => {
          clearTimeout(t)
          if (res && res.ok === false) reject(new Error('send-message rejected'))
          else resolve()
        })
      })
    }
  }, [roomId])


  const handleDeleteMessage = useCallback((messageId: string) => {
    socketRef.current?.emit('delete-message', { roomId, messageId })
  }, [roomId])

  const handleAddReaction = useCallback((messageId: string, emoji: string) => {
    socketRef.current?.emit('add-reaction', { roomId, messageId, emoji })
  }, [roomId])

  
  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    socketRef.current?.emit('edit-message', { roomId, messageId, newContent })
  }, [roomId])

  const handleSetDisappear = useCallback((duration: number | null) => {
    socketRef.current?.emit('set-disappear', { roomId, duration })
  }, [roomId])

  const handleRefreshChat = useCallback(() => {
    socketRef.current?.emit('refresh-chat', { roomId })
  }, [roomId])

  const handleLiveMessage = useCallback((text: string) => {
    socketRef.current?.emit('live-message', { roomId, text })
  }, [roomId])

  const handlePoke = useCallback(() => {
    socketRef.current?.emit('poke', { roomId })
  }, [roomId])

  const handleAngryBird = useCallback(() => {
    socketRef.current?.emit('angrybird', { roomId })
  }, [roomId])

  const handleSink = useCallback(() => {
    socketRef.current?.emit('sink', { roomId })
  }, [roomId])

  // Tells the server the pending count has been seen so it doesn't reappear after a refresh
  const handleSinkAck = useCallback(() => {
    socketRef.current?.emit('sink-ack', { roomId })
  }, [roomId])

  const handleSinkBubbleClick = useCallback(() => {
    // A drag gesture dismisses the bubble instead of opening the burst
    if (sinkDragRef.current?.moved) return
    setSinkBurstCount(sinkCount)
    setSinkCount(0)
    handleSinkAck()
    setSinkBurst(true)
    setTimeout(() => setSinkBurst(false), 2200)
  }, [sinkCount, handleSinkAck])

  const handleSinkPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    sinkDragRef.current = { startX: e.clientX, moved: false }
    setSinkDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handleSinkPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = sinkDragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    if (Math.abs(dx) > 4) drag.moved = true
    setSinkDragX(dx)
  }, [])

  const handleSinkPointerUp = useCallback(() => {
    const drag = sinkDragRef.current
    setSinkDragging(false)
    if (!drag) return
    const dismissThreshold = 70
    if (Math.abs(sinkDragX) > dismissThreshold) {
      setSinkDragX(sinkDragX > 0 ? 400 : -400)
      setTimeout(() => { setSinkCount(0); setSinkDragX(0); sinkDragRef.current = null }, 200)
      handleSinkAck()
    } else {
      setSinkDragX(0)
      sinkDragRef.current = null
    }
  }, [sinkDragX, handleSinkAck])

  const handleRenameUser = useCallback((name: string) => {
    setUserName(name)
    userNameRef.current = name
    try { localStorage.setItem('codeshare-username', name) } catch {}
    socketRef.current?.emit('rename-user', { name })
  }, [])

  const handleReaction = useCallback((emoji: string) => {
    socketRef.current?.emit('reaction', { roomId, emoji })
  }, [roomId])

  const handleChangePassword = useCallback((newPassword: string) => {
    socketRef.current?.emit('change-password', { roomId, newPassword })
  }, [roomId])

  const handleTheBlack = useCallback((photos: string[], expiresAt?: number | null) => {
    socketRef.current?.emit('theblack', { roomId, photos, expiresAt: expiresAt ?? null })
  }, [roomId])

  const handlePasswordSubmit = useCallback((password: string) => {
    setAuthError('')
    authPasswordRef.current = password
    // isNew:true lets the server recreate the room if it expired (e.g. after restart with no Redis)
    socketRef.current?.emit('join-room', { roomId, name: userNameRef.current, password, isNew: true })
  }, [roomId])

  const handleLogout = useCallback(() => {
    try { localStorage.removeItem(`room-session-${roomId}`) } catch {}
    window.location.href = '/'
  }, [roomId])

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100dvh', backgroundColor: '#0d1117' }}>
      {reactionEmoji && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
          <span className="heart-burst leading-none select-none" style={{ fontSize: '40vmin' }}>{reactionEmoji}</span>
        </div>,
        document.body
      )}
      {sinkCount > 0 && createPortal(
        <button
          onClick={handleSinkBubbleClick}
          onPointerDown={handleSinkPointerDown}
          onPointerMove={handleSinkPointerMove}
          onPointerUp={handleSinkPointerUp}
          onPointerCancel={handleSinkPointerUp}
          title="Tap to see how many times you've been sunk — drag to dismiss"
          className="sink-bubble-in fixed bottom-6 right-6 z-[9998] flex items-center gap-2 rounded-full pl-3 pr-4 py-2.5 shadow-lg select-none touch-none"
          style={{
            background: 'linear-gradient(135deg, #ff6b9d, #ff3d71)',
            color: '#fff',
            boxShadow: '0 4px 20px rgba(255,61,113,0.5)',
            transform: `translateX(${sinkDragX}px)`,
            opacity: 1 - Math.min(Math.abs(sinkDragX) / 140, 0.85),
            transition: sinkDragging ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
          }}
        >

          <span className="text-sm font-semibold whitespace-nowrap">Sunk × {sinkCount}!</span>
        </button>,
        document.body
      )}
      {sinkBurst && createPortal(
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center pointer-events-none overflow-hidden">
          {Array.from({ length: 16 }).map((_, i) => (
            <span
              key={i}
              className="sink-burst-heart absolute select-none"
              style={{
                left: `${5 + (i * 6) % 90}%`,
                bottom: '-10%',
                fontSize: `${18 + (i % 5) * 8}px`,
                animationDelay: `${(i % 8) * 90}ms`,
              }}
           >🖤</span>
          ))}

          {sinkBurstCount > 1 && (
            <span className="sink-burst-subtext leading-none select-none" style={{ fontSize: '4vmin', fontWeight: 600, color: '#ffd6e5' }}>
              {sinkBurstCount} times ×
            </span>
          )}
        </div>,
        document.body
      )}
      {/* Block all room content until the server confirms the correct password via room-state */}
      {!isAuthenticated ? (
        showPasswordModal
          ? <PasswordModal roomId={roomId} error={authError} onSubmit={handlePasswordSubmit} />
          : <div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin" /></div>
      ) : (
        <>
        <Toolbar
          roomId={roomId}
          displayName={displayRoomName}
          language={language}
          userCount={userCount}
          userName={userName}
          connected={connected}
          onLanguageChange={handleLanguageChange}
          onClearCode={handleClear}
          onRenameUser={handleRenameUser}
          onLogout={handleLogout}
          currentPassword={roomPassword}
          onChangePassword={handleChangePassword}
        />

      {!connected && (
        <div className="text-center text-xs py-1.5 px-4 border-b border-yellow-900/40 shrink-0" style={{ backgroundColor: 'rgba(120,80,0,0.2)', color: '#fbbf24' }}>
          Connecting…
        </div>
      )}

      {/* Mobile tab bar */}
      <div className="md:hidden flex border-b border-gray-800 shrink-0" style={{ backgroundColor: '#0d1117' }}>
        <button
          onClick={() => setMobileTab('code')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            mobileTab === 'code' ? 'border-b-2 border-[#666666] text-[#666666]' : 'text-gray-500'
          }`}
        >
          Code
        </button>
        <button
          onClick={() => setMobileTab('chat')}
          className={`relative flex-1 py-2.5 text-sm font-medium transition-colors ${
            mobileTab === 'chat' ? 'border-b-2 border-[#666666] text-[#666666]' : 'text-gray-500'
          }`}
        >
          Chat
          {newMessages > 0 && (
            <span className="absolute top-1.5 ml-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {newMessages > 9 ? '9+' : newMessages}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Code editor — visible on desktop always; on mobile only when code tab active */}
        <div
          className={[
            'overflow-hidden',
            mobileTab === 'code' ? 'flex flex-col flex-1' : 'hidden',
            'md:flex md:flex-col md:flex-1',
          ].join(' ')}
        >
          <CodeEditor
            initialCode={code}
            language={language}
            onChange={handleCodeChange}
            onEditorReady={handleEditorReady}
          />
        </div>

        {/* Chat panel — fixed width on desktop; full width on mobile when active */}
        <div
          className={[
            'overflow-hidden',
            mobileTab === 'chat' ? 'flex flex-col flex-1' : 'hidden',
            'md:flex md:flex-col md:w-[300px] md:shrink-0 md:border-l md:border-gray-800',
          ].join(' ')}
        >
          <Chat
            messages={messages}
            onSendMessage={handleSendMessage}
            onClearChat={handleClearChat}
            onDeleteMessage={handleDeleteMessage}
            onAddReaction={handleAddReaction}
            onEditMessage={handleEditMessage}
            onSetDisappear={handleSetDisappear}
            onRefreshChat={handleRefreshChat}
            disappearAfter={disappearAfter}
            currentUserId={socketId}
            currentUserName={userName}
            videoSendProgress={videoSendProgress}
            liveMessages={liveMessages}
            onLiveMessage={handleLiveMessage}
            onPoke={handlePoke}
            pokeLevel={pokeLevel}
            onAngryBird={handleAngryBird}
            angryBirdOwnerId={angryBirdOwnerId}
            onSink={handleSink}
            heartbeatActive={heartbeatActive}
            onReaction={handleReaction}
            showTimeTravel
            activities={activities}
            initialLastActive={lastActive}
            onTheBlack={handleTheBlack}
            theBlackData={theBlackData}
            initialTheBlack={initialTheBlack}
            onPanicWipe={handlePanicWipe}
            peerActive={userCount > 1 && focusedUserIds.some((id) => id !== socketId)}
            className="flex-1 min-h-0"
          />
        </div>
      </div>
      </>
      )}
    </div>
  )
}
