/**
 * Small crypto helpers built on Web Crypto (available in Workers).
 *
 * - `encryptJson` / `decryptJson`: AES-GCM at-rest encryption for stored
 *   credentials, keyed by the `ENCRYPTION_KEY` secret. So a KV dump alone never
 *   exposes OAuth tokens or API keys.
 * - `randomId` / `randomToken`: unguessable ids for connections, sessions, and
 *   per-connection webhook tokens.
 */

const VERSION = "v1";

async function importKey(secret: string): Promise<CryptoKey> {
  // Derive a stable 256-bit key from the secret via SHA-256 so the secret can
  // be any length while AES-GCM gets exactly 32 bytes.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptJson(value: unknown, secret: string): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${VERSION}.${toB64(iv)}.${toB64(new Uint8Array(ciphertext))}`;
}

export async function decryptJson<T>(blob: string, secret: string): Promise<T> {
  const [version, ivB64, dataB64] = blob.split(".");
  if (version !== VERSION || !ivB64 || !dataB64) {
    throw new Error("malformed ciphertext");
  }
  const key = await importKey(secret);
  const iv = fromB64(ivB64);
  const data = fromB64(dataB64);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export function randomId(bytes = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Longer, URL-safe token for webhook secrets. */
export function randomToken(bytes = 24): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
