/**
 * Cookie-based sessions backed by KV.
 *
 *   session:{sessionId} -> connectionId  (TTL 30 days)
 *
 * The session id is an opaque random token stored in an HttpOnly cookie; the
 * mapping to a connection lives server-side in KV.
 */

import { randomId } from "../crypto.js";

const SESSION_PREFIX = "session:";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_COOKIE = "ncx_session";

export class SessionStore {
  constructor(private readonly kv: KVNamespace) {}

  async create(connectionId: string): Promise<string> {
    const sessionId = randomId(24);
    await this.kv.put(SESSION_PREFIX + sessionId, connectionId, {
      expirationTtl: SESSION_TTL_SECONDS,
    });
    return sessionId;
  }

  async getConnectionId(sessionId: string): Promise<string | null> {
    return this.kv.get(SESSION_PREFIX + sessionId);
  }

  async destroy(sessionId: string): Promise<void> {
    await this.kv.delete(SESSION_PREFIX + sessionId);
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function cookieHeader(
  name: string,
  value: string,
  opts: { maxAge?: number } = {},
): string {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];
  if (opts.maxAge !== undefined) attrs.push(`Max-Age=${opts.maxAge}`);
  return attrs.join("; ");
}
