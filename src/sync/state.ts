/**
 * KV-backed state: dedup of already-processed events, the match->task id map
 * (so a match's task can be status-updated on transitions), and the poll
 * snapshot used by the scheduled backup.
 *
 * To stay within the free-tier KV write budget (1k writes/day), callers
 * should only write when something actually changed.
 */

const SEEN_PREFIX = "seen:";
const MATCH_TASK_PREFIX = "matchtask:";
const PARTS_TASK_PREFIX = "partstask:";
const SNAPSHOT_KEY = "poll:lastSeenKeys";

// Seen markers expire after a day — an event spans hours, not days, and this
// keeps KV from growing without bound.
const SEEN_TTL_SECONDS = 60 * 60 * 24;

export class SyncState {
  constructor(private readonly kv: KVNamespace) {}

  /** Returns true if this dedupeKey was already processed. */
  async isSeen(dedupeKey: string): Promise<boolean> {
    return (await this.kv.get(SEEN_PREFIX + dedupeKey)) !== null;
  }

  async markSeen(dedupeKey: string): Promise<void> {
    await this.kv.put(SEEN_PREFIX + dedupeKey, "1", {
      expirationTtl: SEEN_TTL_SECONDS,
    });
  }

  async getMatchTaskId(label: string): Promise<string | null> {
    return this.kv.get(MATCH_TASK_PREFIX + label);
  }

  async setMatchTaskId(label: string, taskId: string): Promise<void> {
    await this.kv.put(MATCH_TASK_PREFIX + label, taskId, {
      expirationTtl: SEEN_TTL_SECONDS,
    });
  }

  async getPartsTaskId(id: string): Promise<string | null> {
    return this.kv.get(PARTS_TASK_PREFIX + id);
  }

  async setPartsTaskId(id: string, taskId: string): Promise<void> {
    await this.kv.put(PARTS_TASK_PREFIX + id, taskId, {
      expirationTtl: SEEN_TTL_SECONDS,
    });
  }

  /** Dedup keys observed in the previous poll, used to compute deltas. */
  async getPollSnapshot(): Promise<Set<string>> {
    const raw = await this.kv.get(SNAPSHOT_KEY);
    if (!raw) return new Set();
    try {
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set();
    }
  }

  async setPollSnapshot(keys: Set<string>): Promise<void> {
    await this.kv.put(SNAPSHOT_KEY, JSON.stringify([...keys]), {
      expirationTtl: SEEN_TTL_SECONDS,
    });
  }
}
