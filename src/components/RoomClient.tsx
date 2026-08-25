'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { ChatMessage, RoomState } from '@/types'
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

  const socketRef = useRef<Socket | null>(null)
  const editorApiRef = useRef<CodeEditorApi | null>(null)
  const mobileTabRef = useRef(mobileTab)
  const pendingCodeRef = useRef<string | null>(null)
  const userNameRef = useRef('')
  const lastPokeRef = useRef(0)

  useEffect(() => {
    mobileTabRef.current = mobileTab
    if (mobileTab === 'chat') setNewMessages(0)
  }, [mobileTab])

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

    // Read password once for the initial join (set by landing page on creation), then discard it
    // so any fresh page visit — on any device — always requires re-entering the password
    let joinPassword: string | undefined
    try {
      joinPassword = sessionStorage.getItem(`room-pwd-${roomId}`) ?? undefined
      if (joinPassword) sessionStorage.removeItem(`room-pwd-${roomId}`)
    } catch {}

    const socket = io({ path: '/api/socket', addTrailingSlash: false })
    socketRef.current = socket

    socket.on('connect', () => {
      if (socketRef.current !== socket) return  // ignore stale socket events after cleanup
      setConnected(true)
      setSocketId(socket.id ?? '')
      socket.emit('join-room', { roomId, name, password: joinPassword })
    })

    socket.on('auth-error', (msg: string) => {
      setAuthError(msg)
      setShowPasswordModal(true)
    })

    socket.on('disconnect', () => {
      if (socketRef.current !== socket) return  // ignore disconnect from replaced socket
      setConnected(false)
    })

    socket.on('room-state', (state: RoomState) => {
      setShowPasswordModal(false)
      setAuthError('')
      setIsAuthenticated(true)
      setCode(state.code)
      setLanguage(state.language)
      setMessages(state.messages)
      if (state.roomName) setDisplayRoomName(state.roomName)
      setDisappearAfter(state.disappearAfter ?? null)
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

  const handleSendMessage = useCallback(async (content: string, imageData?: string, videoData?: string): Promise<void> => {
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
              { uploadId, roomId, chunkIndex: i, totalChunks: total, data: chunk, ...(i === 0 ? { content, imageData } : {}) },
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
      socketRef.current?.emit('send-message', { roomId, content, imageData })
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

  const handleLiveMessage = useCallback((text: string) => {
    socketRef.current?.emit('live-message', { roomId, text })
  }, [roomId])

  const handlePoke = useCallback(() => {
    socketRef.current?.emit('poke', { roomId })
  }, [roomId])

  const handlePasswordSubmit = useCallback((password: string) => {
    setAuthError('')
    socketRef.current?.emit('join-room', { roomId, name: userNameRef.current, password })
  }, [roomId])

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100dvh', backgroundColor: '#0d1117' }}>
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
          onClearAll={handleClearAll}
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
            mobileTab === 'code' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-gray-500'
          }`}
        >
          Code
        </button>
        <button
          onClick={() => setMobileTab('chat')}
          className={`relative flex-1 py-2.5 text-sm font-medium transition-colors ${
            mobileTab === 'chat' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-gray-500'
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
            disappearAfter={disappearAfter}
            currentUserId={socketId}
            videoSendProgress={videoSendProgress}
            liveMessages={liveMessages}
            onLiveMessage={handleLiveMessage}
            onPoke={handlePoke}
            pokeLevel={pokeLevel}
            className="flex-1 min-h-0"
          />
        </div>
      </div>
      </>
      )}
    </div>
  )
}
