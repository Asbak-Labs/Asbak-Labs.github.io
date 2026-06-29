// Evaluates every monitor and regenerates data/status.json.
// Runs on a schedule (every 10 minutes) via .github/workflows/check.yml.
//
// A monitor is "up" if it has pinged within its grace window, "down" if not
// (or if it self-reported down), and "pending" if it has never pinged.
// Per-monitor history is kept in data/history/<id>.json with two views:
//   - days:   { "YYYY-MM-DD": { up, total } }  -> 90-day uptime bars
//   - recent: [{ t, up }]  (last 144 checks ~= 24h) -> 24h uptime
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

const now = new Date();
const nowIso = now.toISOString();
const today = nowIso.slice(0, 10);

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

    hist.recent.push({ t: nowIso, up });
    if (hist.recent.length > 144) hist.recent = hist.recent.slice(-144);

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
