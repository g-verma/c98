export interface ChatMessage {
  id: string
  userId: string
  userName: string
  content: string
  imageData?: string  // base64 data URL for image attachments
  videoData?: string  // base64 data URL for video attachments
  expiresAt?: number  // unix ms timestamp when this message auto-deletes
  editedAt?: number   // set when the sender edits the message
  seenBy?: string[]   // socket IDs of users (other than sender) who have seen this
  reactions?: Record<string, string[]>  // emoji → userIds who reacted
  replyTo?: { id: string; userName: string; content: string }
  timestamp: number
  type: 'message' | 'system'
}

export interface RoomState {
  code: string
  language: string
  messages: ChatMessage[]
  roomName?: string
  disappearAfter?: number | null
}

export interface LanguageOption {
  id: string
  name: string
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: 'javascript', name: 'JavaScript' },
  { id: 'typescript', name: 'TypeScript' },
  { id: 'python', name: 'Python' },
  { id: 'html', name: 'HTML' },
  { id: 'css', name: 'CSS' },
  { id: 'plaintext', name: 'Plain Text' },
]
