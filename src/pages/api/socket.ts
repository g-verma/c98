import { Server as NetServer } from 'http'
import { NextApiRequest, NextApiResponse } from 'next'
import { Server as SocketIOServer } from 'socket.io'
import type { ChatMessage, RoomState } from '@/types'
import { saveRoom, loadRoom, saveActivity, loadActivity, saveLastActive, loadLastActive } from '@/lib/redis'

type NextApiResponseServerIO = NextApiResponse & {
  socket: {
    server: NetServer & {
      io?: SocketIOServer
    }
  }
}

interface Room {
  code: string
  language: string
  messages: ChatMessage[]
  users: Map<string, string>
  password?: string  // undefined means no password required
  name?: string      // optional display name
  disappearAfter?: number  // ms; undefined = off
  angryBirdOwnerId?: string
  activities: Record<string, { first: number; last: number }>
  activityDate: string
  lastActive?: number
}

// Persist rooms across hot reloads in development
const globalRef = global as typeof global & { rooms?: Map<string, Room> }
if (!globalRef.rooms) globalRef.rooms = new Map<string, Room>()
const rooms = globalRef.rooms

// Per-room debounce timers for code-change Redis writes (max once per 5 s)
const codeSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const activitySaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const config = {
  api: { bodyParser: false },
}

export default function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
  if (!res.socket.server.io) {
    const io = new SocketIOServer(res.socket.server, {
      path: '/api/socket',
      addTrailingSlash: false,
      maxHttpBufferSize: 50 * 1024 * 1024, // 50 MB — needed for video base64 payloads
    })
    res.socket.server.io = io

    io.on('connection', (socket) => {
      let currentRoom: string | null = null
      let currentUser: string | null = null

      // Accumulates in-flight chunked video uploads for this socket
      const videoUploads = new Map<string, { chunks: Map<number, string>; total: number; meta: { roomId: string; content: string; imageData?: string; replyTo?: { id: string; userName: string; content: string } } }>()

      socket.on('join-room', async ({ roomId, name, password, roomName, isNew }: { roomId: string; name: string; password?: string; roomName?: string; isNew?: boolean }) => {
        // Hydrate from Redis after a restart before checking password
        if (!rooms.has(roomId)) {
          const persisted = await loadRoom(roomId)
          if (persisted) {
            rooms.set(roomId, { code: persisted.code, language: persisted.language, messages: [], users: new Map(), password: persisted.password, name: persisted.name, disappearAfter: persisted.disappearAfter, activities: {}, activityDate: '' })
          }
        }

        if (!rooms.has(roomId)) {
          // Only allow room creation when the request comes from the landing page
          if (!isNew) {
            socket.emit('room-not-found')
            return
          }
          // First user creates the room; optionally locks it with a password
          rooms.set(roomId, { code: '', language: 'javascript', messages: [], users: new Map(), password: password || undefined, name: roomName || undefined, activities: {}, activityDate: '' })
          void saveRoom(roomId, { code: '', language: 'javascript', password: password || undefined, name: roomName || undefined })
        } else {
          const existing = rooms.get(roomId)!
          if (existing.password && existing.password !== password) {
            socket.emit('auth-error', 'Incorrect password')
            return
          }
        }

        currentRoom = roomId
        currentUser = name
        socket.join(roomId)

        const room = rooms.get(roomId)!
        room.users.set(socket.id, name)

        const todayDate = new Date().toISOString().slice(0, 10)
        if (!room.activityDate || room.activityDate !== todayDate) {
          const stored = await loadActivity(roomId, todayDate)
          room.activities = stored ?? {}
          room.activityDate = todayDate
        }
        const joinNow = Date.now()
        room.activities[name] = { first: room.activities[name]?.first ?? joinNow, last: joinNow }
        void saveActivity(roomId, todayDate, room.activities)
        socket.to(roomId).emit('activity-update', room.activities)

        if (!room.lastActive) {
          const storedLast = await loadLastActive(roomId)
          if (storedLast) room.lastActive = storedLast
        }

        const state: RoomState = { code: room.code, language: room.language, messages: room.messages, roomName: room.name, disappearAfter: room.disappearAfter ?? null, angryBirdOwnerId: room.angryBirdOwnerId ?? null, activities: room.activities, lastActive: room.lastActive }
        socket.emit('room-state', state)
        io.to(roomId).emit('user-count', room.users.size)
      })

      socket.on('code-change', ({ roomId, code }: { roomId: string; code: string }) => {
        const room = rooms.get(roomId)
        if (room) {
          room.code = code
          socket.to(roomId).emit('code-update', code)
          // debounced save — at most once every 5 s per room
          const existing = codeSaveTimers.get(roomId)
          if (existing) clearTimeout(existing)
          codeSaveTimers.set(roomId, setTimeout(() => {
            codeSaveTimers.delete(roomId)
            void saveRoom(roomId, { code: room.code, language: room.language, password: room.password, name: room.name, disappearAfter: room.disappearAfter })
          }, 5000))
        }
      })

      socket.on('language-change', ({ roomId, language }: { roomId: string; language: string }) => {
        const room = rooms.get(roomId)
        if (room) {
          room.language = language
          io.to(roomId).emit('language-update', language)
          void saveRoom(roomId, { code: room.code, language, password: room.password, name: room.name, disappearAfter: room.disappearAfter })
        }
      })

      socket.on('clear-code', ({ roomId }: { roomId: string }) => {
        const room = rooms.get(roomId)
        if (room) {
          room.code = ''
          io.to(roomId).emit('code-update', '')
          // Also send directly in case socket hasn't joined room yet after reconnect
          socket.emit('code-update', '')
          void saveRoom(roomId, { code: '', language: room.language, password: room.password, name: room.name, disappearAfter: room.disappearAfter })
        }
      })

      socket.on('clear-chat', ({ roomId }: { roomId: string }) => {
        const room = rooms.get(roomId)
        if (room) {
          const systemMsg: ChatMessage = {
            id: `${Date.now()}-system-${Math.random()}`,
            userId: socket.id,
            userName: currentUser ?? 'Someone',
            content: `${currentUser ?? 'Someone'}`,
            timestamp: Date.now(),
            type: 'system',
          }
          room.messages = [systemMsg]
          io.to(roomId).emit('chat-cleared', systemMsg)
          socket.emit('chat-cleared', systemMsg)
        }
      })

      socket.on('clear-all', ({ roomId }: { roomId: string }) => {
        const room = rooms.get(roomId)
        if (room) {
          const systemMsg: ChatMessage = {
            id: `${Date.now()}-system-${Math.random()}`,
            userId: socket.id,
            userName: currentUser ?? 'Someone',
            content: `${currentUser ?? 'Someone'}`,
            timestamp: Date.now(),
            type: 'system',
          }
          room.code = ''
          room.messages = [systemMsg]
          io.to(roomId).emit('code-update', '')
          io.to(roomId).emit('chat-cleared', systemMsg)
          // Also send directly in case socket hasn't joined room yet after reconnect
          socket.emit('code-update', '')
          socket.emit('chat-cleared', systemMsg)
          void saveRoom(roomId, { code: '', language: room.language, password: room.password, name: room.name, disappearAfter: room.disappearAfter })
        }
      })

      // Receives one chunk; acks so the client sends the next
      socket.on('video-chunk', (
        { uploadId, chunkIndex, totalChunks, data, roomId, content, imageData, replyTo }:
          { uploadId: string; chunkIndex: number; totalChunks: number; data: string; roomId: string; content?: string; imageData?: string; replyTo?: { id: string; userName: string; content: string } },
        ack: () => void,
      ) => {
        if (!videoUploads.has(uploadId)) {
          videoUploads.set(uploadId, { chunks: new Map(), total: totalChunks, meta: { roomId, content: content ?? '', imageData, replyTo } })
        }
        videoUploads.get(uploadId)!.chunks.set(chunkIndex, data)
        ack()
      })

      // Assembles chunks and broadcasts the message to the room
      socket.on('video-finalize', ({ uploadId }: { uploadId: string }, ack: () => void) => {
        const upload = videoUploads.get(uploadId)
        if (!upload || !currentUser) { ack(); return }
        videoUploads.delete(uploadId)

        const { chunks, total, meta } = upload
        const videoData = Array.from({ length: total }, (_, i) => chunks.get(i) ?? '').join('')
        const room = rooms.get(meta.roomId)
        if (room) {
          if (room.angryBirdOwnerId && room.angryBirdOwnerId !== socket.id) { ack(); return }
          const expiresAt = room.disappearAfter ? Date.now() + room.disappearAfter : undefined
          const msg: ChatMessage = {
            id: `${Date.now()}-${socket.id}-${Math.random()}`,
            userId: socket.id,
            userName: currentUser,
            content: meta.content,
            imageData: meta.imageData,
            videoData,
            expiresAt,
            seenBy: [],
            replyTo: meta.replyTo,
            timestamp: Date.now(),
            type: 'message',
          }
          room.messages.push(msg)
          if (room.messages.length > 100) room.messages = room.messages.slice(-100)
          io.to(meta.roomId).emit('chat-message', msg)
          if (expiresAt && room.disappearAfter) {
            const delay = room.disappearAfter
            const msgId = msg.id
            setTimeout(() => {
              const r = rooms.get(meta.roomId)
              if (r) {
                r.messages = r.messages.filter((m) => m.id !== msgId)
                io.to(meta.roomId).emit('message-disappeared', msgId)
              }
            }, delay)
          }
        }
        ack()
      })

      socket.on('send-message', ({ roomId, content, imageData, videoData, replyTo }: { roomId: string; content: string; imageData?: string; videoData?: string; replyTo?: { id: string; userName: string; content: string } }) => {
        const room = rooms.get(roomId)
        if (room && currentUser) {
          if (room.angryBirdOwnerId && room.angryBirdOwnerId !== socket.id) return
          const expiresAt = room.disappearAfter ? Date.now() + room.disappearAfter : undefined
          const msg: ChatMessage = {
            id: `${Date.now()}-${socket.id}-${Math.random()}`,
            userId: socket.id,
            userName: currentUser,
            content,
            imageData,
            videoData,
            expiresAt,
            seenBy: [],
            replyTo,
            timestamp: Date.now(),
            type: 'message',
          }
          room.messages.push(msg)
          if (room.messages.length > 100) room.messages = room.messages.slice(-100)
          io.to(roomId).emit('chat-message', msg)
          room.lastActive = msg.timestamp
          if (room.activityDate) {
            room.activities[currentUser] = { first: room.activities[currentUser]?.first ?? msg.timestamp, last: msg.timestamp }
            const t = activitySaveTimers.get(roomId)
            if (t) clearTimeout(t)
            activitySaveTimers.set(roomId, setTimeout(() => {
              activitySaveTimers.delete(roomId)
              void saveActivity(roomId, room.activityDate, room.activities)
              if (room.lastActive) void saveLastActive(roomId, room.lastActive)
            }, 30_000))
          }
          // Schedule server-side auto-deletion when disappearing messages is on
          if (expiresAt && room.disappearAfter) {
            const delay = room.disappearAfter
            const msgId = msg.id
            setTimeout(() => {
              const r = rooms.get(roomId)
              if (r) {
                r.messages = r.messages.filter((m) => m.id !== msgId)
                io.to(roomId).emit('message-disappeared', msgId)
              }
            }, delay)
          }
        }
      })

      socket.on('set-disappear', ({ roomId, duration }: { roomId: string; duration: number | null }) => {
        const room = rooms.get(roomId)
        if (room) {
          room.disappearAfter = duration ?? undefined
          io.to(roomId).emit('disappear-setting', duration)
          void saveRoom(roomId, { code: room.code, language: room.language, password: room.password, name: room.name, disappearAfter: room.disappearAfter })
        }
      })

      socket.on('delete-message', ({ roomId, messageId }: { roomId: string; messageId: string }) => {
        const room = rooms.get(roomId)
        if (room) {
          room.messages = room.messages.filter((m) => m.id !== messageId)
          io.to(roomId).emit('message-deleted', messageId)
        }
      })

      socket.on('edit-message', ({ roomId, messageId, newContent }: { roomId: string; messageId: string; newContent: string }) => {
        const room = rooms.get(roomId)
        const msg = room?.messages.find((m) => m.id === messageId)
        if (msg) {
          msg.content = newContent
          msg.editedAt = Date.now()
          io.to(roomId).emit('message-edited', { messageId, newContent, editedAt: msg.editedAt })
        }
      })

      socket.on('mark-seen', ({ roomId, messageIds }: { roomId: string; messageIds: string[] }) => {
        const room = rooms.get(roomId)
        if (!room) return
        const updated: string[] = []
        for (const id of messageIds) {
          const msg = room.messages.find((m) => m.id === id)
          if (msg) {
            if (!msg.seenBy) msg.seenBy = []
            if (!msg.seenBy.includes(socket.id)) {
              msg.seenBy.push(socket.id)
              updated.push(id)
            }
          }
        }
        if (updated.length > 0) {
          io.to(roomId).emit('messages-seen', { messageIds: updated, byUserId: socket.id })
        }
      })

      socket.on('add-reaction', ({ roomId, messageId, emoji }: { roomId: string; messageId: string; emoji: string }) => {
        const room = rooms.get(roomId)
        const msg = room?.messages.find((m) => m.id === messageId)
        if (msg) {
          if (!msg.reactions) msg.reactions = {}
          const users = msg.reactions[emoji] ?? []
          const idx = users.indexOf(socket.id)
          if (idx === -1) users.push(socket.id); else users.splice(idx, 1)
          if (users.length === 0) delete msg.reactions[emoji]; else msg.reactions[emoji] = users
          io.to(roomId).emit('reaction-added', { messageId, reactions: msg.reactions })
        }
      })
      
      socket.on('live-message', ({ roomId, text }: { roomId: string; text: string }) => {
        const room = rooms.get(roomId)
        if (room?.angryBirdOwnerId && room.angryBirdOwnerId !== socket.id) return
        socket.to(roomId).emit('live-message', { userId: socket.id, userName: currentUser ?? '', text })
      })

      socket.on('poke', ({ roomId }: { roomId: string }) => {
        io.to(roomId).emit('poke')
      })

      socket.on('angrybird', ({ roomId }: { roomId: string }) => {
        const room = rooms.get(roomId)
        if (!room) return
        if (room.angryBirdOwnerId && room.angryBirdOwnerId !== socket.id) return
        room.angryBirdOwnerId = room.angryBirdOwnerId ? undefined : socket.id
        io.to(roomId).emit('angrybird', { ownerId: room.angryBirdOwnerId ?? null })
      })

      socket.on('sink', ({ roomId }: { roomId: string }) => {
        io.to(roomId).emit('sink')
      })

      socket.on('rename-user', ({ name }: { name: string }) => {
        const oldName = currentUser
        currentUser = name
        if (currentRoom) {
          const room = rooms.get(currentRoom)
          if (room) {
            room.users.set(socket.id, name)
            room.messages.forEach((m) => { if (m.userId === socket.id) m.userName = name })
            if (oldName && oldName !== name && room.activities[oldName] && room.activityDate) {
              room.activities[name] = room.activities[oldName]
              delete room.activities[oldName]
              void saveActivity(currentRoom, room.activityDate, room.activities)
              io.to(currentRoom).emit('activity-update', room.activities)
            }
          }
          io.to(currentRoom).emit('user-renamed', { userId: socket.id, newName: name })
        }
      })

      socket.on('change-password', ({ roomId, newPassword }: { roomId: string; newPassword: string }) => {
        const room = rooms.get(roomId)
        if (!room) return
        room.password = newPassword || undefined
        void saveRoom(roomId, { code: room.code, language: room.language, password: room.password, name: room.name, disappearAfter: room.disappearAfter })
        socket.emit('password-changed', { newPassword })
      })

      socket.on('reaction', ({ roomId, emoji }: { roomId: string; emoji: string }) => {
        io.to(roomId).emit('reaction', { emoji })
      })

      socket.on('disconnect', () => {
        videoUploads.clear()
        if (currentRoom) {
          const room = rooms.get(currentRoom)
          if (room) {
            room.users.delete(socket.id)
            if (room.angryBirdOwnerId === socket.id) {
              room.angryBirdOwnerId = undefined
              io.to(currentRoom).emit('angrybird', { ownerId: null })
            }
            io.to(currentRoom).emit('user-count', room.users.size)
            if (currentUser && room.activityDate) {
              room.activities[currentUser] = { first: room.activities[currentUser]?.first ?? Date.now(), last: Date.now() }
              void saveActivity(currentRoom, room.activityDate, room.activities)
              socket.to(currentRoom).emit('activity-update', room.activities)
            }
          }
          socket.to(currentRoom).emit('live-message', { userId: socket.id, userName: currentUser ?? '', text: '' })
        }
      })
    })
  }

  res.end()
}
