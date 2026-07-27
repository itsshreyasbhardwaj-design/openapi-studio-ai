import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "osa.v1";

function key(): Buffer {
  const secret = env().ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_KEY is not configured. Secrets cannot be encrypted at rest — " +
        "set ENCRYPTION_KEY (32+ chars) before storing credentials.",
    );
  }
  // Derive a fixed-length key so operators can supply any sufficiently long secret.
  return createHash("sha256").update(secret).digest();
}

export function isEncryptionAvailable(): boolean {
  return Boolean(env().ENCRYPTION_KEY);
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Format: `osa.v1.<iv-b64>.<tag-b64>.<ciphertext-b64>`
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${PREFIX}.`) && value.split(".").length === 5;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  const [prefixA, prefixB, ivPart, tagPart, dataPart] = parts;
  if (
    parts.length !== 5 ||
    `${prefixA}.${prefixB}` !== PREFIX ||
    !ivPart ||
    !tagPart ||
    !dataPart
  ) {
    throw new Error("Malformed encrypted payload.");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Constant-time string comparison for tokens and signatures. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Stable content hash used for spec versioning and cache keys. */
export function contentHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 40);
}
