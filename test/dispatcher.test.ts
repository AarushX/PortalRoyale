import { describe, it, expect, beforeEach } from "vitest";
import { Dispatcher } from "../src/sync/dispatcher.js";
import { SyncState } from "../src/sync/state.js";
import type { Config } from "../src/env.js";
import type { CreateTaskInput, ClickUpClient } from "../src/clickup/client.js";
import { normalize } from "../src/nexus/normalize.js";

/** Minimal in-memory KVNamespace good enough for SyncState. */
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
  } as unknown as KVNamespace;
}

/** Records calls so assertions can inspect what was sent to ClickUp. */
function fakeClickUp() {
  const calls = {
    tasks: [] as CreateTaskInput[],
    statusUpdates: [] as { taskId: string; status: string }[],
    messages: [] as string[],
  };
  let taskSeq = 0;
  const client = {
    async createTask(input: CreateTaskInput) {
      calls.tasks.push(input);
      return { id: `task_${++taskSeq}` };
    },
    async updateTaskStatus(taskId: string, status: string) {
      calls.statusUpdates.push({ taskId, status });
    },
    async sendChannelMessage(_ws: string, _ch: string, content: string) {
      calls.messages.push(content);
    },
  } as unknown as ClickUpClient;
  return { client, calls };
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    nexusEventKey: "2024nyro",
    frcTeamNumber: "",
    seasonYear: 2026,
    clickup: { token: "pk_test", listId: "L1", workspaceId: "W1", channelId: "C1" },
    enableTasks: true,
    enableChannel: true,
    syncMatches: true,
    syncAnnouncements: true,
    syncParts: true,
    matchTasks: false,
    dryRun: false,
    enablePollBackup: false,
    ...overrides,
  };
}

describe("Dispatcher", () => {
  let state: SyncState;
  beforeEach(() => {
    state = new SyncState(memoryKV());
  });

  it("creates a task and a channel message for a new parts request", async () => {
    const { client, calls } = fakeClickUp();
    const d = new Dispatcher(config(), client, state);

    const result = await d.dispatch(
      normalize({ partsRequest: { id: "p1", parts: "120T pulley", requestedByTeam: "456" } }),
    );

    expect(result.processed).toBe(1);
    expect(calls.tasks).toHaveLength(1);
    expect(calls.tasks[0].name).toContain("Team 456");
    expect(calls.tasks[0].tags).toContain("parts-request");
    expect(calls.messages[0]).toContain("Parts request");
  });

  it("closes the task when a parts request is resolved", async () => {
    const { client, calls } = fakeClickUp();
    const d = new Dispatcher(config(), client, state);

    await d.dispatch(normalize({ partsRequest: { id: "p1", parts: "battery" } }));
    await d.dispatch(
      normalize({ partsRequest: { id: "p1", parts: "battery", outstanding: false } }),
    );

    expect(calls.tasks).toHaveLength(1);
    expect(calls.statusUpdates).toEqual([{ taskId: "task_1", status: "complete" }]);
    expect(calls.messages.some((m) => m.includes("resolved"))).toBe(true);
  });

  it("dedupes repeated events by dedupeKey", async () => {
    const { client, calls } = fakeClickUp();
    const d = new Dispatcher(config(), client, state);
    const payload = { match: { label: "Qualification 5", status: "On field" } };

    await d.dispatch(normalize(payload));
    const second = await d.dispatch(normalize(payload));

    expect(second.skipped).toBe(1);
    expect(calls.messages).toHaveLength(1);
  });

  it("respects feature toggles", async () => {
    const { client, calls } = fakeClickUp();
    const d = new Dispatcher(
      config({ enableTasks: false, syncMatches: false }),
      client,
      state,
    );

    await d.dispatch(
      normalize({
        match: { label: "Q1", status: "On field" },
        partsRequest: { id: "p1", parts: "wheel" },
      }),
    );

    expect(calls.tasks).toHaveLength(0); // tasks disabled
    expect(calls.messages.some((m) => m.includes("Q1"))).toBe(false); // matches disabled
    expect(calls.messages.some((m) => m.includes("Parts request"))).toBe(true);
  });

  it("posts a channel message for announcements", async () => {
    const { client, calls } = fakeClickUp();
    const d = new Dispatcher(config(), client, state);
    await d.dispatch(normalize({ announcement: { id: "a1", announcement: "Pits close at 6" } }));
    expect(calls.messages[0]).toContain("Pits close at 6");
  });
});
