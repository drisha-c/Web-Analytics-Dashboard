// End-to-end tests against the real database configured in .env. Test users are removed afterwards.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { pool } = require('../src/db');
const app = require('../src/app');

const tag = Date.now();
const A = { email: `qa-a-${tag}@test.local`, password: 'password123' };
const B = { email: `qa-b-${tag}@test.local`, password: 'password123' };
const domain = `qa-${tag}.example.com`;
let base, server, tokA, tokB, site;
const vid = crypto.randomUUID(), sid = crypto.randomUUID();

async function call(path, { method = 'GET', token, body, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
}
const ev = (o = {}) => ({ siteKey: site.site_key, vid, sid, type: 'pageview', name: 'pageview', url: `https://${domain}/`, path: '/', title: 'Home', ...o });

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  server.close();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`qa-%-${tag}@test.local`]);
  await pool.end();
});

test('registration, duplicate and weak password', async () => {
  const a = await call('/api/auth/register', { method: 'POST', body: A });
  assert.strictEqual(a.status, 201); tokA = a.body.data.token;
  const b = await call('/api/auth/register', { method: 'POST', body: B });
  assert.strictEqual(b.status, 201); tokB = b.body.data.token;
  assert.strictEqual((await call('/api/auth/register', { method: 'POST', body: A })).status, 409);
  assert.strictEqual((await call('/api/auth/register', { method: 'POST', body: { email: 'x@y.co', password: 'short' } })).status, 400);
});
test('login and auth protection', async () => {
  assert.strictEqual((await call('/api/auth/login', { method: 'POST', body: { ...A, password: 'wrongpass1' } })).status, 401);
  assert.strictEqual((await call('/api/auth/login', { method: 'POST', body: A })).status, 200);
  assert.strictEqual((await call('/api/websites')).status, 401);
  assert.strictEqual((await call('/api/websites', { token: 'garbage.token' })).status, 401);
  assert.strictEqual((await call('/api/auth/me', { token: tokA })).body.data.email, A.email);
});
test('website creation and validation', async () => {
  assert.strictEqual((await call('/api/websites', { method: 'POST', token: tokA, body: { name: 'X', domain: 'not a domain' } })).status, 400);
  const r = await call('/api/websites', { method: 'POST', token: tokA, body: { name: 'QA Site', domain } });
  assert.strictEqual(r.status, 201); site = r.body.data;
  assert.ok(site.site_key.length >= 12);
});
test('ingestion validation and origin check', async () => {
  assert.strictEqual((await call('/api/events/collect', { method: 'POST', body: ev({ vid: 'nope' }) })).status, 400);
  assert.strictEqual((await call('/api/events/collect', { method: 'POST', body: ev({ type: 'bogus' }) })).status, 400);
  assert.strictEqual((await call('/api/events/collect', { method: 'POST', body: ev({ siteKey: 'unknown-key' }) })).status, 404);
  assert.strictEqual((await call('/api/events/collect', { method: 'POST', body: ev(), headers: { Origin: 'https://evil.example.net' } })).status, 403);
  assert.strictEqual((await call('/api/events/collect', { method: 'POST', body: ev(), headers: { Origin: `https://www.${domain}` } })).status, 202);
  assert.strictEqual((await call('/api/events/collect', { method: 'POST', body: ev({ path: '/pricing', url: `https://${domain}/pricing` }) })).status, 202);
  assert.strictEqual((await call('/api/events/collect', { method: 'POST', body: ev({ type: 'event', name: 'signup_click', props: { plan: 'pro' } }) })).status, 202);
});
test('events are stored in PostgreSQL', async () => {
  const { rows } = await pool.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE type=$2)::int AS pv FROM events WHERE website_id=$1', [site.id, 'pageview']);
  assert.deepStrictEqual(rows[0], { n: 3, pv: 2 });
});
test('overview aggregation is correct', async () => {
  const r = await call(`/api/analytics/overview?websiteId=${site.id}`, { token: tokA });
  assert.strictEqual(r.status, 200);
  const k = r.body.data.kpis;
  assert.strictEqual(k.visitors, 1); assert.strictEqual(k.sessions, 1); assert.strictEqual(k.pageviews, 2); assert.strictEqual(k.bounceRate, 0);
  assert.strictEqual(r.body.data.recent.length, 3);
  assert.deepStrictEqual(r.body.data.pages.map((p) => p.path).sort(), ['/', '/pricing']);
  const d = await call(`/api/analytics/details?websiteId=${site.id}`, { token: tokA });
  assert.strictEqual(d.body.data.events.custom, 1);
});
test('date range filtering', async () => {
  const past = await call(`/api/analytics/overview?websiteId=${site.id}&startDate=2020-01-01&endDate=2020-01-07`, { token: tokA });
  assert.strictEqual(past.body.data.kpis.pageviews, 0);
  assert.strictEqual(past.body.data.series.length, 7);
  assert.strictEqual((await call(`/api/analytics/overview?websiteId=${site.id}&startDate=2026-02-01&endDate=2026-01-01`, { token: tokA })).status, 400);
});
test('another user cannot access this website', async () => {
  assert.strictEqual((await call(`/api/analytics/overview?websiteId=${site.id}`, { token: tokB })).status, 404);
  assert.strictEqual((await call(`/api/analytics/details?websiteId=${site.id}`, { token: tokB })).status, 404);
  assert.strictEqual((await call('/api/websites', { token: tokB })).body.data.length, 0);
  assert.strictEqual((await call(`/api/websites/${site.id}`, { method: 'DELETE', token: tokB })).status, 404);
});
test('deleting a website removes its events', async () => {
  assert.strictEqual((await call(`/api/websites/${site.id}`, { method: 'DELETE', token: tokA })).status, 200);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM events WHERE website_id=$1', [site.id]);
  assert.strictEqual(rows[0].n, 0);
});
