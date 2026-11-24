const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { query } = require('./db');
const auth = require('./auth');
const { parseUA, channel } = require('./ua');
const { overview } = require('./analytics');
const { details } = require('./details');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb', type: ['application/json', 'text/plain'] }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  const origin = req.headers.origin;
  const open = req.path === '/api/events/collect' || req.path === '/tracker.js';
  if (open) res.set('Access-Control-Allow-Origin', '*');
  else if (origin && origin === process.env.CLIENT_ORIGIN) res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
  res.set({ 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();
const limit = (name, max) => (req, res, next) => {
  const k = name + req.ip; const n = (hits.get(k) || 0) + 1; hits.set(k, n);
  return n > max ? res.status(429).json({ error: 'Too many requests' }) : next();
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg) => res.status(400).json({ error: msg });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v, n) => (typeof v === 'string' && v.length <= n ? v : null);

// ---- Auth ----
app.post('/api/auth/register', limit('auth', 20), wrap(async (req, res) => {
  const email = str(req.body.email, 254)?.trim().toLowerCase();
  const pw = str(req.body.password, 200);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Enter a valid email address');
  if (!pw || pw.length < 8) return bad(res, 'Password must be at least 8 characters');
  try {
    const { rows } = await query('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email', [email, auth.hashPassword(pw)]);
    res.status(201).json({ data: { token: auth.sign(rows[0].id), user: rows[0] } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An account with this email already exists' });
    throw e;
  }
}));
app.post('/api/auth/login', limit('auth', 20), wrap(async (req, res) => {
  const email = str(req.body.email, 254)?.trim().toLowerCase();
  const pw = str(req.body.password, 200);
  const { rows } = email && pw ? await query('SELECT id,email,password_hash FROM users WHERE email=$1', [email]) : { rows: [] };
  if (!rows[0] || !auth.verifyPassword(pw, rows[0].password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ data: { token: auth.sign(rows[0].id), user: { id: rows[0].id, email: rows[0].email } } });
}));
app.get('/api/auth/me', auth.requireAuth, wrap(async (req, res) => {
  const { rows } = await query('SELECT id,email FROM users WHERE id=$1', [req.userId]);
  if (!rows[0]) return res.status(401).json({ error: 'Authentication required' });
  res.json({ data: rows[0] });
}));

// ---- Websites ----
app.get('/api/websites', auth.requireAuth, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT w.id, w.name, w.domain, w.site_key, w.is_demo, w.created_at,
            (SELECT count(*) FROM events e WHERE e.website_id=w.id AND NOT e.is_demo)::int AS live_events,
            (SELECT max(created_at) FROM events e WHERE e.website_id=w.id AND NOT e.is_demo) AS last_live_event
     FROM websites w WHERE w.user_id=$1 ORDER BY w.id`, [req.userId]);
  res.json({ data: rows });
}));
app.post('/api/websites', auth.requireAuth, wrap(async (req, res) => {
  const name = str(req.body.name, 80)?.trim();
  const domain = str(req.body.domain, 253)?.trim().toLowerCase();
  if (!name) return bad(res, 'Website name is required');
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/.test(domain)) return bad(res, 'Enter a valid domain, e.g. example.com');
  const { rows } = await query(
    'INSERT INTO websites(user_id,name,domain,site_key) VALUES($1,$2,$3,$4) RETURNING id,name,domain,site_key,is_demo,created_at',
    [req.userId, name, domain, crypto.randomBytes(9).toString('base64url')]);
  res.status(201).json({ data: { ...rows[0], live_events: 0, last_live_event: null } });
}));
app.delete('/api/websites/:id', auth.requireAuth, wrap(async (req, res) => {
  const r = await query('DELETE FROM websites WHERE id=$1 AND user_id=$2', [+req.params.id || 0, req.userId]);
  if (!r.rowCount) return res.status(404).json({ error: 'Website not found' });
  res.json({ data: { deleted: true } });
}));

// ---- Ingestion (public, rate limited) ----
app.post('/api/events/collect', limit('collect', 600), wrap(async (req, res) => {
  const b = req.body || {};
  const site = str(b.siteKey, 64), name = str(b.name, 100), p = str(b.path, 2000), url = str(b.url, 2048);
  if (!site || !name || !p || !p.startsWith('/') || !url) return bad(res, 'Invalid event');
  if (!UUID.test(b.vid) || !UUID.test(b.sid)) return bad(res, 'Invalid identifiers');
  if (!['pageview', 'event'].includes(b.type)) return bad(res, 'Invalid event type');
  let props = {};
  if (b.props && typeof b.props === 'object' && !Array.isArray(b.props)) {
    const s = JSON.stringify(b.props);
    if (s.length > 2048) return bad(res, 'Event properties too large');
    props = JSON.parse(s);
  }
  const w = (await query('SELECT id, domain, is_demo FROM websites WHERE site_key=$1', [site])).rows[0];
  if (!w || w.is_demo) return res.status(404).json({ error: 'Unknown site' });
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let host = ''; try { host = new URL(origin).hostname; } catch { /* bad origin */ }
    if (host !== w.domain && !host.endsWith('.' + w.domain)) return res.status(403).json({ error: 'Origin not allowed for this site' });
  }
  if (!w) return res.status(404).json({ error: 'Unknown site' });
  const { browser, os, device } = parseUA(req.headers['user-agent']);
  const ch = channel({ referrer: str(b.ref, 2048), utmMedium: str(b.utm_medium, 100), pageUrl: url });
  await query('INSERT INTO visitors(website_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING', [w.id, b.vid]);
  await query(
    `INSERT INTO sessions(website_id,id,visitor_id,referrer,channel,utm_source,utm_medium,utm_campaign,device,browser,os,screen)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (website_id,id) DO UPDATE SET last_seen_at=now()`,
    [w.id, b.sid, b.vid, str(b.ref, 2048), ch, str(b.utm_source, 100), str(b.utm_medium, 100), str(b.utm_campaign, 100), device, browser, os, str(b.screen, 20)]);
  await query(
    'INSERT INTO events(website_id,session_id,visitor_id,type,name,url,path,title,props) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [w.id, b.sid, b.vid, b.type, name, url, p, str(b.title, 300), props]);
  res.status(202).json({ data: { ok: true } });
}));

// ---- Analytics (owner only) ----
app.get('/api/analytics/overview', auth.requireAuth, wrap(async (req, res) => {
  const wid = +req.query.websiteId;
  const own = wid && (await query('SELECT 1 FROM websites WHERE id=$1 AND user_id=$2', [wid, req.userId])).rowCount;
  if (!own) return res.status(404).json({ error: 'Website not found' });
  res.json({ data: await overview(wid, req.query) });
}));

app.get('/api/analytics/details', auth.requireAuth, wrap(async (req, res) => {
  const wid = +req.query.websiteId;
  const own = wid && (await query('SELECT 1 FROM websites WHERE id=$1 AND user_id=$2', [wid, req.userId])).rowCount;
  if (!own) return res.status(404).json({ error: 'Website not found' });
  res.json({ data: await details(wid, req.query) });
}));


app.get('/api/openapi.json', (req, res) => res.json(require('./openapi')));
app.get('/api/docs', (req, res) => res.type('html').send(`<!doctype html><title>Pulse API docs</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"><div id="ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#ui'})</script>`));
app.get('/tracker.js', (req, res) => { res.set('Cache-Control', 'public, max-age=3600'); res.sendFile(path.join(__dirname, '../../tracker/analytics.js')); });
app.use(express.static(path.join(__dirname, '../../client')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(JSON.stringify({ level: 'error', msg: err.message, path: req.path }));
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});
module.exports = app;
