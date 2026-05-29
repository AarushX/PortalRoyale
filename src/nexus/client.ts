/**
 * Pull client for the Nexus REST API, used only by the scheduled poll backup.
 *
 * Endpoint:  GET https://frc.nexus/api/v1/event/{eventKey}
 * Auth:      header `Nexus-Api-Key: <key>`
 *
 * The webhook path is the primary ingestion route; this exists as a safety
 * net for missed deliveries.
 */

import type { NexusRawPayload } from "./types.js";

const NEXUS_API_BASE = "https://frc.nexus/api/v1";

export class NexusClient {
  constructor(private readonly apiKey: string) {}

  async fetchEvent(eventKey: string): Promise<NexusRawPayload> {
    const res = await fetch(`${NEXUS_API_BASE}/event/${encodeURIComponent(eventKey)}`, {
      headers: {
        "Nexus-Api-Key": this.apiKey,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`Nexus API ${res.status}: ${body}`);
    }
    return (await res.json()) as NexusRawPayload;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}
