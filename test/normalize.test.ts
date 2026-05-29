import { describe, it, expect } from "vitest";
import { normalize } from "../src/nexus/normalize.js";

describe("normalize", () => {
  it("normalizes a full event snapshot with matches, announcements, parts", () => {
    const events = normalize({
      eventKey: "2024nyro",
      dataAsOfTime: 1716000000000,
      nowQueuing: "Qualification 5",
      matches: [
        {
          label: "Qualification 5",
          status: "On field",
          redTeams: ["frc123", "frc456", "frc789"],
          blueTeams: ["frc111", "frc222", "frc333"],
          times: { estimatedStartTime: 1716000060000 },
        },
      ],
      announcements: [
        { id: "a1", announcement: "Lunch at noon", postedTime: 1716000000000 },
      ],
      partsRequests: [
        { id: "p1", parts: "120T pulley", requestedByTeam: "456", outstanding: true },
      ],
    });

    expect(events).toHaveLength(3);
    const match = events.find((e) => e.kind === "match");
    expect(match).toMatchObject({
      label: "Qualification 5",
      status: "On field",
      redTeams: ["123", "456", "789"], // frc prefix stripped
    });
    expect(events.find((e) => e.kind === "announcement")).toMatchObject({
      id: "a1",
      text: "Lunch at noon",
    });
    expect(events.find((e) => e.kind === "parts")).toMatchObject({
      id: "p1",
      team: "456",
      outstanding: true,
    });
  });

  it("handles a single match-transition webhook shape", () => {
    const events = normalize({
      eventKey: "2024nyro",
      match: { label: "Qualification 6", status: "Now queuing" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "match", label: "Qualification 6" });
    expect(events[0].dedupeKey).toBe("match:Qualification 6:Now queuing");
  });

  it("distinguishes outstanding vs resolved parts via dedupeKey", () => {
    const open = normalize({ partsRequest: { id: "p9", parts: "battery", outstanding: true } });
    const closed = normalize({ partsRequest: { id: "p9", parts: "battery", outstanding: false } });
    expect(open[0].dedupeKey).toBe("parts:p9:open");
    expect(closed[0].dedupeKey).toBe("parts:p9:closed");
  });

  it("synthesizes a stable id when none is provided", () => {
    const a = normalize({ announcement: "Field reset" });
    const b = normalize({ announcement: "Field reset" });
    expect(a[0].dedupeKey).toBe(b[0].dedupeKey);
  });

  it("ignores empty / unrecognized payloads", () => {
    expect(normalize({})).toHaveLength(0);
    expect(normalize({ matches: [{ status: "On field" }] })).toHaveLength(0); // no label
  });
});
