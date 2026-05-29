/**
 * Cloudflare Worker entry point for the Nexus -> ClickUp integration.
 *
 *  fetch():
 *    POST /nexus/webhook  - primary ingestion. Validates the Nexus-Token
 *                           header, normalizes the payload, dispatches.
 *    GET  /health         - liveness check.
 *
 *  scheduled():
 *    Optional poll backup of the Nexus REST API (enabled via ENABLE_POLL_BACKUP
 *    + an uncommented cron trigger in wrangler.toml). Diffs against the last
 *    snapshot in KV and dispatches only new events.
 */

import { Env, loadConfig } from "./env.js";
import { verifyNexusToken } from "./auth.js";
import { normalize } from "./nexus/normalize.js";
import { NexusClient } from "./nexus/client.js";
import { ClickUpClient } from "./clickup/client.js";
import { SyncState } from "./sync/state.js";
import { Dispatcher } from "./sync/dispatcher.js";
import type { NexusRawPayload } from "./nexus/types.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "nexus-clickup-integration" });
    }

    if (request.method === "POST" && url.pathname === "/nexus/webhook") {
      return handleWebhook(request, env);
    }

    return json({ error: "not found" }, 404);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const config = loadConfig(env);
    if (!config.enablePollBackup) return;
    if (!env.NEXUS_API_KEY || !config.nexusEventKey) {
      console.warn("Poll backup enabled but NEXUS_API_KEY/NEXUS_EVENT_KEY missing");
      return;
    }
    await runPoll(env, config.nexusEventKey, env.NEXUS_API_KEY);
  },
};

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (!verifyNexusToken(request.headers, env.NEXUS_TOKEN)) {
    return json({ error: "Not authenticated. Nexus-Token didn't match." }, 401);
  }

  let payload: NexusRawPayload;
  try {
    payload = (await request.json()) as NexusRawPayload;
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const config = loadConfig(env);
  const dispatcher = new Dispatcher(
    config,
    new ClickUpClient(env.CLICKUP_TOKEN, { dryRun: config.dryRun }),
    new SyncState(env.STATE),
  );

  const events = normalize(payload);
  const result = await dispatcher.dispatch(events);
  // 200 even with per-event errors so Nexus doesn't hammer retries for a
  // single bad item; errors are surfaced in the body and logs.
  if (result.errors.length) console.error("dispatch errors", result.errors);
  return json(result);
}

async function runPoll(env: Env, eventKey: string, apiKey: string): Promise<void> {
  const config = loadConfig(env);
  const state = new SyncState(env.STATE);
  const dispatcher = new Dispatcher(
    config,
    new ClickUpClient(env.CLICKUP_TOKEN, { dryRun: config.dryRun }),
    state,
  );

  const payload = await new NexusClient(apiKey).fetchEvent(eventKey);
  const events = normalize(payload);

  // Only dispatch keys we didn't see last poll; the dispatcher's KV dedup is
  // the final guard, but this avoids re-scanning the whole snapshot each tick.
  const previous = await state.getPollSnapshot();
  const current = new Set(events.map((e) => e.dedupeKey));
  const fresh = events.filter((e) => !previous.has(e.dedupeKey));

  const result = await dispatcher.dispatch(fresh);
  if (result.errors.length) console.error("poll dispatch errors", result.errors);
  await state.setPollSnapshot(current);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
