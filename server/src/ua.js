function parseUA(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const device = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet'
    : /Mobi|iPhone|Android/.test(ua) ? 'mobile' : 'desktop';
  return { browser, os, device };
}
const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|ecosia|yandex)\./i;
const SOCIAL = /(^|\.)(facebook|instagram|twitter|x|t|linkedin|reddit|youtube|pinterest|tiktok)\.(com|co)$/i;
function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }
function channel({ referrer, utmMedium, pageUrl }) {
  const m = (utmMedium || '').toLowerCase();
  if (/^(cpc|ppc|paid|display)/.test(m)) return 'paid';
  if (m === 'email') return 'email';
  if (m === 'social') return 'social';
  if (m === 'organic') return 'organic';
  const r = hostOf(referrer);
  if (!r || r === hostOf(pageUrl)) return 'direct';
  if (SEARCH.test(r)) return 'organic';
  if (SOCIAL.test(r)) return 'social';
  return 'referral';
}
module.exports = { parseUA, channel };
