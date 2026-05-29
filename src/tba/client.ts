/**
 * The Blue Alliance (TBA) client — used to auto-discover which event a team
 * is attending so the only required config is the team number.
 *
 * Endpoint: GET https://www.thebluealliance.com/api/v3/team/frc{n}/events/{year}/simple
 * Auth:     header `X-TBA-Auth-Key: <key>`
 *
 * TBA event keys (e.g. "2024nyro") match the FIRST event codes Nexus uses, so
 * the resolved key can be handed straight to the Nexus REST API.
 */

const TBA_BASE = "https://www.thebluealliance.com/api/v3";

export interface TbaEvent {
  key: string;
  name?: string;
  start_date?: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD
}

export class TbaClient {
  constructor(private readonly apiKey: string) {}

  async getTeamEvents(teamNumber: string | number, year: number): Promise<TbaEvent[]> {
    const url = `${TBA_BASE}/team/frc${teamNumber}/events/${year}/simple`;
    const res = await fetch(url, {
      headers: { "X-TBA-Auth-Key": this.apiKey, Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      throw new Error(`TBA ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as TbaEvent[];
  }
}
