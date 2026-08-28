'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { ChatMessage } from '@/types'
import { getUserColor, formatTime } from '@/lib/utils'

interface ChatProps {
  messages: ChatMessage[]
  onSendMessage: (content: string, imageData?: string, videoData?: string, replyTo?: { id: string; userName: string; content: string }) => Promise<void> | void
  onClearChat: () => void
  onDeleteMessage: (messageId: string) => void
  onAddReaction: (messageId: string, emoji: string) => void
  onEditMessage: (messageId: string, newContent: string) => void
  onSetDisappear: (duration: number | null) => void
  disappearAfter: number | null
  currentUserId: string
  currentUserName: string
  videoSendProgress?: number | null
  className?: string
  liveMessages?: Record<string, { userName: string; text: string }>
  onLiveMessage?: (text: string) => void
  onPoke?: () => void
  pokeLevel?: number
  onAngryBird?: () => void
  angryBirdOwnerId?: string | null
  onSink?: () => void
  heartbeatActive?: boolean
  onReaction?: (emoji: string) => void
  showTimeTravel?: boolean
  activities?: Record<string, { first: number; last: number }>
  initialLastActive?: number | null
}

// Single dot at the last-seen time of the other user, placed on a 12-hr vertical clock
// lastSeenTs is persisted in parent state so it survives chat clears
function TimeTravelBar({ lastSeenTs }: { lastSeenTs: number | null }) {
  if (!lastSeenTs) return <div className="w-5 shrink-0" style={{ backgroundColor: '#000000' }} />
  const d = new Date(lastSeenTs)
  const totalMins = d.getHours() * 60 + d.getMinutes()
  const pct = totalMins / 1440 * 100
  const label = new Date(lastSeenTs).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
  return (
    <div className="relative w-5 shrink-0 select-none overflow-hidden" style={{ backgroundColor: '#000000' }}>
      {/* barely-visible 12-hr line */}
      <div className="absolute inset-y-2" style={{ left: '9px', width: '1px', backgroundColor: 'rgba(255,255,255,0.06)' }} />
      <div className="absolute" style={{ top: `${pct}%`, left: 0, right: 0, transform: 'translateY(-50%)' }}>
        {/* label rotated vertical, sits above the dot so it doesn't overlap */}
        <span
          className="absolute text-[7px] leading-none whitespace-nowrap"
          style={{ color: '#4b5563', bottom: '20px', left: '50%', transform: 'translateX(-50%) rotate(-90deg)', transformOrigin: 'center center' }}
        >{label}</span>
        <div className="w-1.5 h-1.5 rounded-full absolute" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)', backgroundColor: '#ff5722' }} />
      </div>
    </div>
  )
}

// Per-user activity segments on a 24-hour horizontal bar (12am → 12am)
function DailyActivityBar({ messages, currentUserName, sessionStart, activities }: {
  messages: ChatMessage[]
  currentUserName: string
  sessionStart: number
  activities: Record<string, { first: number; last: number }>
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const t0 = todayStart.getTime()

  // Prefer server-tracked activity; supplement with message timestamps for any gaps
  const userMap: Record<string, { first: number; last: number }> = {}
  for (const [name, data] of Object.entries(activities)) {
    if (data.first >= t0) userMap[name] = { ...data }
  }
  for (const msg of messages) {
    if (msg.type === 'system' || msg.timestamp < t0) continue
    const { userName, timestamp } = msg
    if (!userMap[userName]) {
      userMap[userName] = { first: timestamp, last: timestamp }
    } else {
      if (timestamp < userMap[userName].first) userMap[userName].first = timestamp
      if (timestamp > userMap[userName].last)  userMap[userName].last  = timestamp
    }
  }
  // Extend current user's bar to now (they are still active)
  if (!userMap[currentUserName]) {
    userMap[currentUserName] = { first: Math.max(sessionStart, t0), last: now }
  } else {
    userMap[currentUserName].first = Math.min(userMap[currentUserName].first, Math.max(sessionStart, t0))
    userMap[currentUserName].last  = now
  }

  const tooltipLines = Object.entries(userMap)
    .map(([name, { first, last }]) => {
      const s = new Date(first).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const e = new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      return `${name}: ${s}–${e}`
    })
    .join('\n')

  // Self at bottom, others above
  const users = [
    ...Object.entries(userMap).filter(([name]) => name !== currentUserName),
    ...Object.entries(userMap).filter(([name]) => name === currentUserName),
  ]
  const ROW_H = 4
  const GAP = 1
  const totalH = Math.max(14, users.length * (ROW_H + GAP) - GAP)

  return (
    <div
      className="relative rounded overflow-hidden shrink-0"
      style={{ width: 200, height: totalH }}
      title={tooltipLines || 'Daily activity'}
    >
      {users.map(([name, { first, last }], i) => {
        const w = Math.min(100, Math.max((last - first) / (6 * 60 * 60 * 1000) * 100, 0))
        const color = name === currentUserName ? '#2563eb' : getUserColor(name)
        return (
          <div
            key={name}
            className="absolute opacity-80"
            style={{ left: 0, width: `${w}%`, minWidth: 4, top: i * (ROW_H + GAP), height: ROW_H, backgroundColor: color }}
          />
        )
      })}
    </div>
  )
}

const REACTION_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🔥']
const DISAPPEAR_OPTIONS: { label: string; short: string; value: number | null }[] = [
  { label: 'Off', short: 'Off', value: null },
  { label: '10 minutes', short: '10m', value: 10 * 60 * 1000 },
  { label: '30 minutes', short: '30m', value: 30 * 60 * 1000 },
  { label: '1 hour', short: '1h', value: 60 * 60 * 1000 },
  { label: '2 hours', short: '2h', value: 2 * 60 * 60 * 1000 },
]

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10 MB before compression
const MAX_VIDEO_SIZE = 25 * 1024 * 1024 // 25 MB for direct data URL uploads
const MAX_DIMENSION = 1200

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width >= height) {
            height = Math.round((height * MAX_DIMENSION) / width)
            width = MAX_DIMENSION
          } else {
            width = Math.round((width * MAX_DIMENSION) / height)
            height = MAX_DIMENSION
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = e.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function Chat({ messages, onSendMessage, onClearChat, onDeleteMessage, onEditMessage, onAddReaction, onSetDisappear, disappearAfter, currentUserId, currentUserName, videoSendProgress = null, className = '', liveMessages, onLiveMessage, onPoke, pokeLevel, onAngryBird, angryBirdOwnerId = null, onSink, heartbeatActive, onReaction, showTimeTravel = false, activities = {}, initialLastActive = null }: ChatProps) {
  const [input, setInput] = useState('')
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [pendingVideo, setPendingVideo] = useState<string | null>(null)
  const [mediaLoading, setMediaLoading] = useState(false)
  const [loadingVideo, setLoadingVideo] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [videoLightboxSrc, setVideoLightboxSrc] = useState<string | null>(null)
  const [showDisappearMenu, setShowDisappearMenu] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [liveMessageEnabled, setLiveMessageEnabled] = useState(false)
  const [pokeButtonActive, setPokeButtonActive] = useState(false)
  const [replyingTo, setReplyingTo] = useState<import('@/types').ChatMessage | null>(null)
  const [lastSeenTs, setLastSeenTs] = useState<number | null>(null)
  const [playingIds, setPlayingIds] = useState<Set<string>>(new Set())
  const [videoErrorIds, setVideoErrorIds] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)
  const initialScrollDoneRef = useRef(false)
  const touchStartXRef = useRef<number | null>(null)
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const sessionStartRef = useRef(Date.now())

  // Track last-seen timestamp across message clears
  useEffect(() => {
    const last = [...messages].reverse().find(
      (m) => m.type !== 'system' && m.userId !== currentUserId && m.userName !== currentUserName
    )
    if (last) setLastSeenTs((prev) => (prev !== null && prev >= last.timestamp ? prev : last.timestamp))
  }, [messages, currentUserId, currentUserName])

  // Restore last-seen from localStorage on mount (persists across refreshes)
  useEffect(() => {
    try {
      const v = localStorage.getItem(`timetravel:${window.location.pathname}`)
      if (v) setLastSeenTs((prev) => Math.max(prev ?? 0, Number(v)) || null)
    } catch {}
  }, [])

  // Seed last-seen from server-persisted value (survives redeployments)
  useEffect(() => {
    if (initialLastActive) setLastSeenTs((prev) => (prev !== null && prev >= initialLastActive ? prev : initialLastActive))
  }, [initialLastActive])

  // Write to localStorage whenever last-seen advances
  useEffect(() => {
    if (!lastSeenTs) return
    try { localStorage.setItem(`timetravel:${window.location.pathname}`, String(lastSeenTs)) } catch {}
  }, [lastSeenTs])

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxSrc && !videoLightboxSrc) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { setLightboxSrc(null); setVideoLightboxSrc(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxSrc, videoLightboxSrc])
  
  // Close reaction picker when clicking outside
  useEffect(() => {
    if (!reactionPickerMsgId) return
    const close = () => setReactionPickerMsgId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [reactionPickerMsgId])
  
  // Focus the edit textarea when entering edit mode
  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  const startEdit = (msg: ChatMessage) => {
    setEditingId(msg.id)
    setEditText(msg.content)
  }

  const saveEdit = () => {
    if (editingId && editText.trim()) {
      onEditMessage(editingId, editText.trim())
    }
    setEditingId(null)
  }

  const cancelEdit = () => setEditingId(null)

  // Client-side expiry: remove messages whose expiresAt has passed (backup for reconnects)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      // This is purely local cleanup; server already broadcasts deletions via message-disappeared
      // but handles the edge case of missed events during disconnection
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!messagesEndRef.current) return
    if (!initialScrollDoneRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'instant' })
      initialScrollDoneRef.current = true
    } else {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_SIZE) {
        alert('Image too large (max 10 MB).')
        return
      }
      setMediaLoading(true)
      try {
        setPendingVideo(null)
        setPendingImage(await compressImage(file))
      } catch {
        alert('Could not process image. Please try another file.')
      } finally {
        setMediaLoading(false)
      }
      return
    }

    if (file.type.startsWith('video/') || (!file.type && /\.(mov|mp4|m4v|webm|avi|mkv|3gp)$/i.test(file.name))) {
      if (file.size > MAX_VIDEO_SIZE) {
        alert('Video too large (max 25 MB).')
        return
      }
      setMediaLoading(true)
      setLoadingVideo(true)
      setUploadProgress(0)
      try {
        const reader = new FileReader()
        let result = await new Promise<string>((resolve, reject) => {
          reader.onprogress = (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
          }
          reader.onload = () => { setUploadProgress(100); resolve(String(reader.result ?? '')) }
          reader.onerror = () => reject(new Error('Could not read video'))
          reader.readAsDataURL(file)
        })
        // Remap video/quicktime → video/mp4 so Chrome can decode H.264 .mov files
        if (result.startsWith('data:video/quicktime;')) result = result.replace('data:video/quicktime;', 'data:video/mp4;')
        setPendingImage(null)
        setPendingVideo(result)
      } catch {
        alert('Could not process video. Please try another file.')
      } finally {
        setMediaLoading(false)
        setLoadingVideo(false)
      }
      return
    }

    alert('Only image or video files are supported.')
  }

  const handleSend = async () => {
    if (isAngryBirdLockedOut) return
    const content = input.trim()
    if (!content && !pendingImage && !pendingVideo) return
    const videoToSend = pendingVideo
    const replyTo = replyingTo ? { id: replyingTo.id, userName: replyingTo.userName, content: replyingTo.content || (replyingTo.imageData ? '📷 Photo' : replyingTo.videoData ? '🎬 Video' : '') } : undefined
    setInput('')
    if (liveMessageEnabled) onLiveMessage?.('')
    setReplyingTo(null)
    setPendingImage(null)
    // Keep pendingVideo alive until the chunked upload finishes
    if (!videoToSend) setPendingVideo(null)
    inputRef.current?.focus()
    try {
      await onSendMessage(content, videoToSend ? undefined : pendingImage ?? undefined, videoToSend ?? undefined, replyTo)
    } finally {
      if (videoToSend) setPendingVideo(null)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isSendingVideo = videoSendProgress !== null
  const angryBirdActive = !!angryBirdOwnerId
  const isAngryBirdOwner = angryBirdOwnerId === currentUserId
  const isAngryBirdLockedOut = angryBirdActive && !isAngryBirdOwner
  const canSend = (!!input.trim() || !!pendingImage || !!pendingVideo) && !isSendingVideo && !isAngryBirdLockedOut

  return (
    <div className={`flex flex-col ${className}`} style={{ backgroundColor: '#000000' }}>
      {/* Full-screen video lightbox */}
      {videoLightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}
          onClick={() => setVideoLightboxSrc(null)}
        >
          <button
            onClick={() => setVideoLightboxSrc(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full p-2 transition-colors"
            aria-label="Close video"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
            </svg>
          </button>
          <video
            src={videoLightboxSrc}
            controls
            playsInline
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl shadow-2xl"
            style={{ maxWidth: '100%', maxHeight: '90dvh' }}
          />
        </div>
      )}
      {/* Full-screen image lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightboxSrc(null)}
        >
          {/* Close button */}
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full p-2 transition-colors"
            aria-label="Close image"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
            </svg>
          </button>
          {/* Image — constrained to viewport, click on image itself does nothing (stops propagation) */}
          <img
            src={lightboxSrc}
            alt="full size"
            onClick={(e) => e.stopPropagation()}
            className="block rounded-xl shadow-2xl"
            style={{ maxWidth: '100%', maxHeight: '90dvh', objectFit: 'contain', cursor: 'default' }}
          />
        </div>
      )}
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700/50 flex items-center gap-2 shrink-0 relative">        
        <DailyActivityBar
          messages={messages}
          currentUserName={currentUserName}
          sessionStart={sessionStartRef.current}
          activities={activities}
        />

        <div className="flex-1" />

        {/* Disappearing messages toggle */}
        <div className="relative">
          <button
            onClick={() => setShowDisappearMenu((v) => !v)}
            title="Disappearing messages"
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              disappearAfter
                ? 'text-blue-400 bg-blue-500/10'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/30'
            }`}
          >
            {/* Clock icon */}
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/>
              <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/>
            </svg>
            {disappearAfter
              ? DISAPPEAR_OPTIONS.find((o) => o.value === disappearAfter)?.short ?? 'On'
              : 'Timer'}
          </button>

          {/* Dropdown */}
          {showDisappearMenu && (
            <div
              className="absolute right-0 top-full mt-1 z-20 rounded-xl overflow-hidden shadow-xl border border-gray-700/60"
              style={{ backgroundColor: '#1c2333', minWidth: '140px' }}
            >
              {DISAPPEAR_OPTIONS.map((opt) => (
                <button
                  key={String(opt.value)}
                  onClick={() => { onSetDisappear(opt.value); setShowDisappearMenu(false) }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between ${
                    disappearAfter === opt.value
                      ? 'text-blue-400 bg-blue-500/10'
                      : 'text-gray-300 hover:bg-gray-700/40'
                  }`}
                >
                  <span>{opt.label}</span>
                  {disappearAfter === opt.value && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onClearChat}
          title="Clear chat for everyone"
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-red-400 hover:bg-red-950/20 rounded transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16">
            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
            <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
          </svg>
          Clear chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex flex-1 min-h-0">
      {showTimeTravel && <TimeTravelBar lastSeenTs={lastSeenTs} />}
      <div
        className="chat-messages flex-1 overflow-y-auto min-h-0"
        style={{ scrollbarWidth: 'none', backgroundImage: angryBirdActive ? 'linear-gradient(89deg, #000000 0%, #140300 74%)' : undefined }}
      >
        <div className={`flex flex-col min-h-half py-3 pr-3 space-y-0.5${pokeLevel === 2 ? ' chat-poke-intense' : pokeLevel === 1 ? ' chat-poke' : ''}${heartbeatActive ? ' chat-heartbeat' : ''}`}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-xl text-center py-12">
            <span className="text-3xl mb-3">💬</span>
            <p className="text-gray-500 text-sm">No messages yet.</p>
            <p className="text-gray-600 text-xs mt-1">Say hello to your collaborators!</p>
          </div>
        )}
        {(() => {
          // Merge consecutive same-user text messages into one cluster → one bubble
          type Cluster =
            | { kind: 'system'; msg: ChatMessage }
            | { kind: 'media';  msg: ChatMessage }
            | { kind: 'text';   msgs: ChatMessage[] }
          const clusters: Cluster[] = []
          for (const msg of messages) {
            if (msg.type === 'system') {
              clusters.push({ kind: 'system', msg })
            } else if (msg.imageData || msg.videoData) {
              clusters.push({ kind: 'media', msg })
            } else {
              const last = clusters[clusters.length - 1]
              if (last?.kind === 'text' && last.msgs[0].userId === msg.userId && !msg.replyTo) {
                last.msgs.push(msg)
              } else {
                clusters.push({ kind: 'text', msgs: [msg] })
              }
            }
          }

          return clusters.map((cluster) => {
            /* ── system divider ── */
            if (cluster.kind === 'system') {
              return (
                <div key={cluster.msg.id} className="flex items-center gap-2 my-2 px-2">
                  <div className="flex-1 h-px bg-gray-800" />
                  <span className="text-[11px] text-gray-600 italic shrink-0">{cluster.msg.content}</span>
                  <div className="flex-1 h-px bg-gray-800" />
                </div>
              )
            }

            /* ── media message (image / video) ── */
            if (cluster.kind === 'media') {
              const msg = cluster.msg
              const isOwn = msg.userId === currentUserId || msg.userName === currentUserName
              return (
                <div key={msg.id} className={`msg-in flex flex-col mb-2 ${isOwn ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5 px-1">
                    <span className="text-xs font-semibold" style={{ color: getUserColor(msg.userId) }}>{isOwn ? 'You' : msg.userName}</span>
                    <span className="text-xs text-gray-600">{formatTime(msg.timestamp)}</span>
                    {msg.expiresAt && <span title="This message will disappear" className="text-blue-500/60"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16"><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/></svg></span>}
                  </div>
                  <div className={`relative max-w-[88%] flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}
                    onTouchStart={(e) => { touchStartXRef.current = e.touches[0].clientX; e.currentTarget.style.transition = 'none' }}
                    onTouchMove={(e) => { if (touchStartXRef.current === null) return; const dx = e.touches[0].clientX - touchStartXRef.current; e.currentTarget.style.transform = `translateX(${Math.max(-15, Math.min(15, dx))}px)` }}
                    onTouchEnd={(e) => { const dx = touchStartXRef.current !== null ? e.changedTouches[0].clientX - touchStartXRef.current : 0; e.currentTarget.style.transition = 'transform 0.2s ease'; e.currentTarget.style.transform = 'translateX(0)'; if (touchStartXRef.current !== null && Math.abs(dx) > 40) { setReplyingTo(msg) } touchStartXRef.current = null }}
                  >
                    {reactionPickerMsgId === msg.id && (
                      <div onClick={(e) => e.stopPropagation()} className={`absolute bottom-full mb-2 z-30 flex gap-0.5 p-1.5 rounded-2xl shadow-xl border border-gray-700/60 ${isOwn ? 'right-0' : 'left-0'}`} style={{ backgroundColor: '#1c2333' }}>
                        {REACTION_EMOJIS.map((emoji) => (
                          <button key={emoji} onClick={() => { onAddReaction(msg.id, emoji); setReactionPickerMsgId(null) }} className="text-xl hover:scale-125 transition-transform p-1 leading-none">{emoji}</button>
                        ))}
                      </div>
                    )}
                    {msg.videoData && (
                      <div className="group relative inline-block rounded-2xl overflow-hidden border border-gray-700/40" onContextMenu={(e) => { e.preventDefault(); setReactionPickerMsgId(msg.id) }}>
                        {videoErrorIds.has(msg.id) ? (
                          <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 min-w-[180px] min-h-[180px]" style={{ backgroundColor: '#0d1117' }}>
                            <span className="text-gray-500 text-xs text-center">Can't preview this video format</span>
                            <a href={msg.videoData} download="video" className="px-3 py-1.5 rounded-lg text-xs text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 transition-colors">Download to view</a>
                          </div>
                        ) : (
                          <video
                            ref={(el) => { if (el) videoRefs.current.set(msg.id, el); else videoRefs.current.delete(msg.id) }}
                            src={msg.videoData}
                            playsInline
                            preload="metadata"
                            onPlay={() => setPlayingIds(prev => new Set(prev).add(msg.id))}
                            onPause={() => setPlayingIds(prev => { const s = new Set(prev); s.delete(msg.id); return s })}
                            onEnded={() => setPlayingIds(prev => { const s = new Set(prev); s.delete(msg.id); return s })}
                            onError={() => setVideoErrorIds(prev => new Set(prev).add(msg.id))}
                            className="max-w-[260px] min-h-[180px] max-h-[280px] block"
                          />
                        )}
                        {/* Centered play/pause toggle — fades out while playing, reappears on hover */}
                        {!videoErrorIds.has(msg.id) && (
                        <button
                          onClick={() => { const v = videoRefs.current.get(msg.id); if (v) { if (v.paused) v.play(); else v.pause() } }}
                          className={`absolute inset-0 flex items-center justify-center transition-opacity ${playingIds.has(msg.id) ? 'opacity-0 hover:opacity-80' : 'opacity-100 bg-black/30'}`}
                        >
                          <span className="flex items-center justify-center w-12 h-12 rounded-full bg-black/60">
                            {playingIds.has(msg.id) ? (
                              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="white" viewBox="0 0 16 16"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/></svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="white" viewBox="0 0 16 16"><path d="M6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z"/><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm15 0a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1z"/></svg>
                            )}
                          </span>
                        </button>
                        )}
                        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setVideoLightboxSrc(msg.videoData!)} title="Fullscreen" className="p-1.5 rounded-full bg-black/60 text-white/80 hover:bg-black/80 hover:text-white transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16"><path d="M1.5 1h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 1m13 0a1.5 1.5 0 0 1 1.5 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1 0-1zM.5 10.5a.5.5 0 0 1 1 0v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"/></svg>
                          </button>
                          <a href={msg.videoData} download="video" title="Download video" className="p-1.5 rounded-full bg-black/60 text-white/80 hover:bg-black/80 hover:text-white transition-colors flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/></svg>
                          </a>
                          <button onClick={() => onDeleteMessage(msg.id)} title="Delete video" aria-label="Delete video" className="p-1.5 rounded-full bg-black/60 text-white/80 hover:bg-red-600 hover:text-white transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
                          </button>
                        </div>
                      </div>
                    )}
                    {msg.imageData && (
                      <div className="group relative inline-block" onContextMenu={(e) => { e.preventDefault(); setReactionPickerMsgId(msg.id) }} onDoubleClick={() => onAddReaction(msg.id, '❤️')}>
                        <button onClick={() => setLightboxSrc(msg.imageData!)} title="Click to view full size" className="block rounded-2xl overflow-hidden border border-gray-700/40 hover:opacity-90 transition-opacity focus:outline-none">
                          <img src={msg.imageData} alt="shared image" className="max-w-[240px] max-h-[300px] object-cover block" />
                        </button>
                        <button onClick={() => onDeleteMessage(msg.id)} title="Delete image" aria-label="Delete image" className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white/80 hover:bg-red-600 hover:text-white transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
                        </button>
                      </div>
                    )}
                    {Object.keys(msg.reactions ?? {}).length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-0.5 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                        {Object.entries(msg.reactions!).map(([emoji, users]) => (
                          <button key={emoji} onClick={() => onAddReaction(msg.id, emoji)} className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${users.includes(currentUserId) ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-[#21262d] border-gray-700/60 text-gray-300 hover:border-gray-500'}`}>
                            <span>{emoji}</span>
                            {users.length > 1 && <span className="text-[10px] ml-0.5">{users.length}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            }

            /* ── text cluster → one big bubble ── */
            const { msgs } = cluster
            const first = msgs[0]
            const isOwn = first.userId === currentUserId || first.userName === currentUserName
            // Single message keeps the standard pointed corner; multi-message gets fully rounded
            const bubbleRadius = msgs.length === 1
              ? (isOwn ? '1rem .25rem 1rem 1rem' : '.25rem 1rem 1rem 1rem')
              : (isOwn ? '1rem .25rem 1rem 1rem' : '.25rem 1rem 1rem 1rem')

            return (
              <div key={first.id} className={`msg-in flex flex-col mb-2 ${isOwn ? 'items-end' : 'items-start'}`}
              >
                {/* Header — once per cluster */}
                <div className="flex items-center gap-1.5 mb-0.5 px-1">
                  <span className="text-xs font-semibold" style={{ color: getUserColor(first.userId) }}>{isOwn ? 'You' : first.userName}</span>
                  <span className="text-xs text-gray-600">{formatTime(first.timestamp)}</span>
                  {first.expiresAt && <span title="This message will disappear" className="text-blue-500/60"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16"><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/></svg></span>}
                </div>

                {/* Single unified bubble */}
                <div className="relative max-w-[88%]"
                  onTouchStart={(e) => { touchStartXRef.current = e.touches[0].clientX; e.currentTarget.style.transition = 'none' }}
                  onTouchMove={(e) => { if (touchStartXRef.current === null) return; const dx = e.touches[0].clientX - touchStartXRef.current; e.currentTarget.style.transform = `translateX(${Math.max(-15, Math.min(15, dx))}px)` }}
                  onTouchEnd={(e) => { const dx = touchStartXRef.current !== null ? e.changedTouches[0].clientX - touchStartXRef.current : 0; e.currentTarget.style.transition = 'transform 0.2s ease'; e.currentTarget.style.transform = 'translateX(0)'; if (touchStartXRef.current !== null && Math.abs(dx) > 40) { setReplyingTo(msgs[0]) } touchStartXRef.current = null }}
                >
                  {/* Reaction picker — anchored to the bubble */}
                  {reactionPickerMsgId && msgs.some((m) => m.id === reactionPickerMsgId) && (
                    <div onClick={(e) => e.stopPropagation()} className={`absolute bottom-full mb-2 z-30 flex gap-0.5 p-1.5 rounded-2xl shadow-xl border border-gray-700/60 ${isOwn ? 'right-0' : 'left-0'}`} style={{ backgroundColor: '#1c2333' }}>
                      {REACTION_EMOJIS.map((emoji) => (
                        <button key={emoji} onClick={() => { onAddReaction(reactionPickerMsgId!, emoji); setReactionPickerMsgId(null) }} className="text-xl hover:scale-125 transition-transform p-1 leading-none">{emoji}</button>
                      ))}
                    </div>
                  )}

                  <div
                    className={`px-3 py-2 text-sm ${isOwn ? 'text-white' : 'text-gray-200'}`}
                    style={{ borderRadius: bubbleRadius, backgroundColor: isOwn ? '#09111E' : '#100720' }}
                    onContextMenu={(e) => { e.preventDefault(); setReactionPickerMsgId(msgs[msgs.length - 1].id) }}
                    onDoubleClick={() => onAddReaction(msgs[msgs.length - 1].id, '❤️')}
                  >
                    {msgs[0].replyTo && (
                      <div className={`mb-1.5 px-2 py-1 rounded-lg border-l-2 text-[11px] opacity-70 ${isOwn ? 'border-white/40' : 'border-blue-400/60'}`} style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}>
                        <p className="font-semibold truncate">{msgs[0].replyTo.userName}</p>
                        <p className="truncate opacity-80">{msgs[0].replyTo.content || '📎 Attachment'}</p>
                      </div>
                    )}
                    {msgs.map((msg, lineIdx) => (
                      <div key={msg.id} className={`group ${lineIdx > 0 ? '' : ''}`}>
                        {editingId === msg.id ? (
                          <div>
                            <textarea
                              ref={editInputRef}
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
                                if (e.key === 'Escape') cancelEdit()
                              }}
                              rows={Math.min(4, editText.split('\n').length + 1)}
                              className="w-full px-2 py-1 text-sm text-white rounded-lg resize-none focus:outline-none"
                              style={{ backgroundColor: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.2)' }}
                            />
                            <div className="flex gap-2 mt-1 justify-end">
                              <button onClick={cancelEdit} className="px-2 py-0.5 text-xs rounded-lg opacity-70 hover:opacity-100 transition-opacity" style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}>Cancel</button>
                              <button onClick={saveEdit} disabled={!editText.trim()} className="px-2 py-0.5 text-xs rounded-lg disabled:opacity-40 transition-opacity" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>Save</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-end gap-1.5">
                            <span className="whitespace-pre-wrap break-words flex-1">{msg.content}</span>
                            {/* Per-line actions — visible on hover */}
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 self-end mb-0.5">
                              {isOwn && (
                                <button onClick={() => startEdit(msg)} title="Edit" className="p-0.5 rounded hover:bg-white/20 transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" fill="currentColor" viewBox="0 0 16 16"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z"/></svg>
                                </button>
                              )}
                              <button onClick={() => onDeleteMessage(msg.id)} title="Delete" className="p-0.5 rounded hover:bg-white/20 hover:text-red-300 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
                              </button>
                            </div>
                            {/* Seen tick on the last line of own clusters */}
                            {isOwn && lineIdx === msgs.length - 1 && (
                              <span className="shrink-0 self-end mb-0.5">
                                {(msg.seenBy?.length ?? 0) > 0 ? (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="10" viewBox="0 0 16 10" fill="none" aria-label="Seen"><path d="M1 5l3 3 5-6" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 5l3 3 5-6" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                ) : (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-label="Sent"><path d="M1 5l3 3 5-6" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                )}
                              </span>
                            )}
                            {msg.editedAt && <span className="text-[10px] opacity-60 italic shrink-0 self-end mb-0.5">edited</span>}
                          </div>
                        )}
                        {/* Per-message reactions */}
                        {Object.keys(msg.reactions ?? {}).length > 0 && (
                          <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                            {Object.entries(msg.reactions!).map(([emoji, users]) => (
                              <button key={emoji} onClick={() => onAddReaction(msg.id, emoji)} className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${users.includes(currentUserId) ? 'bg-white/20 border-white/30' : 'bg-black/20 border-white/15 hover:border-white/30'}`}>
                                <span>{emoji}</span>
                                {users.length > 1 && <span className="text-[10px] ml-0.5">{users.length}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })
        })()}
        <div ref={messagesEndRef} />
        </div>
      </div>
      </div>

      {/* Live Message */}
      <div className="shrink-0">
        {(Object.entries(liveMessages ?? {}).filter(([, v]) => v.text).length > 0 || (liveMessageEnabled && !!input)) && (
          <div className="px-3 pt-2 pb-0 space-y-1">
            {liveMessageEnabled && input && (
              <div className="flex items-start gap-1.5">
                <span className="text-[11px] font-semibold shrink-0" style={{ color: getUserColor(currentUserId) }}>You</span>
                <div className="flex-1 min-w-0 px-2.5 py-1 rounded-2xl text-xs text-gray-400 italic whitespace-pre-wrap break-words"
                     style={{ backgroundColor: '#161b22', border: '1px dashed rgba(255,255,255,0.08)' }}>
                  {input}
                </div>
              </div>
            )}
            {Object.entries(liveMessages ?? {}).filter(([, v]) => v.text).map(([uid, { userName, text }]) => (
              <div key={uid} className="flex items-start gap-1.5">
                <span className="text-[11px] font-semibold shrink-0" style={{ color: getUserColor(uid) }}>{userName}</span>
                <div className="flex-1 min-w-0 px-2.5 py-1 rounded-2xl text-xs text-gray-400 italic whitespace-pre-wrap break-words"
                     style={{ backgroundColor: '#161b22', border: '1px dashed rgba(255,255,255,0.08)' }}>
                  {text}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-1">
          <div className="flex items-center gap-1">
            <button
              onClick={() => { onPoke?.(); setPokeButtonActive(true); setTimeout(() => setPokeButtonActive(false), 400) }}
              title="Poke everyone"
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors text-gray-500 hover:text-orange-400 hover:bg-orange-500/10${pokeButtonActive ? ' poke-btn-active' : ''}`}
            >
              👋
            </button>
            <button
              onClick={() => onAngryBird?.()}
              disabled={angryBirdActive && !isAngryBirdOwner}
              title={angryBirdActive ? (isAngryBirdOwner ? 'Release AngryBird' : 'AngryBird is active') : 'AngryBird'}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${angryBirdActive ? 'text-red-300 bg-red-900/40' : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Ditch
            </button>
            {liveMessageEnabled && (
              <>
                <button onClick={() => onReaction?.('❤️')} title="Send a heart" className="px-1.5 py-1 rounded text-xs transition-colors text-gray-500 hover:text-red-400 hover:bg-red-500/10">❤️</button>
                <button onClick={() => onReaction?.('😡')} title="Send angry" className="px-1.5 py-1 rounded text-xs transition-colors text-gray-500 hover:text-orange-400 hover:bg-orange-500/10">😡</button>
                <button onClick={() => onReaction?.('😘')} title="Send a kiss" className="px-1.5 py-1 rounded text-xs transition-colors text-gray-500 hover:text-pink-400 hover:bg-pink-500/10">😘</button>
                <button onClick={() => onReaction?.('😂')} title="Send laughing" className="px-1.5 py-1 rounded text-xs transition-colors text-gray-500 hover:text-yellow-400 hover:bg-yellow-500/10">😂</button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onSink?.()}
              title="Sink — heartbeat the chat"
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${heartbeatActive ? 'text-pink-400 bg-pink-500/10' : 'text-gray-500 hover:text-pink-400 hover:bg-pink-500/10'}`}
            >
              Sink
            </button>
            <button
              onClick={() => { const next = !liveMessageEnabled; setLiveMessageEnabled(next); if (!next) onLiveMessage?.('') }}
              title="Live message — broadcast your typing in real time"
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${liveMessageEnabled ? 'text-green-400 bg-green-500/10' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/30'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${liveMessageEnabled ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
              Live
            </button>
          </div>
        </div>
      </div>

      {/* Input area */}
      <div id="input-area" className="p-3 border-t border-gray-700/50 shrink-0">
        {/* Reply preview */}
        {replyingTo && (
          <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-xl border-l-2 border-blue-400/60" style={{ backgroundColor: '#0d1117' }}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-blue-400 truncate">{replyingTo.userName}</p>
              <p className="text-xs text-gray-500 truncate">{replyingTo.content || (replyingTo.imageData ? '📷 Photo' : replyingTo.videoData ? '🎦 Video' : '…')}</p>
            </div>
            <button onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="text-gray-500 hover:text-gray-300 p-0.5 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
            </button>
          </div>
        )}
        {/* Pending image preview */}
        {pendingImage && (
          <div className="mb-2 flex items-center gap-2 p-2 bg-[#0d1117] rounded-xl border border-gray-700/60">
            <img src={pendingImage} alt="preview" className="h-14 w-14 object-cover rounded-lg shrink-0" />
            <span className="flex-1 text-xs text-gray-500">Image ready to send</span>
            <button
              onClick={() => setPendingImage(null)}
              aria-label="Remove image"
              className="text-gray-500 hover:text-red-400 transition-colors p-0.5 shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
              </svg>
            </button>
          </div>
        )}
        {/* Pending video preview — visible while reading from disk, while sending, and while ready */}
        {(pendingVideo || loadingVideo) && (
          <div className="mb-2 flex items-center gap-2 p-2 bg-[#0d1117] rounded-xl border border-gray-700/60">
            {pendingVideo
              ? <video src={pendingVideo} className="h-14 w-20 object-cover rounded-lg shrink-0" muted preload="metadata" />
              : <div className="h-14 w-20 rounded-lg shrink-0 bg-gray-800 flex items-center justify-center text-xs text-gray-500">{uploadProgress}%</div>
            }
            <div className="flex-1 min-w-0">
              {loadingVideo
                ? (
                  <div className="space-y-1">
                    <span className="text-xs text-gray-400">Reading video… {uploadProgress}%</span>
                    <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                )
                : isSendingVideo
                  ? (
                    <div className="space-y-1">
                      <span className="text-xs text-gray-400">Sending… {videoSendProgress}%</span>
                      <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${videoSendProgress}%` }} />
                      </div>
                    </div>
                  )
                  : <span className="text-xs text-gray-500">Video ready to send</span>
              }
            </div>
            <button
              onClick={() => { setPendingVideo(null); setUploadProgress(0) }}
              aria-label="Remove video"
              className="text-gray-500 hover:text-red-400 transition-colors p-0.5 shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
              </svg>
            </button>
          </div>
        )}

        <div className="flex gap-2 items-center">
          {/* Hidden file input — triggers native camera/gallery on mobile */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,.mov"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Image / video upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={mediaLoading || isAngryBirdLockedOut}
            title="Upload image or video"
            aria-label="Upload image or video"
            className="p-2.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors shrink-0"
          >
            {mediaLoading ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 16 16" className="animate-spin">
                <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 16 16">
                <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
                <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/>
              </svg>
            )}
          </button>

          <input
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); if (liveMessageEnabled) onLiveMessage?.(e.target.value) }}
            onKeyDown={handleKeyDown}
            disabled={isAngryBirdLockedOut}
            placeholder={isAngryBirdLockedOut ? 'AngryBird is active' : 'Message… 😊 or attach a photo/video'}
            inputMode="text"
            autoComplete="off"
            className="flex-1 px-3 py-2.5 bg-[#0d1117] text-white rounded-full text-sm focus:outline-none placeholder-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          />

          <button
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="p-2.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-black rounded-xl transition-colors shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 16 16">
              <path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576zm6.787-8.201L1.591 6.602l4.339 2.76z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
