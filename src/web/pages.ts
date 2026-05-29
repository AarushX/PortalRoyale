/**
 * Dependency-free HTML for the landing and dashboard pages. Rendered as
 * template strings and served directly by the Worker — no build step, no
 * client framework, stays on the free tier.
 */

import type { Connection } from "../store/connections.js";

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem; line-height: 1.5; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
  .muted { opacity: 0.7; } .pill { display:inline-block; padding:.1rem .5rem;
    border-radius: 999px; background:#2563eb22; font-size:.8rem; }
  label { display:block; margin:.75rem 0 .2rem; font-weight:600; font-size:.9rem; }
  input, select { width:100%; padding:.5rem; border:1px solid #8884; border-radius:8px;
    background:transparent; color:inherit; }
  .row { display:flex; gap:1rem; } .row > div { flex:1; }
  .checks { display:grid; grid-template-columns:1fr 1fr; gap:.4rem; margin-top:.5rem; }
  .checks label { display:flex; align-items:center; gap:.5rem; font-weight:400; margin:0; }
  .checks input { width:auto; }
  button, .btn { display:inline-block; padding:.6rem 1rem; border:0; border-radius:8px;
    background:#2563eb; color:#fff; font-weight:600; cursor:pointer; text-decoration:none; }
  button.secondary { background:#8883; color:inherit; }
  code, .mono { font-family: ui-monospace, Menlo, monospace; }
  .card { border:1px solid #8884; border-radius:12px; padding:1rem 1.25rem; margin-top:1rem; }
  .copy { word-break:break-all; background:#8881; padding:.5rem; border-radius:8px; }
  #status { margin-top:1rem; font-weight:600; }
`;

export function landingPage(authorizeUrl: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nexus → ClickUp</title><style>${STYLE}</style></head><body>
<h1>Nexus → ClickUp</h1>
<p class="muted">Pipe live FRC event updates from <a href="https://frc.nexus">Nexus</a>
into your ClickUp — parts requests become tasks, announcements and match status
stream into a Chat channel.</p>
<h2>Get started</h2>
<p>Sign in with ClickUp to connect your account and set things up. No tokens to copy.</p>
<p><a class="btn" href="${authorizeUrl}">Sign in with ClickUp</a></p>
</body></html>`;
}

export function dashboardPage(conn: Connection, baseUrl: string): string {
  const webhookUrl = `${baseUrl}/nexus/webhook/${conn.connectionId}`;
  // Expose a safe subset to the page script (never the ClickUp OAuth token).
  const data = {
    connectionId: conn.connectionId,
    username: conn.clickupUsername,
    workspaceId: conn.workspaceId,
    listId: conn.listId,
    channelId: conn.channelId,
    frcTeamNumber: conn.frcTeamNumber,
    seasonYear: conn.seasonYear,
    hasTba: Boolean(conn.tbaApiKey),
    hasNexusKey: Boolean(conn.nexusApiKey),
    enableTasks: conn.enableTasks,
    enableChannel: conn.enableChannel,
    syncMatches: conn.syncMatches,
    syncAnnouncements: conn.syncAnnouncements,
    syncParts: conn.syncParts,
    matchTasks: conn.matchTasks,
    enablePoll: conn.enablePoll,
    webhookUrl,
    webhookToken: conn.webhookToken,
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard · Nexus → ClickUp</title><style>${STYLE}</style></head><body>
<h1>Your integration <span class="pill">${escapeHtml(conn.clickupUsername)}</span></h1>
<form method="post" action="/logout" style="float:right"><button class="secondary">Log out</button></form>

<h2>ClickUp destination</h2>
<label for="workspace">Workspace</label>
<select id="workspace"></select>
<div class="row">
  <div><label for="list">List (for tasks)</label><select id="list"></select></div>
  <div><label for="channel">Chat channel</label><select id="channel"></select></div>
</div>

<h2>FRC</h2>
<div class="row">
  <div><label for="team">Team number</label><input id="team" inputmode="numeric" placeholder="254"></div>
  <div><label for="year">Season year</label><input id="year" inputmode="numeric"></div>
</div>
<label for="tba">The Blue Alliance read key <span class="muted">(optional — enables team auto-discovery for polling)</span></label>
<input id="tba" placeholder="leave blank to keep existing">
<label for="nexuskey">Nexus API key <span class="muted">(optional — only for the poll backup)</span></label>
<input id="nexuskey" placeholder="leave blank to keep existing">

<h2>What to sync</h2>
<div class="checks">
  <label><input type="checkbox" id="enableTasks"> Create tasks</label>
  <label><input type="checkbox" id="enableChannel"> Post to channel</label>
  <label><input type="checkbox" id="syncParts"> Parts requests</label>
  <label><input type="checkbox" id="syncAnnouncements"> Announcements</label>
  <label><input type="checkbox" id="syncMatches"> Match status</label>
  <label><input type="checkbox" id="matchTasks"> Match → tasks</label>
  <label><input type="checkbox" id="enablePoll"> Enable poll backup</label>
</div>

<p style="margin-top:1.25rem"><button id="save">Save</button>
<button id="test" class="secondary">Send test</button></p>
<div id="status"></div>

<h2>Connect Nexus</h2>
<div class="card">
<p>In Nexus, add a <strong>Push</strong> webhook for your event with:</p>
<p class="muted">URL</p><div class="copy mono" id="whurl"></div>
<p class="muted">Nexus-Token header</p><div class="copy mono" id="whtoken"></div>
</div>

<script>
const D = JSON.parse(${JSON.stringify(json)});
const $ = (id) => document.getElementById(id);
$("whurl").textContent = D.webhookUrl;
$("whtoken").textContent = D.webhookToken;
["enableTasks","enableChannel","syncParts","syncAnnouncements","syncMatches","matchTasks","enablePoll"]
  .forEach((k) => { $(k).checked = D[k]; });
$("team").value = D.frcTeamNumber || "";
$("year").value = D.seasonYear || "";
$("tba").placeholder = D.hasTba ? "•••••• (saved — leave blank to keep)" : "";
$("nexuskey").placeholder = D.hasNexusKey ? "•••••• (saved — leave blank to keep)" : "";

function fill(sel, opts, selected) {
  sel.innerHTML = '<option value="">—</option>' +
    opts.map((o) => '<option value="' + o.id + '"' + (o.id === selected ? " selected" : "") + '>' +
      o.name.replace(/</g, "&lt;") + "</option>").join("");
}

async function loadOptions(workspaceId) {
  const q = workspaceId ? "?workspaceId=" + encodeURIComponent(workspaceId) : "";
  const r = await fetch("/api/clickup/options" + q);
  if (!r.ok) { $("status").textContent = "Could not load ClickUp options."; return; }
  const o = await r.json();
  if (o.workspaces) fill($("workspace"), o.workspaces, D.workspaceId);
  if (o.lists) fill($("list"), o.lists, D.listId);
  if (o.channels) fill($("channel"), o.channels, D.channelId);
}

$("workspace").addEventListener("change", (e) => loadOptions(e.target.value));

async function init() {
  await loadOptions();
  if ($("workspace").value) await loadOptions($("workspace").value);
}
init();

$("save").addEventListener("click", async () => {
  $("status").textContent = "Saving…";
  const body = {
    workspaceId: $("workspace").value, listId: $("list").value, channelId: $("channel").value,
    frcTeamNumber: $("team").value.trim(), seasonYear: parseInt($("year").value, 10) || undefined,
    tbaApiKey: $("tba").value.trim() || undefined, nexusApiKey: $("nexuskey").value.trim() || undefined,
  };
  ["enableTasks","enableChannel","syncParts","syncAnnouncements","syncMatches","matchTasks","enablePoll"]
    .forEach((k) => { body[k] = $(k).checked; });
  const r = await fetch("/api/connection", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
  $("status").textContent = r.ok ? "Saved ✓" : "Save failed: " + (await r.text());
});

$("test").addEventListener("click", async () => {
  $("status").textContent = "Sending test…";
  const r = await fetch("/api/test", { method:"POST" });
  $("status").textContent = r.ok ? "Test sent — check ClickUp ✓" : "Test failed: " + (await r.text());
});
</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
