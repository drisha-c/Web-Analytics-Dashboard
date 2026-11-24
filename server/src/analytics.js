const { query } = require('./db');
const { parseRange } = require('./daterange');

async function kpis(wid, from, to) {
  const { rows } = await query(
    `WITH s AS (
       SELECT session_id, visitor_id,
              count(*) FILTER (WHERE type='pageview') AS pv,
              extract(epoch FROM max(created_at) - min(created_at)) AS dur
       FROM events WHERE website_id=$1 AND created_at>=$2::timestamptz AND created_at<$3::timestamptz
       GROUP BY session_id, visitor_id)
     SELECT count(DISTINCT visitor_id)::int AS visitors,
            count(*)::int AS sessions,
            coalesce(sum(pv),0)::int AS pageviews,
            coalesce(avg(dur),0)::float AS avg_duration,
            coalesce(avg((pv=1)::int) FILTER (WHERE pv>=1),0)::float AS bounce_rate
     FROM s`, [wid, from, to]);
  const r = rows[0];
  return { visitors: r.visitors, sessions: r.sessions, pageviews: r.pageviews, avgDuration: r.avg_duration, bounceRate: r.bounce_rate * 100 };
}
const DIMS = { channel: 1, device: 1, browser: 1, os: 1 };
async function dim(wid, col, from, to) {
  if (!DIMS[col]) throw new Error('bad dimension');
  const { rows } = await query(
    `SELECT ${col} AS name, count(*)::int AS value FROM sessions
     WHERE website_id=$1 AND started_at>=$2::timestamptz AND started_at<$3::timestamptz
     GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [wid, from, to]);
  return rows;
}
async function overview(wid, q) {
  const r = parseRange(q);
  const [cur, prev, series, pages, channels, devices, browsers, os, recent] = await Promise.all([
    kpis(wid, r.from, r.to), kpis(wid, r.prevFrom, r.prevTo),
    query(`SELECT to_char(g.d,'YYYY-MM-DD') AS day,
                  count(DISTINCT e.visitor_id)::int AS visitors,
                  count(e.id) FILTER (WHERE e.type='pageview')::int AS pageviews,
                  count(DISTINCT e.session_id)::int AS sessions
           FROM generate_series($2::date, $3::date - 1, interval '1 day') g(d)
           LEFT JOIN events e ON e.website_id=$1 AND e.created_at>=g.d AND e.created_at<g.d + interval '1 day'
           GROUP BY g.d ORDER BY g.d`, [wid, r.from, r.to]),
    query(`SELECT path, max(title) AS title, count(*)::int AS views, count(DISTINCT visitor_id)::int AS visitors
           FROM events WHERE website_id=$1 AND type='pageview' AND created_at>=$2::timestamptz AND created_at<$3::timestamptz
           GROUP BY path ORDER BY views DESC LIMIT 10`, [wid, r.from, r.to]),
    dim(wid, 'channel', r.from, r.to), dim(wid, 'device', r.from, r.to),
    dim(wid, 'browser', r.from, r.to), dim(wid, 'os', r.from, r.to),
    query(`SELECT e.name, e.type, e.path, e.created_at, e.is_demo, left(e.session_id::text, 8) AS session, s.device
           FROM events e JOIN sessions s ON s.website_id=e.website_id AND s.id=e.session_id
           WHERE e.website_id=$1 ORDER BY e.created_at DESC LIMIT 12`, [wid]),
  ]);
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
  const change = {};
  for (const k of Object.keys(cur)) change[k] = pct(cur[k], prev[k]);
  return {
    range: { startDate: r.from, endDate: r.to, days: r.days },
    kpis: cur, previous: prev, change, series: series.rows,
    pages: pages.rows.map((p) => ({ ...p, share: cur.pageviews ? (p.views / cur.pageviews) * 100 : 0 })),
    channels, devices, browsers, os, recent: recent.rows,
  };
}
module.exports = { overview };
