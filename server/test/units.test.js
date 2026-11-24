const test = require('node:test');
const assert = require('node:assert');
const { parseUA, channel } = require('../src/ua');
const { parseRange } = require('../src/daterange');

test('parseUA detects browser/os/device', () => {
  const p = parseUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  assert.deepStrictEqual(p, { browser: 'Safari', os: 'iOS', device: 'mobile' });
  assert.strictEqual(parseUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120').browser, 'Edge');
  assert.strictEqual(parseUA('Mozilla/5.0 (Linux; Android 13; Tab) Chrome/120 Safari/537').device, 'tablet');
});
test('channel classification', () => {
  const page = 'https://site.com/';
  assert.strictEqual(channel({ referrer: '', pageUrl: page }), 'direct');
  assert.strictEqual(channel({ referrer: 'https://site.com/a', pageUrl: page }), 'direct');
  assert.strictEqual(channel({ referrer: 'https://www.google.com/', pageUrl: page }), 'organic');
  assert.strictEqual(channel({ referrer: 'https://t.co/x', pageUrl: page }), 'social');
  assert.strictEqual(channel({ referrer: 'https://blog.example.org', pageUrl: page }), 'referral');
  assert.strictEqual(channel({ referrer: '', utmMedium: 'cpc', pageUrl: page }), 'paid');
  assert.strictEqual(channel({ referrer: '', utmMedium: 'email', pageUrl: page }), 'email');
});
test('parseRange is inclusive with an equal previous period', () => {
  const r = parseRange({ startDate: '2026-11-01', endDate: '2026-11-07' });
  assert.deepStrictEqual(r, { from: '2026-11-01', to: '2026-11-08', prevFrom: '2026-10-25', prevTo: '2026-11-01', days: 7 });
});
test('parseRange rejects bad input', () => {
  assert.throws(() => parseRange({ startDate: '2026-11-09', endDate: '2026-11-01' }), /Invalid/);
  assert.throws(() => parseRange({ startDate: '2020-01-01', endDate: '2026-11-01' }), /366/);
});
