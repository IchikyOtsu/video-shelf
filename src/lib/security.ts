import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const createOpaqueToken = () => randomBytes(32).toString("base64url");
export const tokenUsable = (expiresAt: Date, usedAt: Date | null, now = new Date()) => !usedAt && expiresAt > now;
export const generateTotpSecret = () => {
  const bytes = randomBytes(20); let output = ""; let value = 0; let bits = 0;
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += base32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  return output;
};
function decodeBase32(input: string) { let value = 0; let bits = 0; const out: number[] = []; for (const char of input.replace(/\s/g, "").toUpperCase()) { const part = base32.indexOf(char); if (part < 0) throw new Error("Invalid TOTP secret"); value = (value << 5) | part; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
export function totpCode(secret: string, now = Date.now()) { const counter = Math.floor(now / 30_000); const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(counter)); return createHmac("sha1", decodeBase32(secret)).update(bytes).digest(); }
export function formatTotp(secret: string, now = Date.now()) { const digest: Buffer = totpCode(secret, now); const offset = digest[digest.length - 1] & 15; return String(((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)).padStart(6, "0"); }
export function verifyTotp(secret: string, code: string, now = Date.now()) { return [-30_000, 0, 30_000].some((offset) => { const candidate = formatTotp(secret, now + offset); return code.length === candidate.length && timingSafeEqual(Buffer.from(code), Buffer.from(candidate)); }); }
export const otpAuthUrl = (email: string, secret: string) => `otpauth://totp/Video%20Shelf:${encodeURIComponent(email)}?secret=${secret}&issuer=Video%20Shelf&algorithm=SHA1&digits=6&period=30`;
function encryptionKey() { const raw = process.env.TOTP_ENCRYPTION_KEY; if (!raw) throw new Error("TOTP_ENCRYPTION_KEY is required to manage two-factor authentication."); const key = Buffer.from(raw, "base64"); if (key.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key."); return key; }
export function encryptTotp(secret: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`; }
export function decryptTotp(payload: string) { const [iv, tag, data] = payload.split("."); if (!iv || !tag || !data) throw new Error("Invalid encrypted TOTP secret."); const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"); }
export function recoveryCode() { return `${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}`.toUpperCase(); }
export const hashRecoveryCode = (code: string) => tokenHash(code.replace(/\s/g, "").toUpperCase());
