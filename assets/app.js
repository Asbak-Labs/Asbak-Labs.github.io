/* Asbak Labs status page — fetches data/status.json and renders the UI. */
(() => {
  'use strict';

  const REFRESH_MS = 60_000;
  const $ = (id) => document.getElementById(id);

  const OVERALL = {
    operational: { title: 'All Systems Operational', cls: 'operational' },
    degraded:    { title: 'Partial System Outage',  cls: 'degraded' },
    down:        { title: 'Major System Outage',     cls: 'down' },
  };
  const PILL = { up: 'Operational', down: 'Down', degraded: 'Degraded', pending: 'Awaiting first ping' };

  async function load() {
    try {
      const res = await fetch(`data/status.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      render(await res.json());
    } catch (err) {
      const hero = $('hero');
      hero.dataset.state = 'down';
      $('heroTitle').textContent = 'Could not load status';
      $('heroMeta').textContent = String(err.message || err);
    }
  }

  function render(data) {
    // branding
    if (data.site?.title) { $('brandName').textContent = data.site.title; document.title = `${data.site.title} — System Status`; }
    if (data.site?.subtitle) $('brandSub').textContent = data.site.subtitle;

    const monitors = Array.isArray(data.monitors) ? data.monitors : [];
    const active = monitors.filter((m) => m.status !== 'pending');

    // hero
    const o = OVERALL[data.overall] || OVERALL.operational;
    const hero = $('hero');
    hero.dataset.state = o.cls;
    $('heroTitle').textContent = monitors.length ? o.title : 'Waiting for monitors';
    $('heroMeta').textContent = summary(monitors, active);

    // empty state
    $('empty').hidden = monitors.length > 0;

    // cards
    const wrap = $('monitors');
    wrap.innerHTML = '';
    monitors.forEach((m, i) => wrap.appendChild(card(m, i)));

    // footer
    if (data.generatedAt) {
      $('updated').textContent = `Updated ${rel(data.generatedAt)}`;
      $('updated').title = new Date(data.generatedAt).toLocaleString();
    }
  }

  function summary(monitors, active) {
    if (!monitors.length) return 'No monitors connected yet';
    const down = active.filter((m) => m.status === 'down').length;
    const pending = monitors.length - active.length;
    const parts = [`${active.length - down}/${active.length || 0} operational`];
    if (down) parts.push(`${down} down`);
    if (pending) parts.push(`${pending} awaiting first ping`);
    return parts.join(' · ');
  }

  function card(m, i) {
    const el = document.createElement('article');
    el.className = 'card glass';
    el.style.animationDelay = `${Math.min(i * 0.05, 0.4)}s`;

    const status = m.status || 'pending';
    const uptime = m.uptime90d == null ? '—' : `${fmtPct(m.uptime90d)}%`;
    const last = m.lastPing ? `last ping ${rel(m.lastPing)}` : 'never pinged';

    el.innerHTML = `
      <div class="card-top">
        <div class="card-id">
          <span class="status-dot ${status}"></span>
          <div>
            <div class="name">${esc(m.name || m.id)}</div>
            ${m.description ? `<div class="desc">${esc(m.description)}</div>` : ''}
          </div>
        </div>
        <span class="pill ${status}">${PILL[status] || status}</span>
      </div>
      <div class="bars" data-bars></div>
      <div class="bars-legend">
        <span>90 days ago</span>
        <span class="mid"><b>${uptime}</b> uptime</span>
        <span>Today</span>
      </div>
      <div class="metrics">
        <span class="metric">24h <b>${m.uptime24h == null ? '—' : fmtPct(m.uptime24h) + '%'}</b></span>
        <span class="metric">${esc(last)}</span>
      </div>`;

    const bars = el.querySelector('[data-bars]');
    (m.bars || []).forEach((b) => bars.appendChild(bar(b)));
    return el;
  }

  function bar(b) {
    const span = document.createElement('span');
    span.className = 'bar';
    let s = 'none', label = 'No data';
    if (b.uptime != null) {
      if (b.uptime >= 99.5) { s = 'up'; }
      else if (b.uptime >= 80) { s = 'partial'; }
      else { s = 'down'; }
      label = `${fmtPct(b.uptime)}% uptime`;
    }
    span.dataset.s = s;
    const date = new Date(b.date + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    span.addEventListener('mouseenter', (e) => showTip(e, `<b>${date}</b> — ${label}`));
    span.addEventListener('mousemove', moveTip);
    span.addEventListener('mouseleave', hideTip);
    return span;
  }

  // ---- tooltip ----
  const tip = $('tip');
  function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; moveTip(e); }
  function moveTip(e) { tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; }
  function hideTip() { tip.hidden = true; }

  // ---- helpers ----
  function fmtPct(n) { return (Math.round(n * 100) / 100).toFixed(n >= 99.95 ? 0 : 2).replace(/\.00$/, ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function rel(iso) {
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return `${Math.floor(d / 60)} min ago`;
    if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
    return `${Math.floor(d / 86400)} d ago`;
  }

  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
