const { query } = require('./db');
const { parseRange } = require('./daterange');

const T = 'created_at>=$2::timestamptz AND created_at<$3::timestamptz';
const ST = 'started_at>=$2::timestamptz AND started_at<$3::timestamptz';
const COLS = { referrer: 1, utm_source: 1, utm_medium: 1, screen: 1 };

async function sessionDim(wid, col, r, limit = 10) {
  if (!COLS[col]) throw new Error('bad dimension');
  const expr = col === 'referrer' ? "regexp_replace(referrer,'^https?://([^/]+).*$','\\1')" : col;
  const { rows } = await query(
    `SELECT coalesce(nullif(${expr},''),'(none)') AS name, count(*)::int AS value FROM sessions
     WHERE website_id=$1 AND ${ST} GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`, [wid, r.from, r.to]);
  return rows;
}
async function pagesAt(wid, r, dir) {
  if (!['ASC', 'DESC'].includes(dir)) throw new Error('bad dir');
  const { rows } = await query(
    `SELECT path AS name, count(*)::int AS value
     FROM (SELECT DISTINCT ON (session_id) path FROM events
           WHERE website_id=$1 AND type='pageview' AND ${T} ORDER BY session_id, created_at ${dir}) t
     GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [wid, r.from, r.to]);
  return rows;
}

async function timeOnPage(wid, r) {
  const { rows } = await query(
    `SELECT path, avg(dur)::float AS avg_time FROM (
       SELECT path, type,
              extract(epoch FROM lead(created_at) OVER (PARTITION BY session_id ORDER BY created_at) - created_at) AS dur
       FROM events WHERE website_id=$1 AND ${T}) t
     WHERE type='pageview' AND dur IS NOT NULL AND dur < 1800 GROUP BY path`, [wid, r.from, r.to]);
  return rows;
}

async function details(wid, q) {
  const r = parseRange(q), p = [wid, r.from, r.to];
  const [nr, dur, least, entry, exit, evNames, evTotal, campaigns, referrers, sources, mediums, screens] = await Promise.all([
    query(`WITH s AS (SELECT visitor_id, count(*) AS n FROM sessions WHERE website_id=$1 AND ${ST} GROUP BY 1),
                f AS (SELECT visitor_id, min(started_at) AS first FROM sessions WHERE website_id=$1 GROUP BY 1)
           SELECT count(*) FILTER (WHERE f.first < $2::timestamptz OR s.n > 1)::int AS ret,
                  count(*) FILTER (WHERE NOT (f.first < $2::timestamptz OR s.n > 1))::int AS fresh
           FROM s JOIN f USING (visitor_id)`, p),
    query(`WITH d AS (SELECT extract(epoch FROM max(created_at)-min(created_at)) AS dur FROM events
                      WHERE website_id=$1 AND ${T} GROUP BY session_id)
           SELECT CASE WHEN dur<10 THEN '0-10s' WHEN dur<30 THEN '10-30s' WHEN dur<60 THEN '30-60s'
                       WHEN dur<180 THEN '1-3 min' WHEN dur<600 THEN '3-10 min' ELSE '10+ min' END AS name,
                  count(*)::int AS value
           FROM d GROUP BY 1 ORDER BY min(dur)`, p),
    query(`SELECT path, count(*)::int AS views, count(DISTINCT visitor_id)::int AS visitors FROM events
           WHERE website_id=$1 AND type='pageview' AND ${T} GROUP BY path ORDER BY views ASC, path LIMIT 10`, p),
    pagesAt(wid, r, 'ASC'), pagesAt(wid, r, 'DESC'),
    query(`SELECT name, count(*)::int AS value FROM events WHERE website_id=$1 AND type='event' AND ${T}
           GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, p),
    query(`SELECT count(*) FILTER (WHERE type='event')::int AS custom, count(*)::int AS total FROM events
           WHERE website_id=$1 AND ${T}`, p),
    query(`SELECT utm_campaign AS name, coalesce(nullif(utm_source,''),'(none)') AS source, coalesce(nullif(utm_medium,''),'(none)') AS medium,
                  count(*)::int AS sessions, count(DISTINCT visitor_id)::int AS visitors FROM sessions
           WHERE website_id=$1 AND ${ST} AND coalesce(utm_campaign,'')<>'' GROUP BY 1,2,3 ORDER BY sessions DESC LIMIT 10`, p),
    sessionDim(wid, 'referrer', r), sessionDim(wid, 'utm_source', r), sessionDim(wid, 'utm_medium', r), sessionDim(wid, 'screen', r),
  ]);
  return {
    audience: { returning: nr.rows[0]?.ret || 0, fresh: nr.rows[0]?.fresh || 0, durations: dur.rows },
    pages: { least: least.rows, entry, exit, time: await timeOnPage(wid, r) },
    events: { names: evNames.rows, total: evTotal.rows[0].total, custom: evTotal.rows[0].custom },
    acquisition: { referrers, sources, mediums, campaigns: campaigns.rows },
    technology: { screens },
  };
}
module.exports = { details };