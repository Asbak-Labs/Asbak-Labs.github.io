// Records a single heartbeat ("ping") from a monitor.
// Invoked by .github/workflows/ping.yml on a repository_dispatch event.
// Reads the monitor identity from env vars set from the dispatch client_payload.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const rawId = (process.env.MONITOR || '').trim();
if (!rawId) {
  console.error('No "monitor" provided in client_payload. Nothing to record.');
  process.exit(1);
}

// Normalise the id so it is always a safe filename.
const id = rawId.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
if (!id) {
  console.error(`Monitor id "${rawId}" produced an empty slug.`);
  process.exit(1);
}

const providedName = (process.env.NAME || '').trim();
const status = (process.env.STATUS || 'up').trim().toLowerCase() === 'down' ? 'down' : 'up';
const now = new Date().toISOString();

const dir = 'data/heartbeats';
mkdirSync(dir, { recursive: true });
const file = `${dir}/${id}.json`;

let hb = {};
if (existsSync(file)) {
  try { hb = JSON.parse(readFileSync(file, 'utf8')); } catch { hb = {}; }
}

hb.id = id;
hb.name = providedName || hb.name || rawId;
hb.lastPing = now;
hb.lastReportedStatus = status;
hb.firstSeen = hb.firstSeen || now;
hb.pingCount = (hb.pingCount || 0) + 1;

writeFileSync(file, JSON.stringify(hb, null, 2) + '\n');
console.log(`Recorded ${status} ping for "${id}" (${hb.name}) at ${now}.`);
