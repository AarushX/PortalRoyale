/**
 * Types for Nexus payloads and the normalized internal event model.
 *
 * The exact Nexus webhook payload schema is not fully published (the docs at
 * frc.nexus/en/api are client-rendered), so the raw types are intentionally
 * permissive. `normalize()` (see normalize.ts) maps whatever we recognize and
 * carries unknown fields through so nothing is lost.
 *
 * Confirmed/likely fields (from frc.nexus public API v1.x and the
 * berkakinci/NexusGroupMeConnector reference): `eventKey`, `dataAsOfTime`,
 * `nowQueuing`, `matches[]` ({ label, status, redTeams, blueTeams, times }),
 * `announcements[]` ({ id, announcement, postedTime }), and parts requests.
 */

export interface NexusRawPayload {
  eventKey?: string;
  dataAsOfTime?: number;
  nowQueuing?: string | null;
  matches?: NexusMatch[];
  // Some webhook payloads describe a single match transition.
  match?: NexusMatch;
  announcements?: NexusAnnouncement[];
  announcement?: NexusAnnouncement | string;
  partsRequests?: NexusPartsRequest[];
  partsRequest?: NexusPartsRequest;
  parts?: NexusPartsRequest[];
  [key: string]: unknown;
}

export interface NexusMatch {
  label?: string;
  status?: string | null;
  redTeams?: string[];
  blueTeams?: string[];
  times?: Record<string, number | null>;
  [key: string]: unknown;
}

export interface NexusAnnouncement {
  id?: string;
  announcement?: string;
  postedTime?: number;
  [key: string]: unknown;
}

export interface NexusPartsRequest {
  id?: string;
  parts?: string;
  requestedByTeam?: string;
  team?: string;
  requestedTime?: number;
  outstanding?: boolean;
  [key: string]: unknown;
}

/** Discriminated union of normalized events handed to the dispatcher. */
export type NexusEvent =
  | MatchEvent
  | AnnouncementEvent
  | PartsRequestEvent;

export interface MatchEvent {
  kind: "match";
  /** Stable id used for dedup, e.g. "match:Qualification 5:On field". */
  dedupeKey: string;
  label: string;
  status: string | null;
  redTeams: string[];
  blueTeams: string[];
  times: Record<string, number | null>;
  eventKey?: string;
}

export interface AnnouncementEvent {
  kind: "announcement";
  dedupeKey: string;
  id: string;
  text: string;
  postedTime?: number;
  eventKey?: string;
}

export interface PartsRequestEvent {
  kind: "parts";
  dedupeKey: string;
  id: string;
  parts: string;
  team: string;
  requestedTime?: number;
  /** false => the request has been resolved; close the task. */
  outstanding: boolean;
  eventKey?: string;
}
