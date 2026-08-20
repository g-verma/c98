const ADJECTIVES = [
  'Happy', 'Clever', 'Swift', 'Brave', 'Calm', 'Bright', 'Bold', 'Cool',
  'Dark', 'Epic', 'Wise', 'Quick', 'Smart', 'Ace', 'Chill', 'Rad',
]
const NOUNS = [
  'Coder', 'Panda', 'Fox', 'Hawk', 'Wolf', 'Bear', 'Tiger', 'Eagle',
  'Owl', 'Dev', 'Hacker', 'Ninja', 'Wizard', 'Guru', 'Pixel', 'Byte',
]

export function generateId(length = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export function slugifyRoomName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

export function generateUserName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj} ${noun}`
}

const USER_COLORS = [
  '#60a5fa', '#34d399', '#f472b6', '#fb923c',
  '#a78bfa', '#facc15', '#22d3ee', '#f87171',
]

export function getUserColor(userId: string): string {
  const hash = userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return USER_COLORS[hash % USER_COLORS.length]
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
