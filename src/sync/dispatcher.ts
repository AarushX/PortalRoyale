/**
 * Transport-agnostic mapping engine. Takes normalized Nexus events (from
 * either the webhook or the poll backup), applies the feature toggles + dedup,
 * and pushes the result into ClickUp as tasks and/or Chat channel messages.
 *
 * Mapping rules:
 *  - parts request  -> ClickUp task (closed when resolved) + channel notice
 *  - announcement   -> channel message
 *  - match status   -> channel message (+ optional per-match task upsert)
 */

import type { Config } from "../env.js";
import type { ClickUpClient } from "../clickup/client.js";
import type { SyncState } from "./state.js";
import type {
  NexusEvent,
  MatchEvent,
  AnnouncementEvent,
  PartsRequestEvent,
} from "../nexus/types.js";

export interface DispatchResult {
  processed: number;
  skipped: number;
  errors: string[];
}

export class Dispatcher {
  constructor(
    private readonly config: Config,
    private readonly clickup: ClickUpClient,
    private readonly state: SyncState,
  ) {}

  async dispatch(events: NexusEvent[]): Promise<DispatchResult> {
    const result: DispatchResult = { processed: 0, skipped: 0, errors: [] };

    for (const event of events) {
      if (!this.isEnabled(event)) {
        result.skipped++;
        continue;
      }
      if (await this.state.isSeen(event.dedupeKey)) {
        result.skipped++;
        continue;
      }
      try {
        await this.handle(event);
        await this.state.markSeen(event.dedupeKey);
        result.processed++;
      } catch (err) {
        result.errors.push(`${event.dedupeKey}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  private isEnabled(event: NexusEvent): boolean {
    switch (event.kind) {
      case "match":
        return this.config.syncMatches;
      case "announcement":
        return this.config.syncAnnouncements;
      case "parts":
        return this.config.syncParts;
    }
  }

  private handle(event: NexusEvent): Promise<void> {
    switch (event.kind) {
      case "match":
        return this.handleMatch(event);
      case "announcement":
        return this.handleAnnouncement(event);
      case "parts":
        return this.handleParts(event);
    }
  }

  // --- Parts requests -> task (+ channel notice) ---
  private async handleParts(event: PartsRequestEvent): Promise<void> {
    if (this.config.enableTasks && this.config.clickup.listId) {
      if (event.outstanding) {
        const task = await this.clickup.createTask({
          listId: this.config.clickup.listId,
          name: `Parts: Team ${event.team} — ${truncate(event.parts, 60)}`,
          description: partsDescription(event),
          priority: 2, // high — parts requests are time-sensitive at events
          tags: ["nexus", "parts-request"],
          dueDate: event.requestedTime,
        });
        await this.state.setPartsTaskId(event.id, task.id);
      } else {
        const taskId = await this.state.getPartsTaskId(event.id);
        if (taskId) await this.clickup.updateTaskStatus(taskId, "complete");
      }
    }

    if (this.config.enableChannel && this.config.clickup.channelId) {
      const msg = event.outstanding
        ? `🔧 **Parts request** — Team ${event.team}: ${event.parts}`
        : `✅ **Parts request resolved** — Team ${event.team}: ${event.parts}`;
      await this.sendChannel(msg);
    }
  }

  // --- Announcements -> channel message ---
  private async handleAnnouncement(event: AnnouncementEvent): Promise<void> {
    if (this.config.enableChannel && this.config.clickup.channelId) {
      await this.sendChannel(`📢 **Announcement**\n${event.text}`);
    }
  }

  // --- Match status -> channel message (+ optional task upsert) ---
  private async handleMatch(event: MatchEvent): Promise<void> {
    if (this.config.enableChannel && this.config.clickup.channelId) {
      await this.sendChannel(matchMessage(event));
    }

    if (
      this.config.matchTasks &&
      this.config.enableTasks &&
      this.config.clickup.listId
    ) {
      const existing = await this.state.getMatchTaskId(event.label);
      if (existing) {
        if (event.status) await this.clickup.updateTaskStatus(existing, "in progress");
      } else {
        const task = await this.clickup.createTask({
          listId: this.config.clickup.listId,
          name: `Match: ${event.label}`,
          description: matchMessage(event),
          tags: ["nexus", "match"],
        });
        await this.state.setMatchTaskId(event.label, task.id);
      }
    }
  }

  private sendChannel(content: string): Promise<void> {
    return this.clickup.sendChannelMessage(
      this.config.clickup.workspaceId,
      this.config.clickup.channelId,
      content,
    );
  }
}

function partsDescription(event: PartsRequestEvent): string {
  const lines = [
    `**Team:** ${event.team}`,
    `**Needs:** ${event.parts}`,
  ];
  if (event.requestedTime) {
    lines.push(`**Requested:** ${new Date(event.requestedTime).toISOString()}`);
  }
  if (event.eventKey) lines.push(`**Event:** ${event.eventKey}`);
  lines.push("", "_Synced from Nexus for FRC._");
  return lines.join("\n");
}

function matchMessage(event: MatchEvent): string {
  const status = event.status ? ` — _${event.status}_` : "";
  const red = event.redTeams.length ? `🔴 ${event.redTeams.join(", ")}` : "";
  const blue = event.blueTeams.length ? `🔵 ${event.blueTeams.join(", ")}` : "";
  const teams = [red, blue].filter(Boolean).join("  vs  ");
  return `🏁 **${event.label}**${status}${teams ? `\n${teams}` : ""}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
