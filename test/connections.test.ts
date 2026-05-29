import { describe, it, expect, beforeEach } from "vitest";
import {
  ConnectionStore,
  connectionToConfig,
  newConnection,
} from "../src/store/connections.js";

function memoryKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix }: { prefix?: string } = {}) {
      const keys = [...store.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  } as unknown as KVNamespace;
}

describe("ConnectionStore", () => {
  let store: ConnectionStore;
  beforeEach(() => {
    store = new ConnectionStore(memoryKV(), "enc-secret");
  });

  it("encrypts at rest and round-trips a connection", async () => {
    const conn = newConnection(123, "alice", "oauth_tok");
    conn.listId = "L1";
    await store.put(conn);

    const loaded = await store.get(conn.connectionId);
    expect(loaded?.clickupToken).toBe("oauth_tok");
    expect(loaded?.listId).toBe("L1");
    expect(await store.byUser(123)).toMatchObject({ connectionId: conn.connectionId });
  });

  it("upsert reuses the same record on re-login", async () => {
    const first = await store.upsertFromOAuth(7, "bob", "tok1");
    const second = await store.upsertFromOAuth(7, "bob", "tok2");
    expect(second.connectionId).toBe(first.connectionId);
    expect(second.clickupToken).toBe("tok2");
    expect(await store.list()).toHaveLength(1);
  });

  it("lists all connections", async () => {
    await store.upsertFromOAuth(1, "a", "t");
    await store.upsertFromOAuth(2, "b", "t");
    expect(await store.list()).toHaveLength(2);
  });

  it("maps a connection to the dispatcher Config shape", () => {
    const conn = newConnection(1, "a", "tok");
    conn.frcTeamNumber = " 254 ";
    conn.listId = "L";
    conn.channelId = "C";
    conn.workspaceId = "W";
    conn.enablePoll = true;
    const cfg = connectionToConfig(conn);
    expect(cfg.frcTeamNumber).toBe("254");
    expect(cfg.clickup).toEqual({ token: "tok", listId: "L", workspaceId: "W", channelId: "C" });
    expect(cfg.enablePollBackup).toBe(true);
    expect(cfg.dryRun).toBe(false);
  });
});
