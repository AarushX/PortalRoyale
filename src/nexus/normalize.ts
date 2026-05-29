/**
 * Turn a raw Nexus payload (from a push webhook or a poll response) into a
 * flat list of normalized `NexusEvent`s.
 *
 * Classification is key-presence driven so it tolerates both the "full event
 * snapshot" shape (arrays of matches/announcements/parts) and the "single
 * transition" shape some webhooks send. Anything we don't recognize is simply
 * ignored here; the dispatcher decides what to do with each event kind.
 */

import type {
  NexusRawPayload,
  NexusMatch,
  NexusAnnouncement,
  NexusPartsRequest,
  NexusEvent,
} from "./types.js";

export function normalize(payload: NexusRawPayload): NexusEvent[] {
  const events: NexusEvent[] = [];
  const eventKey = payload.eventKey;

  // --- Matches ---
  const matches: NexusMatch[] = [];
  if (Array.isArray(payload.matches)) matches.push(...payload.matches);
  if (payload.match) matches.push(payload.match);
  for (const m of matches) {
    const label = (m.label ?? "").trim();
    if (!label) continue;
    const status = m.status ?? null;
    events.push({
      kind: "match",
      dedupeKey: `match:${label}:${status ?? "unknown"}`,
      label,
      status,
      redTeams: normalizeTeams(m.redTeams),
      blueTeams: normalizeTeams(m.blueTeams),
      times: m.times ?? {},
      eventKey,
    });
  }

  // --- Announcements ---
  const announcements: NexusAnnouncement[] = [];
  if (Array.isArray(payload.announcements)) {
    announcements.push(...payload.announcements);
  }
  if (payload.announcement) {
    announcements.push(
      typeof payload.announcement === "string"
        ? { announcement: payload.announcement }
        : payload.announcement,
    );
  }
  for (const a of announcements) {
    const text = (a.announcement ?? "").trim();
    if (!text) continue;
    const id = a.id ?? hashId("ann", text, a.postedTime);
    events.push({
      kind: "announcement",
      dedupeKey: `announcement:${id}`,
      id,
      text,
      postedTime: a.postedTime,
      eventKey,
    });
  }

  // --- Parts requests ---
  const parts: NexusPartsRequest[] = [];
  if (Array.isArray(payload.partsRequests)) parts.push(...payload.partsRequests);
  if (Array.isArray(payload.parts)) parts.push(...payload.parts);
  if (payload.partsRequest) parts.push(payload.partsRequest);
  for (const p of parts) {
    const description = (p.parts ?? "").trim();
    const team = (p.requestedByTeam ?? p.team ?? "").trim();
    if (!description && !team) continue;
    const id = p.id ?? hashId("parts", team + description, p.requestedTime);
    // outstanding defaults to true when absent (a fresh request).
    const outstanding = p.outstanding !== false;
    events.push({
      kind: "parts",
      // Dedup key includes resolution state so a "resolved" update is treated
      // as a distinct event from the original "outstanding" request.
      dedupeKey: `parts:${id}:${outstanding ? "open" : "closed"}`,
      id,
      parts: description || "(unspecified)",
      team: team || "(unknown team)",
      requestedTime: p.requestedTime,
      outstanding,
      eventKey,
    });
  }

  return events;
}

function normalizeTeams(teams: unknown): string[] {
  if (!Array.isArray(teams)) return [];
  return teams.map((t) => String(t).replace(/^frc/i, "")).filter(Boolean);
}

/** Deterministic id for payloads that lack one, so dedup stays stable. */
function hashId(prefix: string, text: string, time?: number): string {
  let h = 0;
  const s = `${text}|${time ?? ""}`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `${prefix}_${(h >>> 0).toString(36)}`;
}
