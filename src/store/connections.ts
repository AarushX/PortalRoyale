/**
 * Per-user Connection records: the multi-tenant replacement for env config.
 *
 * Each record holds a user's ClickUp OAuth token, their chosen List/channel,
 * FRC team number, optional TBA/Nexus keys, a per-connection webhook token, and
 * feature toggles. Records are stored AES-GCM encrypted in KV so a KV dump
 * alone never exposes credentials.
 *
 *   conn:{connectionId}      -> encrypted Connection JSON
 *   useridx:{clickupUserId}  -> connectionId  (so re-login updates one record)
 */

import type { Config } from "../env.js";
import { encryptJson, decryptJson, randomId, randomToken } from "../crypto.js";

export interface Connection {
  connectionId: string;
  clickupUserId: number;
  clickupUsername: string;
  clickupToken: string;
  workspaceId: string;
  listId: string;
  channelId: string;
  frcTeamNumber: string;
  seasonYear: number;
  tbaApiKey?: string;
  nexusApiKey?: string;
  webhookToken: string;
  enableTasks: boolean;
  enableChannel: boolean;
  syncMatches: boolean;
  syncAnnouncements: boolean;
  syncParts: boolean;
  matchTasks: boolean;
  enablePoll: boolean;
  createdAt: number;
  updatedAt: number;
}

const CONN_PREFIX = "conn:";
const USERIDX_PREFIX = "useridx:";

export class ConnectionStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly encryptionKey: string,
  ) {}

  async get(connectionId: string): Promise<Connection | null> {
    const blob = await this.kv.get(CONN_PREFIX + connectionId);
    if (!blob) return null;
    try {
      return await decryptJson<Connection>(blob, this.encryptionKey);
    } catch {
      return null;
    }
  }

  async byUser(clickupUserId: number): Promise<Connection | null> {
    const id = await this.kv.get(USERIDX_PREFIX + clickupUserId);
    return id ? this.get(id) : null;
  }

  async put(conn: Connection): Promise<void> {
    conn.updatedAt = Date.now();
    const blob = await encryptJson(conn, this.encryptionKey);
    await this.kv.put(CONN_PREFIX + conn.connectionId, blob);
    await this.kv.put(USERIDX_PREFIX + conn.clickupUserId, conn.connectionId);
  }

  async list(): Promise<Connection[]> {
    const out: Connection[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: CONN_PREFIX, cursor });
      for (const k of page.keys) {
        const conn = await this.get(k.name.slice(CONN_PREFIX.length));
        if (conn) out.push(conn);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
  }

  /** Find a user's existing connection or build a fresh one after OAuth. */
  async upsertFromOAuth(
    clickupUserId: number,
    username: string,
    token: string,
  ): Promise<Connection> {
    const existing = await this.byUser(clickupUserId);
    if (existing) {
      existing.clickupToken = token;
      existing.clickupUsername = username;
      await this.put(existing);
      return existing;
    }
    const conn = newConnection(clickupUserId, username, token);
    await this.put(conn);
    return conn;
  }
}

export function newConnection(
  clickupUserId: number,
  username: string,
  token: string,
): Connection {
  const now = Date.now();
  return {
    connectionId: randomId(),
    clickupUserId,
    clickupUsername: username,
    clickupToken: token,
    workspaceId: "",
    listId: "",
    channelId: "",
    frcTeamNumber: "",
    seasonYear: new Date().getUTCFullYear(),
    webhookToken: randomToken(),
    enableTasks: true,
    enableChannel: true,
    syncMatches: true,
    syncAnnouncements: true,
    syncParts: true,
    matchTasks: false,
    enablePoll: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Adapt a Connection to the `Config` shape the Dispatcher already consumes. */
export function connectionToConfig(conn: Connection): Config {
  return {
    nexusEventKey: "",
    frcTeamNumber: conn.frcTeamNumber.trim(),
    seasonYear: conn.seasonYear,
    clickup: {
      token: conn.clickupToken,
      listId: conn.listId,
      workspaceId: conn.workspaceId,
      channelId: conn.channelId,
    },
    enableTasks: conn.enableTasks,
    enableChannel: conn.enableChannel,
    syncMatches: conn.syncMatches,
    syncAnnouncements: conn.syncAnnouncements,
    syncParts: conn.syncParts,
    matchTasks: conn.matchTasks,
    dryRun: false,
    enablePollBackup: conn.enablePoll,
  };
}
