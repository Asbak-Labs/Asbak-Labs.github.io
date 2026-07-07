// Evaluates every monitor and regenerates data/status.json.
// Runs on every incoming ping (.github/workflows/ping.yml) and on a
// best-effort schedule (.github/workflows/check.yml) as a fallback.
//
// A monitor is "up" if it has pinged within its grace window, "down" if not
// (or if it self-reported down), and "pending" if it has never pinged.
// Per-monitor history is kept in data/history/<id>.json with two views:
//   - days:   { "YYYY-MM-DD": { up, total } }  -> 90-day uptime bars
//   - recent: [{ t, up }]  (trailing 24h of checks) -> 24h uptime
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

const now = new Date();
const nowIso = now.toISOString();
const today = nowIso.slice(0, 10);

// previous run's statuses, used to fire an alert only on a real up<->down change
const prevStatus = {};
if (existsSync('data/status.json')) {
  try {
    const prev = JSON.parse(readFileSync('data/status.json', 'utf8'));
    for (const m of prev.monitors || []) prevStatus[m.id] = m.status;
  } catch { /* ignore */ }
}
const alerts = [];

// ---- config -------------------------------------------------------------
let config = {};
if (existsSync('monitors.json')) {
  try { config = JSON.parse(readFileSync('monitors.json', 'utf8')); }
  catch (e) { console.error('Could not parse monitors.json:', e.message); }
}
const defaults = { periodMinutes: 10, graceMinutes: 25, ...(config.defaults || {}) };
const overrides = config.monitors || {};

// ---- gather monitor ids -------------------------------------------------
const hbDir = 'data/heartbeats';
const histDir = 'data/history';
mkdirSync(histDir, { recursive: true });
mkdirSync('data', { recursive: true });

const ids = new Set();
if (existsSync(hbDir)) {
  for (const f of readdirSync(hbDir)) if (f.endsWith('.json')) ids.add(f.replace(/\.json$/, ''));
}
for (const id of Object.keys(overrides)) ids.add(id);

// ---- evaluate -----------------------------------------------------------
const monitors = [];
for (const id of [...ids].sort()) {
  const hbFile = `${hbDir}/${id}.json`;
  let hb = null;
  if (existsSync(hbFile)) {
    try { hb = JSON.parse(readFileSync(hbFile, 'utf8')); } catch { hb = null; }
  }

  const ov = overrides[id] || {};
  const name = ov.name || (hb && hb.name) || id;
  const description = ov.description || '';
  const graceMs = (ov.graceMinutes ?? defaults.graceMinutes) * 60000;
  const lastPing = hb && hb.lastPing ? new Date(hb.lastPing) : null;

  let status;
  if (!lastPing) status = 'pending';
  else if (hb.lastReportedStatus === 'down') status = 'down';
  else status = (now - lastPing <= graceMs) ? 'up' : 'down';

  // ---- history ----
  const histFile = `${histDir}/${id}.json`;
  let hist = { days: {}, recent: [] };
  if (existsSync(histFile)) {
    try { hist = JSON.parse(readFileSync(histFile, 'utf8')); } catch { hist = { days: {}, recent: [] }; }
  }
  hist.days = hist.days || {};
  hist.recent = hist.recent || [];

  if (status !== 'pending') {
    const up = status === 'up' ? 1 : 0;
    const day = hist.days[today] || { up: 0, total: 0 };
    day.up += up;
    day.total += 1;
    hist.days[today] = day;

    // checks run at an uneven cadence (every ping plus the cron fallback),
    // so "recent" is a real 24h time window rather than a fixed sample count
    hist.recent.push({ t: nowIso, up });
    const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
    hist.recent = hist.recent.filter(s => new Date(s.t).getTime() >= cutoff);
    if (hist.recent.length > 2000) hist.recent = hist.recent.slice(-2000);

    // keep only the most recent 90 days
    const keys = Object.keys(hist.days).sort();
    while (keys.length > 90) delete hist.days[keys.shift()];

    writeFileSync(histFile, JSON.stringify(hist) + '\n');
  }

  // ---- uptime numbers ----
  const recentTotal = hist.recent.length;
  const recentUp = hist.recent.reduce((a, b) => a + (b.up ? 1 : 0), 0);
  const uptime24h = recentTotal ? (recentUp / recentTotal) * 100 : null;

  let sumUp = 0, sumTotal = 0;
  for (const k of Object.keys(hist.days)) { sumUp += hist.days[k].up; sumTotal += hist.days[k].total; }
  const uptime90d = sumTotal ? (sumUp / sumTotal) * 100 : null;

  // ---- 90-day bar series (oldest -> newest) ----
  const bars = [];
  for (let i = 89; i >= 0; i--) {
    const dt = new Date(now);
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = dt.toISOString().slice(0, 10);
    const d = hist.days[key];
    bars.push({ date: key, uptime: (!d || !d.total) ? null : +(d.up / d.total * 100).toFixed(2) });
  }

  monitors.push({
    id, name, description, status,
    lastPing: hb && hb.lastPing ? hb.lastPing : null,
    uptime24h: uptime24h == null ? null : +uptime24h.toFixed(3),
    uptime90d: uptime90d == null ? null : +uptime90d.toFixed(3),
    bars
  });

  // detect a status transition since the previous check
  const prev = prevStatus[id];
  if (status === 'down' && prev !== undefined && prev !== 'down') {
    alerts.push({ id, name, kind: 'down', lastPing: hb && hb.lastPing ? hb.lastPing : null });
  } else if (status === 'up' && prev === 'down') {
    alerts.push({ id, name, kind: 'up', lastPing: hb && hb.lastPing ? hb.lastPing : null });
  }
}

// ---- overall ------------------------------------------------------------
let overall = 'operational';
const active = monitors.filter(m => m.status !== 'pending');
if (active.some(m => m.status === 'down')) {
  overall = active.every(m => m.status === 'down') ? 'down' : 'degraded';
}

const out = {
  generatedAt: nowIso,
  site: config.site || {},
  overall,
  monitors
};
writeFileSync('data/status.json', JSON.stringify(out, null, 2) + '\n');
console.log(`status.json updated: ${monitors.length} monitor(s), overall=${overall}.`);

// ---- Discord alerts on status change ------------------------------------
const webhook = process.env.DISCORD_WEBHOOK_URL;
if (alerts.length && !webhook) {
  console.log(`${alerts.length} status change(s) but DISCORD_WEBHOOK_URL is not set — skipping alerts.`);
}
for (const a of (webhook ? alerts : [])) {
  try {
    await sendDiscord(webhook, a, out.site);
    console.log(`Discord ${a.kind} alert sent for ${a.id}.`);
  } catch (e) {
    console.error(`Discord alert failed for ${a.id}: ${e.message}`);
  }
}

async function sendDiscord(url, a, site) {
  const down = a.kind === 'down';
  const fields = [
    { name: 'Monitor', value: a.name || a.id, inline: true },
    { name: 'Status', value: down ? '🔴 Down' : '🟢 Operational', inline: true },
  ];
  if (a.lastPing) {
    const epoch = Math.floor(new Date(a.lastPing).getTime() / 1000);
    fields.push({ name: 'Last heartbeat', value: `<t:${epoch}:R>`, inline: false });
  }
  const embed = {
    title: down ? `🔴 ${a.name || a.id} is DOWN` : `🟢 ${a.name || a.id} has recovered`,
    description: down
      ? 'No heartbeat was received within the grace window.'
      : 'A heartbeat was received again — the monitor is back up.',
    color: down ? 0xed4245 : 0x57f287,
    fields,
    timestamp: nowIso,
    footer: { text: 'Asbak Labs Status' },
  };
  if (site && site.url) embed.url = site.url;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Asbak Labs Status', embeds: [embed] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
}
