/**
 * Worker bindings and parsed configuration.
 *
 * `Env` mirrors the bindings declared in wrangler.toml (vars + KV) plus the
 * secrets set via `wrangler secret put`. `loadConfig` turns the raw string
 * vars into a typed, validated config object used throughout the app.
 */

export interface Env {
  // KV binding
  STATE: KVNamespace;

  // Secrets
  NEXUS_TOKEN?: string;
  CLICKUP_TOKEN?: string;
  NEXUS_API_KEY?: string;
  TBA_API_KEY?: string;
  // Multi-user web app secrets
  CLICKUP_CLIENT_SECRET?: string;
  ENCRYPTION_KEY?: string;

  // Vars (all strings — Workers vars are always strings)
  CLICKUP_CLIENT_ID?: string;
  APP_BASE_URL?: string;
  NEXUS_EVENT_KEY?: string;
  FRC_TEAM_NUMBER?: string;
  SEASON_YEAR?: string;
  CLICKUP_LIST_ID?: string;
  CLICKUP_WORKSPACE_ID?: string;
  CLICKUP_CHANNEL_ID?: string;
  ENABLE_TASKS?: string;
  ENABLE_CHANNEL?: string;
  SYNC_MATCHES?: string;
  SYNC_ANNOUNCEMENTS?: string;
  SYNC_PARTS?: string;
  DRY_RUN?: string;
  MATCH_TASKS?: string;
  ENABLE_POLL_BACKUP?: string;
}

export interface Config {
  nexusEventKey: string;
  frcTeamNumber: string;
  seasonYear: number;
  clickup: {
    token: string;
    listId: string;
    workspaceId: string;
    channelId: string;
  };
  enableTasks: boolean;
  enableChannel: boolean;
  syncMatches: boolean;
  syncAnnouncements: boolean;
  syncParts: boolean;
  matchTasks: boolean;
  dryRun: boolean;
  enablePollBackup: boolean;
}

function boolVar(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

export function loadConfig(env: Env): Config {
  const year = parseInt(env.SEASON_YEAR ?? "", 10);
  return {
    nexusEventKey: env.NEXUS_EVENT_KEY ?? "",
    frcTeamNumber: (env.FRC_TEAM_NUMBER ?? "").trim(),
    seasonYear: Number.isFinite(year) ? year : new Date().getUTCFullYear(),
    clickup: {
      token: env.CLICKUP_TOKEN ?? "",
      listId: env.CLICKUP_LIST_ID ?? "",
      workspaceId: env.CLICKUP_WORKSPACE_ID ?? "",
      channelId: env.CLICKUP_CHANNEL_ID ?? "",
    },
    enableTasks: boolVar(env.ENABLE_TASKS, true),
    enableChannel: boolVar(env.ENABLE_CHANNEL, true),
    syncMatches: boolVar(env.SYNC_MATCHES, true),
    syncAnnouncements: boolVar(env.SYNC_ANNOUNCEMENTS, true),
    syncParts: boolVar(env.SYNC_PARTS, true),
    matchTasks: boolVar(env.MATCH_TASKS, false),
    dryRun: boolVar(env.DRY_RUN, false),
    enablePollBackup: boolVar(env.ENABLE_POLL_BACKUP, false),
  };
}
