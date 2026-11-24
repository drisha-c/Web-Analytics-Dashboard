/*! Web Analytics tracker — no cookies, no form data. */
(function () {
  'use strict';
  var s = document.currentScript;
  var key = s && s.getAttribute('data-site-id');
  if (!key || window.Analytics) return;
  var api = (s.getAttribute('data-api') || new URL(s.src).origin) + '/api/events/collect';
  var clickAttr = s.getAttribute('data-click-attr') || 'data-analytics-event';
  var MAX = 200, count = 0, queue = [], last = {};

  function get(st, k) { try { return window[st].getItem(k); } catch (e) { return null; } }
  function set(st, k, v) { try { window[st].setItem(k, v); } catch (e) { /* storage blocked */ } }
  function optedOut() {
    return navigator.doNotTrack === '1' || window.doNotTrack === '1' || get('localStorage', 'analytics-optout') === '1' || window.AnalyticsOptOut === true;
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
  }
  var vid = get('localStorage', 'ba_vid');
  if (!vid) { vid = uuid(); set('localStorage', 'ba_vid', vid); }

  // Session: rolls over after 30 minutes of inactivity; keeps first referrer + UTM for attribution.
  function session() {
    var cur; try { cur = JSON.parse(get('localStorage', 'ba_sess')); } catch (e) { cur = null; }
    var now = Date.now();
    if (!cur || now - cur.t > 30 * 60 * 1000) {
      var q = new URLSearchParams(location.search), ref = document.referrer;
      cur = { id: uuid(), ref: ref && ref.indexOf(location.origin) !== 0 ? ref : '', src: q.get('utm_source') || '', med: q.get('utm_medium') || '', cmp: q.get('utm_campaign') || '' };
    }
    cur.t = now; set('localStorage', 'ba_sess', JSON.stringify(cur));
    return cur;
  }
  function clean(p) {
    var o = {}, n = 0;
    if (p && typeof p === 'object') for (var k in p) {
      if (n >= 20 || !Object.prototype.hasOwnProperty.call(p, k)) continue;
      var v = p[k];
      if (typeof v === 'string') o[k.slice(0, 50)] = v.slice(0, 200), n++;
      else if (typeof v === 'number' || typeof v === 'boolean') o[k.slice(0, 50)] = v, n++;
    }
    return o;
  }
  function post(body) {
    return fetch(api, { method: 'POST', body: JSON.stringify(body), keepalive: true, headers: { 'Content-Type': 'text/plain' } })
      .then(function (r) { if (r.status >= 500 || r.status === 429) throw new Error('retry'); });
  }
  function flush() {
    var batch = queue.splice(0, queue.length);
    batch.forEach(function (b) { post(b).catch(function () { if (queue.length < 20) queue.push(b); }); });
  }
  function send(type, name, props) {
    if (optedOut() || count >= MAX) return;
    var sig = type + name + location.pathname, now = Date.now();
    if (type === 'pageview' && last[sig] && now - last[sig] < 500) return; // duplicate guard
    last[sig] = now; count++;
    var se = session();
    var b = { siteKey: key, vid: vid, sid: se.id, type: type, name: name, url: location.href.split('#')[0], path: location.pathname,
      title: document.title.slice(0, 300), ref: se.ref, utm_source: se.src, utm_medium: se.med, utm_campaign: se.cmp,
      screen: screen.width + 'x' + screen.height, props: clean(props) };
    queue.push(b); flush();
  }
  function pageview() { send('pageview', 'pageview'); }

  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); setTimeout(pageview, 0); return r; };
  });
  window.addEventListener('popstate', function () { setTimeout(pageview, 0); });
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[' + clickAttr + ']');
    if (el) send('event', el.getAttribute(clickAttr), { tag: el.tagName.toLowerCase() });
  }, true);
  window.addEventListener('online', flush);

  window.Analytics = { track: function (name, props) { if (typeof name === 'string' && name) send('event', name.slice(0, 100), props); } };
  pageview();
})();
