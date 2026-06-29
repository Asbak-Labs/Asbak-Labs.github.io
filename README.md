# Asbak Labs — Status Page

A self-hosted, push-based (heartbeat) status page running entirely on **GitHub Actions + GitHub Pages**.
Live at **https://asbak-labs.github.io**

Your monitors send a "ping" every few minutes. A scheduled job checks every **10 minutes** —
anything that hasn't pinged inside its grace window is shown as **down**, and uptime history is
tracked automatically.

---

## How it works

```
monitor ──ping──▶ GitHub repository_dispatch ──▶ ping.yml records data/heartbeats/<id>.json
                                                          │
                          check.yml (cron */10) ──────────┘──▶ data/status.json + data/history/
                                                                       │
                                                          GitHub Pages serves index.html
                                                          which reads data/status.json
```

- **`index.html` + `assets/`** — the glassmorphism status page (auto-refreshes every 60s).
- **`scripts/record-ping.mjs`** — records one heartbeat.
- **`scripts/check.mjs`** — evaluates every monitor, writes `data/status.json` + history.
- **`.github/workflows/ping.yml`** — runs on each ping (`repository_dispatch`, type `ping`).
- **`.github/workflows/check.yml`** — runs every 10 minutes (cron).
- **`monitors.json`** — optional config (display names, grace windows).

---

## Connecting a monitor

A ping is a single authenticated HTTP request. You need a **ping token** (a classic PAT with the
`repo` scope, or a fine-grained token with *Contents: read & write* on this repo).

> Create a **dedicated** token for monitors — do not reuse your admin token.

### curl (Linux/macOS, cron, most monitoring tools' webhooks)

```bash
curl -X POST https://api.github.com/repos/Asbak-Labs/Asbak-Labs.github.io/dispatches \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: token YOUR_PING_TOKEN" \
  -d '{"event_type":"ping","client_payload":{"monitor":"my-server"}}'
```

### PowerShell (Windows)

```powershell
$body = @{ event_type = "ping"; client_payload = @{ monitor = "my-server" } } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "https://api.github.com/repos/Asbak-Labs/Asbak-Labs.github.io/dispatches" `
  -Headers @{ Authorization = "token YOUR_PING_TOKEN"; Accept = "application/vnd.github+json" } `
  -Body $body
```

### Run it on a schedule

- **Linux cron** (every 5 min): `*/5 * * * * curl ... >/dev/null 2>&1`
- **Windows Task Scheduler**: run the PowerShell snippet on a trigger.
- **Uptime Kuma / cron-job.org / etc.**: point a "push"/webhook notification at the dispatch URL.

The `monitor` id can be anything — it auto-registers on first ping. Optional payload fields:

| field    | meaning                                            |
|----------|----------------------------------------------------|
| `monitor`| **required** — unique id / slug for the monitor    |
| `name`   | nice display name (else the id is used)            |
| `status` | `"up"` (default) or `"down"` to self-report a fault|

---

## Configuring monitors (optional)

Edit **`monitors.json`** to set display names and how long a monitor can go silent before it's
marked down:

```json
{
  "defaults": { "graceMinutes": 25 },
  "monitors": {
    "my-server": { "name": "Production API", "graceMinutes": 25 }
  }
}
```

A monitor pinging every 10 minutes with a 25-minute grace tolerates one missed ping before showing
down. You don't have to list a monitor here — it appears automatically once it pings.

---

## Maintenance

- **Uptime math**: each 10-min check records up/down per monitor; daily buckets drive the 90-day
  bars, the last ~144 checks drive the 24-hour number.
- GitHub disables scheduled workflows after 60 days of repo inactivity — commits/pings keep it alive.
- Scheduled runs can be delayed a few minutes by GitHub under load; that's expected.
