'use strict';
const $ = (s) => document.querySelector(s);
const h = (t, a = {}, ...c) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const x of c.flat()) if (x != null) e.append(x.nodeType ? x : document.createTextNode(String(x)));
  return e;
};
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const S = { token: store.get('ba_token'), sites: [], siteId: +store.get('ba_site') || null, days: 30, charts: [], run: 0, mode: 'login' };
const COLORS = ['#3b5bdb', '#0f9d8a', '#c2851a', '#7048e8', '#d6336c', '#9aa3af'];
const nf = new Intl.NumberFormat();

async function api(path, opts = {}) {
  const res = await fetch((window.API_BASE || '') + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: opts.body && JSON.stringify(opts.body),
  });
  let d = null; try { d = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 401 && S.token && !path.startsWith('/api/auth/')) signOut();
  if (!res.ok) throw new Error((d && d.error) || `Request failed (${res.status})`);
  return d.data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }
const iso = (d) => d.toISOString().slice(0, 10);
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- Auth ----
function showAuth() { $('#shell').hidden = true; $('#auth').hidden = false; $('#email').focus(); }
function signOut() { S.token = null; store.del('ba_token'); showAuth(); }
$('#auth-toggle').onclick = () => {
  S.mode = S.mode === 'login' ? 'register' : 'login';
  $('#auth-title').textContent = S.mode === 'login' ? 'Sign in' : 'Create account';
  $('#auth-alt-text').textContent = S.mode === 'login' ? 'New here?' : 'Already registered?';
  $('#auth-toggle').textContent = S.mode === 'login' ? 'Create an account' : 'Sign in';
  $('#password').autocomplete = S.mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
};
$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true; $('#auth-error').textContent = '';
  try {
    const d = await api('/api/auth/' + S.mode, { method: 'POST', body: { email: $('#email').value, password: $('#password').value } });
    S.token = d.token; store.set('ba_token', d.token); $('#user-email').textContent = d.user.email; $('#password').value = '';
    await boot();
  } catch (err) { $('#auth-error').textContent = err.message; } finally { btn.disabled = false; }
};
$('#signout').onclick = signOut;

// ---- Shell ----
$('#collapse').onclick = () => {
  const c = $('#shell').classList.toggle('collapsed'); $('#collapse').setAttribute('aria-expanded', String(!c));
  $('#collapse').setAttribute('aria-label', c ? 'Expand sidebar' : 'Collapse sidebar');
};
$('#menu').onclick = () => $('#sidebar').classList.toggle('open');
$('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) $('#sidebar').classList.remove('open'); });
$('#site-select').onchange = (e) => { S.siteId = +e.target.value; store.set('ba_site', S.siteId); route(); };
$('#range-select').onchange = (e) => { S.days = +e.target.value; if (currentRoute() !== 'websites') route(); };
window.addEventListener('hashchange', route);
const currentRoute = () => (location.hash.replace('#/', '') || 'overview');

async function loadSites() {
  S.sites = (await api('/api/websites')).map((s) => ({ ...s, id: +s.id }));
  if (!S.sites.some((s) => s.id === S.siteId)) S.siteId = S.sites[0] ? S.sites[0].id : null;
  const sel = $('#site-select'); sel.replaceChildren(...S.sites.map((s) => h('option', { value: s.id, selected: s.id === S.siteId }, s.name)));
  sel.disabled = !S.sites.length;
}
async function boot() {
  $('#auth').hidden = true; $('#shell').hidden = false;
  try {
    if (!$('#user-email').textContent) $('#user-email').textContent = (await api('/api/auth/me')).email;
    await loadSites();
  } catch (e) { if (!S.token) return; }
  route();
}

// ---- Views ----
const TITLES = { audience: 'Audience', pages: 'Pages', events: 'Events', acquisition: 'Acquisition', technology: 'Technology' };
function destroyCharts() { S.charts.forEach((c) => c.destroy()); S.charts = []; }
function route() {
  const cr = currentRoute(), r = cr === 'websites' || TITLES[cr] ? cr : 'overview';
  document.querySelectorAll('[data-route]').forEach((a) => (a.dataset.route === r ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  destroyCharts(); S.run++;
  (r === 'websites' ? renderWebsites : r === 'overview' ? renderOverview : () => renderDetail(r))();
}
const stateBox = (title, text, ...extra) => h('div', { class: 'card state' }, h('h2', {}, title), h('p', {}, text), ...extra);
const skeletonView = () => h('div', {}, h('div', { class: 'kpis' }, [1, 2, 3, 4, 5].map(() => h('div', { class: 'card skeleton', style: 'height:92px' }))),
  h('div', { class: 'card skeleton', style: 'height:320px;margin-bottom:12px' }), h('div', { class: 'grid g2' }, h('div', { class: 'card skeleton', style: 'height:260px' }), h('div', { class: 'card skeleton', style: 'height:260px' })));

async function renderOverview() {
  const main = $('#main'), run = S.run; main.replaceChildren();
  if (!S.sites.length) return main.append(stateBox('No websites yet', 'Add a website to get your tracking snippet.', h('a', { class: 'btn primary', href: '#/websites' }, 'Add a website')));
  const site = S.sites.find((s) => s.id === S.siteId);
  main.append(skeletonView());
  try {
    if (!window.Chart) throw new Error('Charts library failed to load. Check your connection.');
    const end = new Date(), start = new Date(Date.now() - (S.days - 1) * 86400000);
    const d = await api(`/api/analytics/overview?websiteId=${S.siteId}&startDate=${iso(start)}&endDate=${iso(end)}`);
    if (run !== S.run) return;
    main.replaceChildren(draw(d, site));
    drawCharts(d);
  } catch (e) {
    if (run !== S.run) return;
    main.replaceChildren(stateBox('Could not load analytics', e.message, h('button', { class: 'btn', onclick: renderOverview }, 'Retry')));
  }
}
function kpi(label, value, change, invert) {
  const has = change != null && isFinite(change);
  const up = has && change > 0, good = invert ? !up : up;
  return h('div', { class: 'card kpi' }, h('div', { class: 'k-label' }, label), h('div', { class: 'k-value' }, value),
    h('div', { class: 'delta ' + (has && change !== 0 ? (good ? 'up' : 'down') : '') },
      has ? `${up ? '▲' : change < 0 ? '▼' : '–'} ${Math.abs(change).toFixed(1)}% vs previous period` : 'No previous data'));
}
function chartCard(title, id, label, hasData, cls = '') {
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, title)),
    h('div', { class: 'chart-box ' + cls }, hasData ? h('canvas', { id, role: 'img', 'aria-label': label }) : h('div', { class: 'inline-empty' }, 'No data for this period')));
}
const summ = (rows) => rows.map((r) => `${r.name} ${r.value}`).join(', ');
function draw(d, site) {
  const k = d.kpis, c = d.change;
  const peak = d.series.reduce((m, r) => (r.visitors > m.visitors ? r : m), { visitors: 0, day: 'n/a' });
  const total = d.pages.reduce((a, p) => a + p.views, 0);
  const root = h('div', {},
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, site.name, site.is_demo ? h('span', { class: 'badge' }, 'Demo data') : null), h('span', { class: 'muted' }, site.domain))),
    h('div', { class: 'kpis' }, kpi('Visitors', nf.format(k.visitors), c.visitors), kpi('Page views', nf.format(k.pageviews), c.pageviews), kpi('Sessions', nf.format(k.sessions), c.sessions),
      kpi('Avg. session duration', fmtDur(k.avgDuration), c.avgDuration), kpi('Bounce rate', k.bounceRate.toFixed(1) + '%', c.bounceRate, true)),
    h('section', { class: 'card', style: 'margin-bottom:12px' }, h('div', { class: 'card-head' }, h('h2', {}, 'Traffic overview'),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Data series' }, [['Visitors', 0], ['Page views', 1], ['Sessions', 2]].map(([n, i]) =>
        h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: i < 2 ? '' : null, 'data-series': i }), h('i', { style: 'background:' + COLORS[i] }), n)))),
      h('div', { class: 'chart-box' }, k.pageviews + k.sessions ? h('canvas', { id: 'traffic', role: 'img', 'aria-label': `Daily visitors, page views and sessions. Peak visitors ${peak.visitors} on ${peak.day}.` })
        : h('div', { class: 'inline-empty' }, 'No events recorded in this period'))),
    h('div', { class: 'grid g-wide' },
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Top pages')), h('div', { class: 'table-wrap' }, d.pages.length ? h('table', {},
        h('thead', {}, h('tr', {}, ['Page', 'Views', 'Visitors', 'Share'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
        h('tbody', {}, d.pages.map((p) => h('tr', {}, h('td', { title: p.path }, p.title ? `${p.title} ` : '', h('span', { class: 'muted' }, p.path)),
          h('td', { class: 'num' }, nf.format(p.views)), h('td', { class: 'num' }, nf.format(p.visitors)), h('td', { class: 'num' }, p.share.toFixed(1) + '%', h('span', { class: 'bar', style: `width:${Math.max(2, p.share * 0.6)}px`, 'aria-hidden': 'true' }))))))
        : h('div', { class: 'inline-empty', style: 'padding:40px' }, 'No page views yet'))),
      chartCard('Traffic sources', 'channels', 'Sessions by source: ' + summ(d.channels), d.channels.length)),
    h('div', { class: 'grid g3' },
      chartCard('Devices', 'devices', 'Sessions by device: ' + summ(d.devices), d.devices.length, 'sm'),
      chartCard('Browsers', 'browsers', 'Sessions by browser: ' + summ(d.browsers), d.browsers.length, 'sm'),
      chartCard('Operating systems', 'os', 'Sessions by OS: ' + summ(d.os), d.os.length, 'sm')),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Recent events')), h('div', { class: 'table-wrap' }, d.recent.length ? h('table', {},
      h('thead', {}, h('tr', {}, ['Event', 'Page', 'Time', 'Device', 'Session', 'Source'].map((x) => h('th', {}, x)))),
      h('tbody', {}, d.recent.map((e) => h('tr', {}, h('td', {}, e.name), h('td', {}, e.path), h('td', {}, new Date(e.created_at).toLocaleString()),
        h('td', {}, cap(e.device)), h('td', {}, h('code', {}, e.session)), h('td', { class: 'muted' }, e.is_demo ? 'Demo' : 'Live')))))
      : h('div', { class: 'inline-empty', style: 'padding:40px' }, 'No events yet'))));
  void total;
  return root;
}
function drawCharts(d) {
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif'; Chart.defaults.font.size = 12;
  Chart.defaults.color = getComputedStyle(document.body).getPropertyValue('--muted').trim();
  const grid = getComputedStyle(document.body).getPropertyValue('--line').trim();
  const mk = (id, cfg) => { const el = document.getElementById(id); if (el) S.charts.push(new Chart(el, cfg)); };
  const tip = { backgroundColor: '#1f2328', padding: 10, cornerRadius: 6, titleFont: { weight: '600' } };
  const sets = [['Visitors', 'visitors'], ['Page views', 'pageviews'], ['Sessions', 'sessions']].map(([label, key], i) => ({
    label, data: d.series.map((r) => r[key]), borderColor: COLORS[i], backgroundColor: COLORS[i] + '18', fill: i === 0, tension: 0.3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, hidden: i === 2 }));
  mk('traffic', { type: 'line', data: { labels: d.series.map((r) => r.day.slice(5)), datasets: sets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: tip },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { precision: 0 } } } } });
  document.querySelectorAll('[data-series]').forEach((cb) => cb.addEventListener('change', () => {
    const ch = S.charts[0]; if (!ch) return; ch.setDatasetVisibility(+cb.dataset.series, cb.checked); ch.update();
  }));
  const donut = (id, rows) => mk(id, { type: 'doughnut', data: { labels: rows.map((r) => cap(r.name)), datasets: [{ data: rows.map((r) => r.value), backgroundColor: COLORS, borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue('--surface').trim() }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { boxWidth: 8, usePointStyle: true } }, tooltip: tip } } });
  const bars = (id, rows) => mk(id, { type: 'bar', data: { labels: rows.map((r) => r.name), datasets: [{ data: rows.map((r) => r.value), backgroundColor: COLORS[0], borderRadius: 3, barThickness: 14 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tip },
      scales: { x: { grid: { color: grid }, border: { display: false }, ticks: { precision: 0 } }, y: { grid: { display: false } } } } });
  donut('channels', d.channels); donut('devices', d.devices); bars('browsers', d.browsers); bars('os', d.os);
}

function drawSimple(specs) {
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif'; Chart.defaults.font.size = 12;
  const cs = getComputedStyle(document.body), muted = cs.getPropertyValue('--muted').trim(), grid = cs.getPropertyValue('--line').trim();
  Chart.defaults.color = muted;
  const tip = { backgroundColor: '#1f2328', padding: 10, cornerRadius: 6 };
  specs.forEach(({ id, rows, type }) => {
    const el = document.getElementById(id); if (!el) return;
    const labels = rows.map((r) => (type === 'donut' ? cap(r.name) : r.name));
    S.charts.push(new Chart(el, type === 'donut'
      ? { type: 'doughnut', data: { labels, datasets: [{ data: rows.map((r) => r.value), backgroundColor: COLORS, borderWidth: 2, borderColor: cs.getPropertyValue('--surface').trim() }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { boxWidth: 8, usePointStyle: true } }, tooltip: tip } } }
      : { type: 'bar', data: { labels, datasets: [{ data: rows.map((r) => r.value), backgroundColor: COLORS[0], borderRadius: 3, barThickness: 14 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tip },
          scales: { x: { grid: { color: grid }, border: { display: false }, ticks: { precision: 0 } }, y: { grid: { display: false } } } } }));
  });
}
async function renderDetail(kind) {
  const main = $('#main'), run = S.run; main.replaceChildren();
  if (!S.sites.length) return main.append(stateBox('No websites yet', 'Add a website to see analytics.', h('a', { class: 'btn primary', href: '#/websites' }, 'Add a website')));
  main.append(skeletonView());
  try {
    if (!window.Chart) throw new Error('Charts library failed to load. Check your connection.');
    const qs = `websiteId=${S.siteId}&startDate=${iso(new Date(Date.now() - (S.days - 1) * 86400000))}&endDate=${iso(new Date())}`;
    const [o, x] = await Promise.all([api('/api/analytics/overview?' + qs), api('/api/analytics/details?' + qs)]);
    if (run !== S.run) return;
    const specs = [];
    const chart = (title, id, rows, type, label) => { specs.push({ id, rows, type }); return chartCard(title, id, `${label}: ${summ(rows)}`, rows.length, 'sm'); };
    const tbl = (title, head, rows, cells) => h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, title)),
      h('div', { class: 'table-wrap' }, rows.length ? h('table', {}, h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
        h('tbody', {}, rows.map((r) => h('tr', {}, cells(r).map((c, i) => h('td', { class: i ? 'num' : '' }, c)))))) : h('div', { class: 'inline-empty', style: 'padding:32px' }, 'No data for this period')));
    const list = (title, rows, label = 'Sessions') => tbl(title, ['Name', label], rows, (r) => [r.name, nf.format(r.value)]);
    const k = o.kpis, c = o.change, g2 = (...a) => h('div', { class: 'grid g2' }, ...a);
    const tm = Object.fromEntries(x.pages.time.map((t) => [t.path, t.avg_time]));    
    const body = {
      audience: () => [h('div', { class: 'kpis' }, kpi('Visitors', nf.format(k.visitors), c.visitors), kpi('Sessions', nf.format(k.sessions), c.sessions),
        kpi('Page views', nf.format(k.pageviews), c.pageviews), kpi('Avg. session duration', fmtDur(k.avgDuration), c.avgDuration), kpi('Bounce rate', k.bounceRate.toFixed(1) + '%', c.bounceRate, true)),
      g2(chart('New vs returning visitors', 'nr', [{ name: 'New', value: x.audience.fresh }, { name: 'Returning', value: x.audience.returning }].filter((r) => r.value), 'donut', 'Visitors'),
        chart('Session duration', 'dur', x.audience.durations, 'bar', 'Sessions by duration'))],
        pages: () => [tbl('Most visited pages', ['Page', 'Views', 'Visitors', 'Share', 'Avg. time'], o.pages, (p) => [p.path, nf.format(p.views), nf.format(p.visitors), p.share.toFixed(1) + '%', tm[p.path] != null ? fmtDur(tm[p.path]) : '–']),
        h('div', { class: 'grid g2', style: 'margin-top:12px' }, tbl('Least visited pages', ['Page', 'Views', 'Visitors'], x.pages.least, (p) => [p.path, nf.format(p.views), nf.format(p.visitors)]),
          list('Entry pages', x.pages.entry), list('Exit pages', x.pages.exit))],
      events: () => [h('div', { class: 'kpis' }, h('div', { class: 'card kpi' }, h('div', { class: 'k-label' }, 'All events'), h('div', { class: 'k-value' }, nf.format(x.events.total))),
        h('div', { class: 'card kpi' }, h('div', { class: 'k-label' }, 'Custom events'), h('div', { class: 'k-value' }, nf.format(x.events.custom)))),
      g2(chart('Event distribution', 'ev', x.events.names, 'bar', 'Events by name'), list('Custom events', x.events.names, 'Count')),
      tbl('Recent events', ['Event', 'Page', 'Time'], o.recent, (e) => [e.name, e.path, new Date(e.created_at).toLocaleString()])],
      acquisition: () => [g2(chart('Traffic sources', 'ch', o.channels, 'donut', 'Sessions by channel'), list('Referrers', x.acquisition.referrers)),
        h('div', { class: 'grid g2', style: 'margin-top:12px' }, list('UTM source', x.acquisition.sources), list('UTM medium', x.acquisition.mediums)),
        tbl('Campaign performance', ['Campaign', 'Source', 'Medium', 'Sessions', 'Visitors'], x.acquisition.campaigns, (r) => [r.name, r.source, r.medium, nf.format(r.sessions), nf.format(r.visitors)])],
      technology: () => [h('div', { class: 'grid g3' }, chart('Devices', 'd', o.devices, 'donut', 'Sessions by device'), chart('Browsers', 'b', o.browsers, 'bar', 'Sessions by browser'), chart('Operating systems', 'os', o.os, 'bar', 'Sessions by OS')),
        list('Screen resolutions', x.technology.screens)],
    }[kind]();
    main.replaceChildren(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, TITLES[kind]), h('span', { class: 'muted' }, (S.sites.find((s) => s.id === S.siteId) || {}).name))), ...body);
    drawSimple(specs);
  } catch (e) {
    if (run !== S.run) return;
    main.replaceChildren(stateBox('Could not load analytics', e.message, h('button', { class: 'btn', onclick: () => renderDetail(kind) }, 'Retry')));
  }
}

async function renderWebsites() {
  const main = $('#main'), run = S.run;
  const nameIn = h('input', { id: 'w-name', placeholder: 'My Store', maxlength: 80, required: '' }), domIn = h('input', { id: 'w-domain', placeholder: 'example.com', required: '' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const list = h('div', {});
  const form = h('form', { class: 'card', novalidate: '', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; e.submitter.disabled = true;
    try {
      const w = await api('/api/websites', { method: 'POST', body: { name: nameIn.value, domain: domIn.value } });
      S.siteId = w.id; store.set('ba_site', w.id); nameIn.value = domIn.value = ''; toast('Website added');
      await loadSites(); if (run === S.run) renderWebsites();
    } catch (x) { err.textContent = x.message; } finally { e.submitter.disabled = false; }
  } }, h('h2', { style: 'margin-bottom:12px' }, 'Add a website'),
  h('div', { class: 'site-form' }, h('div', {}, h('label', { for: 'w-name' }, 'Name'), nameIn), h('div', {}, h('label', { for: 'w-domain' }, 'Domain'), domIn), h('button', { class: 'btn primary', type: 'submit' }, 'Add website')), err);
  main.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Websites')), form, list);
  try { await loadSites(); } catch (e) { return list.append(stateBox('Could not load websites', e.message, h('button', { class: 'btn', onclick: renderWebsites }, 'Retry'))); }
  if (run !== S.run) return;
  if (!S.sites.length) return list.append(stateBox('No websites yet', 'Add your first website above to get a tracking snippet.'));
  S.sites.forEach((w) => {
    const snippet = `<script src="${location.origin}/tracker.js" data-site-id="${w.site_key}" async></script>`;
    const live = w.live_events > 0;
    list.append(h('section', { class: 'card site-card' }, h('div', { class: 'site-top' },
      h('div', {}, h('h2', {}, w.name, w.is_demo ? h('span', { class: 'badge' }, 'Demo data') : null), h('div', { class: 'muted' }, w.domain),
        h('div', { class: 'status ' + (live ? 'live' : '') }, w.is_demo ? 'Demo data only' : live ? `Receiving events · last ${new Date(w.last_live_event).toLocaleString()}` : 'Waiting for first event')),
      h('div', {}, h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(snippet); toast('Snippet copied'); } catch { toast('Copy failed — select the text manually'); } } }, 'Copy snippet'), ' ',
        h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm(`Delete "${w.name}" and all of its analytics data? This cannot be undone.`)) return;
          try { await api('/api/websites/' + w.id, { method: 'DELETE' }); toast('Website removed'); await loadSites(); if (run === S.run) renderWebsites(); } catch (x) { toast(x.message); }
        } }, 'Delete'))), h('pre', {}, snippet)));
  });
}

(async () => { if (S.token) await boot(); else showAuth(); })();
