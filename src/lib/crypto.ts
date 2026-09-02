import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

// Derive a 32-byte key from whatever secret is configured, so any passphrase length works
function getKey(): Buffer | null {
  const secret = process.env.DATA_ENCRYPTION_KEY
  if (!secret) return null
  return crypto.createHash('sha256').update(secret).digest()
}

// Encrypts plaintext for storage; returns null when no encryption key is configured
export function encryptText(plain: string): string | null {
  const key = getKey()
  if (!key) return null
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

// Decrypts a payload produced by encryptText; returns null on missing key or tamper/format errors
export function decryptText(payload: string | null | undefined): string | null {
  const key = getKey()
  if (!key || !payload) return null
  try {
    const raw = Buffer.from(payload, 'base64')
    const iv = raw.subarray(0, IV_LENGTH)
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH)
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plain.toString('utf8')
  } catch {
    return null
  }
}
