import { Server as NetServer } from 'http'
import { NextApiRequest, NextApiResponse } from 'next'
import { Server as SocketIOServer } from 'socket.io'
import type { ChatMessage, RoomState } from '@/types'

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
}

// Persist rooms across hot reloads in development
const globalRef = global as typeof global & { rooms?: Map<string, Room> }
if (!globalRef.rooms) globalRef.rooms = new Map<string, Room>()
const rooms = globalRef.rooms

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
      const videoUploads = new Map<string, { chunks: Map<number, string>; total: number; meta: { roomId: string; content: string; imageData?: string } }>()

      socket.on('join-room', ({ roomId, name, password, roomName }: { roomId: string; name: string; password?: string; roomName?: string }) => {
        if (!rooms.has(roomId)) {
          // First user creates the room; optionally locks it with a password
          rooms.set(roomId, { code: '', language: 'javascript', messages: [], users: new Map(), password: password || undefined, name: roomName || undefined })
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

        const state: RoomState = { code: room.code, language: room.language, messages: room.messages, roomName: room.name, disappearAfter: room.disappearAfter ?? null }
        socket.emit('room-state', state)
        io.to(roomId).emit('user-count', room.users.size)
      })

      socket.on('code-change', ({ roomId, code }: { roomId: string; code: string }) => {
        const room = rooms.get(roomId)
        if (room) {
          room.code = code
          socket.to(roomId).emit('code-update', code)
        }
      })

      socket.on('language-change', ({ roomId, language }: { roomId: string; language: string }) => {
        const room = rooms.get(roomId)
        if (room) {
          room.language = language
          io.to(roomId).emit('language-update', language)
        }
      })

      socket.on('clear-code', ({ roomId }: { roomId: string }) => {
        const room = rooms.get(roomId)
        if (room) {
          room.code = ''
          io.to(roomId).emit('code-update', '')
          // Also send directly in case socket hasn't joined room yet after reconnect
          socket.emit('code-update', '')
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
        }
      })

      // Receives one chunk; acks so the client sends the next
      socket.on('video-chunk', (
        { uploadId, chunkIndex, totalChunks, data, roomId, content, imageData }:
          { uploadId: string; chunkIndex: number; totalChunks: number; data: string; roomId: string; content?: string; imageData?: string },
        ack: () => void,
      ) => {
        if (!videoUploads.has(uploadId)) {
          videoUploads.set(uploadId, { chunks: new Map(), total: totalChunks, meta: { roomId, content: content ?? '', imageData } })
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

      socket.on('send-message', ({ roomId, content, imageData, videoData }: { roomId: string; content: string; imageData?: string; videoData?: string }) => {
        const room = rooms.get(roomId)
        if (room && currentUser) {
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
            timestamp: Date.now(),
            type: 'message',
          }
          room.messages.push(msg)
          if (room.messages.length > 100) room.messages = room.messages.slice(-100)
          io.to(roomId).emit('chat-message', msg)
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
        socket.to(roomId).emit('live-message', { userId: socket.id, userName: currentUser ?? '', text })
      })

      socket.on('disconnect', () => {
        videoUploads.clear()
        if (currentRoom) {
          const room = rooms.get(currentRoom)
          if (room) {
            room.users.delete(socket.id)
            io.to(currentRoom).emit('user-count', room.users.size)
          }
          socket.to(currentRoom).emit('live-message', { userId: socket.id, userName: currentUser ?? '', text: '' })
        }
      })
    })
  }

  res.end()
}
