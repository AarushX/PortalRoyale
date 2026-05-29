/**
 * Pure logic for choosing the event a team is "currently" at from its TBA
 * event list. Kept separate from the HTTP client so it is easy to unit test.
 */

import type { TbaEvent } from "./client.js";

/**
 * Pick the active event for `today` (YYYY-MM-DD, UTC date string).
 *
 * "Active" = today falls within [start_date, end_date], with a one-day grace
 * window on each side to cover setup/teardown and timezone skew. If several
 * match, the one ending soonest wins. If none are in range, returns null.
 */
export function pickActiveEvent(events: TbaEvent[], today: string): TbaEvent | null {
  const dated = events.filter((e) => e.start_date && e.end_date);

  const inWindow = dated.filter(
    (e) => addDays(e.start_date!, -1) <= today && today <= addDays(e.end_date!, 1),
  );
  if (inWindow.length > 0) {
    inWindow.sort((a, b) => a.end_date!.localeCompare(b.end_date!));
    return inWindow[0];
  }
  return null;
}

/** Returns the next upcoming event (useful for logging/diagnostics). */
export function pickNextEvent(events: TbaEvent[], today: string): TbaEvent | null {
  const upcoming = events
    .filter((e) => e.start_date && e.start_date >= today)
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!));
  return upcoming[0] ?? null;
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
