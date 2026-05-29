import { describe, it, expect } from "vitest";
import { pickActiveEvent, pickNextEvent } from "../src/tba/activeEvent.js";
import type { TbaEvent } from "../src/tba/client.js";

const events: TbaEvent[] = [
  { key: "2026week1", start_date: "2026-03-04", end_date: "2026-03-07" },
  { key: "2026week5", start_date: "2026-05-27", end_date: "2026-05-30" },
  { key: "2026champs", start_date: "2026-06-17", end_date: "2026-06-20" },
];

describe("pickActiveEvent", () => {
  it("returns the event whose date range covers today", () => {
    expect(pickActiveEvent(events, "2026-05-29")?.key).toBe("2026week5");
  });

  it("applies a one-day grace window around the event", () => {
    expect(pickActiveEvent(events, "2026-03-08")?.key).toBe("2026week1"); // day after end
    expect(pickActiveEvent(events, "2026-05-26")?.key).toBe("2026week5"); // day before start
  });

  it("returns null when no event is in range", () => {
    expect(pickActiveEvent(events, "2026-04-15")).toBeNull();
  });

  it("ignores events missing dates", () => {
    expect(pickActiveEvent([{ key: "x" }], "2026-05-29")).toBeNull();
  });
});

describe("pickNextEvent", () => {
  it("returns the soonest upcoming event", () => {
    expect(pickNextEvent(events, "2026-04-15")?.key).toBe("2026week5");
    expect(pickNextEvent(events, "2026-06-01")?.key).toBe("2026champs");
  });

  it("returns null when nothing is upcoming", () => {
    expect(pickNextEvent(events, "2026-12-31")).toBeNull();
  });
});
