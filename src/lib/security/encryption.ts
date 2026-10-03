import crypto from 'crypto';

// Master key for field-level encryption (32 bytes for AES-256-GCM)
// In production, loaded securely from environment / vault. Default fallback for testing/dev.
const ENCRYPTION_KEY = process.env.PII_ENCRYPTION_KEY
  ? Buffer.from(process.env.PII_ENCRYPTION_KEY, 'hex')
  : crypto.createHash('sha256').update('vericlaim-default-secure-pii-key-2026').digest();

const BLIND_INDEX_KEY = process.env.PII_BLIND_INDEX_KEY
  ? Buffer.from(process.env.PII_BLIND_INDEX_KEY, 'hex')
  : crypto.createHash('sha256').update('vericlaim-default-blind-index-key-2026').digest();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM

export interface EncryptedFieldPayload {
  ciphertext: string; // Format: "iv:authTag:encryptedData" in hex
}

/**
 * Encrypts sensitive PII plaintext using AES-256-GCM.
 * The resulting ciphertext is completely unreadable in raw SQL.
 */
export function encryptField(plaintext: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  // Packed string: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM ciphertext.
 */
export function decryptField(encryptedPayload: string): string {
  if (!encryptedPayload) return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format. Expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generates an HMAC-SHA256 blind index for searchable identifiers (PAN, Aadhaar).
 * Allows exact lookup in raw SQL without storing or searching plaintext.
 */
export function computeBlindIndex(plaintext: string): string {
  if (!plaintext) return '';
  const normalized = plaintext.trim().toUpperCase().replace(/[\s-]/g, '');
  return crypto.createHmac('sha256', BLIND_INDEX_KEY).update(normalized).digest('hex');
}

/**
 * Masks PAN for display: ABCDE1234F -> XXXXX1234F
 */
export function maskPan(pan: string): string {
  if (!pan || pan.length < 5) return 'XXXXX';
  const clean = pan.trim().toUpperCase();
  if (clean.length === 10) {
    return `XXXXX${clean.substring(5, 9)}${clean[9]}`;
  }
  return `XXXXX${clean.slice(-4)}`;
}

/**
 * Masks Bank Account number for display: 123456789012 -> XXXXXXXX9012
 */
export function maskBankAccount(accountNo: string): string {
  if (!accountNo || accountNo.length < 4) return 'XXXX';
  const clean = accountNo.trim();
  const last4 = clean.slice(-4);
  const maskedLength = Math.max(clean.length - 4, 4);
  return 'X'.repeat(maskedLength) + last4;
}
