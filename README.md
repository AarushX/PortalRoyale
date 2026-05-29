# Nexus → ClickUp Integration

Pipes live event data from **[Nexus for FRC](https://frc.nexus)** into
**ClickUp**, surfacing it as ClickUp **tasks** and **Chat channel** messages.
Built as a **Cloudflare Worker** so it runs on the free tier with a free public
HTTPS URL — no always-on server to manage.

During an event:

| Nexus event | ClickUp result |
|---|---|
| Team **parts request** | A **task** (auto-closed when the request is resolved) + a channel notice |
| **Announcement** | A **Chat channel** message |
| **Match** queuing / status change | A **Chat channel** message (optionally a per-match task) |

## How it works

Nexus pushes updates to a webhook in real time; this Worker validates them,
maps them, and calls the ClickUp API.

```
Nexus push webhook ─┐
                    ├─► normalize ─► dispatcher ─► ClickUp (tasks v2 + chat v3)
Nexus REST poll ────┘   (KV dedup + match→task map)
   (optional backup)
```

- **Primary:** `POST /nexus/webhook` — validates the `Nexus-Token` header.
- **Backup (optional):** a scheduled poll of the Nexus REST API for any missed
  deliveries (off by default). In poll mode you can either pin an event code or
  give just your **team number** and let the app auto-discover the event you're
  currently at via [The Blue Alliance](https://www.thebluealliance.com/apidocs).
- **State:** Workers KV deduplicates events and remembers which task maps to a
  parts request / match, so resolutions and status changes update the right task.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free).
- A **ClickUp personal token** — ClickUp avatar → *Settings* → *Apps* →
  *API Token* → **Generate**. Starts with `pk_`.
- The ClickUp **List id** for tasks, and **Workspace id** + **Chat channel id**
  for messages. (List id is in a List's URL; workspace/channel ids can be read
  via the ClickUp API — see *Finding ClickUp ids* below.)
- A **Nexus API key** *(only if you want the poll backup)* and the ability to
  add a **Push webhook** in Nexus for your event.

## Setup

```bash
npm install

# 1. Create the KV namespace and paste the returned id into wrangler.toml
npx wrangler kv namespace create STATE

# 2. Fill in the [vars] in wrangler.toml (list id, workspace id, channel id,
#    event key, toggles).

# 3. Set secrets (prompts for each value)
npx wrangler secret put NEXUS_TOKEN     # a shared secret you choose
npx wrangler secret put CLICKUP_TOKEN   # pk_...
# Only if enabling the poll backup:
npx wrangler secret put NEXUS_API_KEY

# 4. Deploy
npx wrangler deploy
```

Then in **Nexus**, add a **Push** API webhook for your event pointing at:

```
https://<your-worker>.workers.dev/nexus/webhook
```

and set its token to the same value you used for `NEXUS_TOKEN`.

Check it's live: `curl https://<your-worker>.workers.dev/health`.

## Configuration (wrangler.toml `[vars]`)

| Var | Meaning |
|---|---|
| `NEXUS_EVENT_KEY` | FRC event code, e.g. `2024nyro` (poll backup only) |
| `FRC_TEAM_NUMBER` | Team number — auto-discovers the active event via TBA when `NEXUS_EVENT_KEY` is empty |
| `SEASON_YEAR` | Season year for auto-discovery (defaults to current year) |
| `CLICKUP_LIST_ID` | List where tasks are created |
| `CLICKUP_WORKSPACE_ID` / `CLICKUP_CHANNEL_ID` | Chat channel target |
| `ENABLE_TASKS` / `ENABLE_CHANNEL` | Master switches for each destination |
| `SYNC_MATCHES` / `SYNC_ANNOUNCEMENTS` / `SYNC_PARTS` | Per-event-type switches |
| `MATCH_TASKS` | Also mirror matches as tasks (default off) |
| `DRY_RUN` | Log ClickUp calls instead of sending them |
| `ENABLE_POLL_BACKUP` | Enable the scheduled Nexus poll (also uncomment the `[triggers]` cron) |

Secrets (`wrangler secret put`): `NEXUS_TOKEN`, `CLICKUP_TOKEN`,
`NEXUS_API_KEY` (poll backup only), and `TBA_API_KEY` (team auto-discovery only;
get a read key at <https://www.thebluealliance.com/account>).

### Zero-config-per-event poll mode (just a team number)

To run the poll backup without maintaining event codes, leave `NEXUS_EVENT_KEY`
empty and set:

```toml
# wrangler.toml
ENABLE_POLL_BACKUP = "true"
FRC_TEAM_NUMBER = "254"
[triggers]
crons = ["* * * * *"]
```

```bash
npx wrangler secret put NEXUS_API_KEY
npx wrangler secret put TBA_API_KEY
```

Each tick the Worker asks TBA which event team 254 is at *today* and polls that
event (cached in KV for ~6h, so TBA isn't hit every minute). Note: webhook mode
still needs the webhook enabled on the event's page in Nexus — there's no public
API to register Nexus webhooks programmatically, so team auto-discovery applies
to the poll path.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in secrets; never commit this
npx wrangler dev

# Send a sample webhook (DRY_RUN=true in wrangler.toml logs instead of posting):
curl -X POST http://localhost:8787/nexus/webhook \
  -H "Nexus-Token: choose-a-shared-secret" \
  -H "Content-Type: application/json" \
  -d '{"eventKey":"2024nyro","partsRequest":{"id":"p1","parts":"120T pulley","requestedByTeam":"456"}}'
```

## Tests

```bash
npm test        # vitest: normalize() + dispatcher mapping/dedup
npm run typecheck
```

## Finding ClickUp ids

- **List id:** open the List in ClickUp — it's the number in the URL.
- **Workspace (team) id:** `GET https://api.clickup.com/api/v2/team` with
  `Authorization: <pk token>`.
- **Channel id:** `GET https://api.clickup.com/api/v3/workspaces/{workspace_id}/chat/channels`.

## Notes & caveats

- **ClickUp Chat API (v3) is experimental.** It generally works with a personal
  `pk_` token, but if channel posting returns `401`, you may need an OAuth app
  token for chat. Tasks (v2) are unaffected — set `ENABLE_CHANNEL="false"` to
  run tasks-only in the meantime.
- **Nexus payload schema:** the public webhook payload shape isn't fully
  documented, so `normalize()` is deliberately permissive (it keys off field
  presence and ignores what it doesn't recognize). If a field name differs at
  your event, capture one real payload and adjust `src/nexus/normalize.ts`.
- Free-tier KV allows 1k writes/day; the app only writes on actual changes, so
  a typical event stays well within budget.
