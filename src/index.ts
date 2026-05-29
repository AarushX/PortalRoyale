/**
 * Cloudflare Worker entry point.
 *
 * Multi-user web app + ingestion in one Worker:
 *   Web/OAuth:
 *     GET  /                          landing ("Sign in with ClickUp")
 *     GET  /oauth/clickup/start       begin OAuth (sets state cookie)
 *     GET  /oauth/clickup/callback    finish OAuth, create session
 *     GET  /dashboard                 per-user config UI (session-gated)
 *     GET  /api/clickup/options       dropdown data (session-gated)
 *     POST /api/connection            save config (session-gated)
 *     POST /api/test                  send a test task/message (session-gated)
 *     POST /logout
 *   Ingestion:
 *     POST /nexus/webhook/{id}        per-connection webhook (Nexus-Token)
 *     POST /nexus/webhook             legacy single-tenant (env config)
 *     GET  /health
 *
 * scheduled(): optional per-connection poll backup of the Nexus REST API.
 */

import { Env, loadConfig } from "./env.js";
import { verifyNexusToken } from "./auth.js";
import { normalize } from "./nexus/normalize.js";
import { NexusClient } from "./nexus/client.js";
import { ClickUpClient } from "./clickup/client.js";
import { SyncState } from "./sync/state.js";
import { Dispatcher } from "./sync/dispatcher.js";
import { TbaClient } from "./tba/client.js";
import { pickActiveEvent, pickNextEvent, todayUtc } from "./tba/activeEvent.js";
import { buildAuthorizeUrl, exchangeCode, getUser } from "./oauth/clickup.js";
import {
  ConnectionStore,
  connectionToConfig,
  type Connection,
} from "./store/connections.js";
import {
  SessionStore,
  SESSION_COOKIE,
  readCookie,
  cookieHeader,
} from "./store/sessions.js";
import { listWorkspaces, listChannels, listLists } from "./clickup/lookup.js";
import { landingPage, dashboardPage } from "./web/pages.js";
import { randomId } from "./crypto.js";
import type { NexusRawPayload } from "./nexus/types.js";

const OAUTH_STATE_COOKIE = "ncx_oauth_state";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const m = request.method;

    try {
      if (m === "GET" && pathname === "/health") {
        return json({ ok: true, service: "nexus-clickup-integration" });
      }
      if (m === "GET" && pathname === "/") return landing(request, env);
      if (m === "GET" && pathname === "/oauth/clickup/start") return oauthStart(request, env);
      if (m === "GET" && pathname === "/oauth/clickup/callback") return oauthCallback(request, env);
      if (m === "GET" && pathname === "/dashboard") return dashboard(request, env);
      if (m === "GET" && pathname === "/api/clickup/options") return apiOptions(request, env);
      if (m === "POST" && pathname === "/api/connection") return apiSaveConnection(request, env);
      if (m === "POST" && pathname === "/api/test") return apiTest(request, env);
      if (m === "POST" && pathname === "/logout") return logout(request, env);

      const hook = pathname.match(/^\/nexus\/webhook\/([A-Za-z0-9]+)$/);
      if (m === "POST" && hook) return handleConnectionWebhook(request, env, hook[1]);
      if (m === "POST" && pathname === "/nexus/webhook") return handleLegacyWebhook(request, env);

      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error("unhandled", (err as Error).message);
      return json({ error: "internal error" }, 500);
    }
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await runScheduledPoll(env);
  },
};

// ---------------------------------------------------------------------------
// Web app
// ---------------------------------------------------------------------------

function redirectUri(request: Request, env: Env): string {
  const base = env.APP_BASE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  return `${base}/oauth/clickup/callback`;
}

function connStore(env: Env): ConnectionStore | null {
  if (!env.ENCRYPTION_KEY) return null;
  return new ConnectionStore(env.STATE, env.ENCRYPTION_KEY);
}

async function loadSessionConnection(
  request: Request,
  env: Env,
): Promise<{ sessionId: string; conn: Connection } | null> {
  const store = connStore(env);
  if (!store) return null;
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const connectionId = await new SessionStore(env.STATE).getConnectionId(sessionId);
  if (!connectionId) return null;
  const conn = await store.get(connectionId);
  return conn ? { sessionId, conn } : null;
}

async function landing(request: Request, env: Env): Promise<Response> {
  if (await loadSessionConnection(request, env)) {
    return Response.redirect(new URL("/dashboard", request.url).toString(), 302);
  }
  if (!env.CLICKUP_CLIENT_ID || !env.ENCRYPTION_KEY) {
    return html(
      "<h1>Setup needed</h1><p>Set <code>CLICKUP_CLIENT_ID</code>, " +
        "<code>CLICKUP_CLIENT_SECRET</code> and <code>ENCRYPTION_KEY</code>, then redeploy.</p>",
    );
  }
  return html(landingPage("/oauth/clickup/start"));
}

function oauthStart(request: Request, env: Env): Response {
  if (!env.CLICKUP_CLIENT_ID) return json({ error: "OAuth not configured" }, 500);
  const state = randomId(16);
  const authorizeUrl = buildAuthorizeUrl(
    env.CLICKUP_CLIENT_ID,
    redirectUri(request, env),
    state,
  );
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl,
      "Set-Cookie": cookieHeader(OAUTH_STATE_COOKIE, state, { maxAge: 600 }),
    },
  });
}

async function oauthCallback(request: Request, env: Env): Promise<Response> {
  const store = connStore(env);
  if (!store || !env.CLICKUP_CLIENT_ID || !env.CLICKUP_CLIENT_SECRET) {
    return json({ error: "OAuth not configured" }, 500);
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, OAUTH_STATE_COOKIE);
  if (!code || !state || state !== expectedState) {
    return html("<h1>Sign-in failed</h1><p>Invalid or expired request. <a href='/'>Try again</a>.</p>", 400);
  }

  const token = await exchangeCode(env.CLICKUP_CLIENT_ID, env.CLICKUP_CLIENT_SECRET, code);
  const user = await getUser(token);
  const conn = await store.upsertFromOAuth(user.id, user.username, token);
  const sessionId = await new SessionStore(env.STATE).create(conn.connectionId);

  const headers = new Headers({ Location: new URL("/dashboard", request.url).toString() });
  headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, sessionId, { maxAge: 60 * 60 * 24 * 30 }));
  headers.append("Set-Cookie", cookieHeader(OAUTH_STATE_COOKIE, "", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}

async function dashboard(request: Request, env: Env): Promise<Response> {
  const session = await loadSessionConnection(request, env);
  if (!session) return Response.redirect(new URL("/", request.url).toString(), 302);
  const base = env.APP_BASE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  return html(dashboardPage(session.conn, base));
}

async function apiOptions(request: Request, env: Env): Promise<Response> {
  const session = await loadSessionConnection(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  const token = session.conn.clickupToken;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");

  const out: Record<string, unknown> = { workspaces: await listWorkspaces(token) };
  if (workspaceId) {
    out.lists = await listLists(token, workspaceId);
    out.channels = await listChannels(token, workspaceId);
  }
  return json(out);
}

async function apiSaveConnection(request: Request, env: Env): Promise<Response> {
  const store = connStore(env);
  const session = await loadSessionConnection(request, env);
  if (!store || !session) return json({ error: "unauthorized" }, 401);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const conn = session.conn;
  if (typeof body.workspaceId === "string") conn.workspaceId = body.workspaceId;
  if (typeof body.listId === "string") conn.listId = body.listId;
  if (typeof body.channelId === "string") conn.channelId = body.channelId;
  if (typeof body.frcTeamNumber === "string") conn.frcTeamNumber = body.frcTeamNumber.trim();
  if (typeof body.seasonYear === "number") conn.seasonYear = body.seasonYear;
  // Secrets: only overwrite when a non-empty value is supplied.
  if (typeof body.tbaApiKey === "string" && body.tbaApiKey) conn.tbaApiKey = body.tbaApiKey;
  if (typeof body.nexusApiKey === "string" && body.nexusApiKey) conn.nexusApiKey = body.nexusApiKey;
  for (const k of [
    "enableTasks", "enableChannel", "syncMatches", "syncAnnouncements",
    "syncParts", "matchTasks", "enablePoll",
  ] as const) {
    if (typeof body[k] === "boolean") conn[k] = body[k] as boolean;
  }
  await store.put(conn);
  return json({ ok: true });
}

async function apiTest(request: Request, env: Env): Promise<Response> {
  const session = await loadSessionConnection(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  const conn = session.conn;
  const client = new ClickUpClient(conn.clickupToken);
  const did: string[] = [];
  if (conn.enableChannel && conn.channelId) {
    await client.sendChannelMessage(conn.workspaceId, conn.channelId, "✅ Test from Nexus → ClickUp");
    did.push("channel message");
  }
  if (conn.enableTasks && conn.listId) {
    await client.createTask({
      listId: conn.listId,
      name: "Nexus → ClickUp test task",
      description: "If you can see this, your integration is wired up correctly.",
      tags: ["nexus", "test"],
    });
    did.push("task");
  }
  if (did.length === 0) {
    return json({ error: "Nothing to test — pick a List and/or channel and enable them first." }, 400);
  }
  return json({ ok: true, sent: did });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (sessionId) await new SessionStore(env.STATE).destroy(sessionId);
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL("/", request.url).toString(),
      "Set-Cookie": cookieHeader(SESSION_COOKIE, "", { maxAge: 0 }),
    },
  });
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

async function handleConnectionWebhook(
  request: Request,
  env: Env,
  connectionId: string,
): Promise<Response> {
  const store = connStore(env);
  if (!store) return json({ error: "server not configured" }, 500);
  const conn = await store.get(connectionId);
  if (!conn || !verifyNexusToken(request.headers, conn.webhookToken)) {
    return json({ error: "Not authenticated. Nexus-Token didn't match." }, 401);
  }
  const payload = await readJson(request);
  if (!payload) return json({ error: "invalid JSON" }, 400);

  const dispatcher = new Dispatcher(
    connectionToConfig(conn),
    new ClickUpClient(conn.clickupToken),
    new SyncState(env.STATE, conn.connectionId),
  );
  const result = await dispatcher.dispatch(normalize(payload));
  if (result.errors.length) console.error("dispatch errors", result.errors);
  return json(result);
}

async function handleLegacyWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.CLICKUP_TOKEN || !env.NEXUS_TOKEN) return json({ error: "not found" }, 404);
  if (!verifyNexusToken(request.headers, env.NEXUS_TOKEN)) {
    return json({ error: "Not authenticated. Nexus-Token didn't match." }, 401);
  }
  const payload = await readJson(request);
  if (!payload) return json({ error: "invalid JSON" }, 400);

  const config = loadConfig(env);
  const dispatcher = new Dispatcher(
    config,
    new ClickUpClient(env.CLICKUP_TOKEN, { dryRun: config.dryRun }),
    new SyncState(env.STATE),
  );
  const result = await dispatcher.dispatch(normalize(payload));
  if (result.errors.length) console.error("dispatch errors", result.errors);
  return json(result);
}

// ---------------------------------------------------------------------------
// Scheduled poll backup (per connection)
// ---------------------------------------------------------------------------

async function runScheduledPoll(env: Env): Promise<void> {
  const store = connStore(env);
  if (!store) return;
  const connections = await store.list();
  for (const conn of connections) {
    if (!conn.enablePoll || !conn.nexusApiKey) continue;
    try {
      await pollConnection(env, conn);
    } catch (err) {
      console.error(`poll failed for ${conn.connectionId}: ${(err as Error).message}`);
    }
  }
}

async function pollConnection(env: Env, conn: Connection): Promise<void> {
  const state = new SyncState(env.STATE, conn.connectionId);
  const eventKey = await resolveEventKey(state, {
    teamNumber: conn.frcTeamNumber,
    seasonYear: conn.seasonYear,
    tbaApiKey: conn.tbaApiKey,
  });
  if (!eventKey) return;

  const payload = await new NexusClient(conn.nexusApiKey!).fetchEvent(eventKey);
  const events = normalize(payload);
  const previous = await state.getPollSnapshot();
  const current = new Set(events.map((e) => e.dedupeKey));
  const fresh = events.filter((e) => !previous.has(e.dedupeKey));

  const dispatcher = new Dispatcher(
    connectionToConfig(conn),
    new ClickUpClient(conn.clickupToken),
    state,
  );
  const result = await dispatcher.dispatch(fresh);
  if (result.errors.length) console.error("poll dispatch errors", result.errors);
  await state.setPollSnapshot(current);
}

/** Resolve which Nexus event to poll: explicit key, else TBA auto-discovery. */
async function resolveEventKey(
  state: SyncState,
  opts: { eventKey?: string; teamNumber: string; seasonYear: number; tbaApiKey?: string },
): Promise<string | null> {
  if (opts.eventKey) return opts.eventKey;
  if (!opts.teamNumber || !opts.tbaApiKey) return null;

  const cached = await state.getCachedEventKey();
  if (cached) return cached;

  const events = await new TbaClient(opts.tbaApiKey).getTeamEvents(opts.teamNumber, opts.seasonYear);
  const today = todayUtc();
  const active = pickActiveEvent(events, today);
  if (active) {
    await state.setCachedEventKey(active.key);
    return active.key;
  }
  const next = pickNextEvent(events, today);
  console.log(
    next
      ? `Team ${opts.teamNumber}: no event today; next is ${next.key} (${next.start_date})`
      : `Team ${opts.teamNumber}: no upcoming events in ${opts.seasonYear}`,
  );
  return null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function readJson(request: Request): Promise<NexusRawPayload | null> {
  try {
    return (await request.json()) as NexusRawPayload;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
