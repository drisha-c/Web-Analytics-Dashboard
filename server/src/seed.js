// Creates a demo account + website with 30 days of synthetic traffic, all flagged is_demo.
const crypto = require('crypto');
const { pool } = require('./db');
const { hashPassword } = require('./auth');

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to seed demo data in production.'); process.exit(1);
}


const EMAIL = 'demo@example.com', PASSWORD = 'demo12345', DAYS = 30;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const wpick = (pairs) => { let r = Math.random() * pairs.reduce((a, p) => a + p[1], 0); for (const [v, w] of pairs) if ((r -= w) < 0) return v; return pairs[0][0]; };
const PAGES = [['/', 'Home', 30], ['/pricing', 'Pricing', 14], ['/blog/getting-started', 'Getting started', 12], ['/features', 'Features', 12], ['/docs', 'Documentation', 10], ['/about', 'About', 5], ['/contact', 'Contact', 4], ['/blog/analytics-101', 'Analytics 101', 8]];
const CHANNELS = [['direct', 34], ['organic', 28], ['social', 14], ['referral', 10], ['email', 8], ['paid', 6]];
const DEVICES = [['desktop', 54], ['mobile', 38], ['tablet', 8]];
const BROWSERS = { desktop: [['Chrome', 60], ['Safari', 15], ['Firefox', 12], ['Edge', 13]], mobile: [['Chrome', 50], ['Safari', 45], ['Firefox', 5]], tablet: [['Safari', 70], ['Chrome', 30]] };
const OSES = { desktop: [['Windows', 50], ['macOS', 38], ['Linux', 12]], mobile: [['Android', 58], ['iOS', 42]], tablet: [['iOS', 70], ['Android', 30]] };
const SCREENS = { desktop: ['1920x1080', '1440x900', '2560x1440'], mobile: ['390x844', '412x915'], tablet: ['820x1180'] };
const CAMPAIGNS = { paid: [['google', 'cpc', 'spring_sale'], ['bing', 'cpc', 'brand_search']], email: [['newsletter', 'email', 'weekly_digest']], social: [['linkedin', 'social', 'launch_post']] };
const REFS = { organic: 'https://www.google.com/', social: 'https://t.co/x', referral: 'https://news.ycombinator.com/' };

(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let u = (await c.query('SELECT id FROM users WHERE email=$1', [EMAIL])).rows[0];
    if (!u) u = (await c.query('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id', [EMAIL, hashPassword(PASSWORD)])).rows[0];
    await c.query('DELETE FROM websites WHERE user_id=$1 AND is_demo', [u.id]);
    const w = (await c.query('INSERT INTO websites(user_id,name,domain,site_key,is_demo) VALUES($1,$2,$3,$4,true) RETURNING id',
      [u.id, 'Demo Store', 'demo.example.com', 'demo-' + crypto.randomBytes(5).toString('hex')])).rows[0];

    const pool_ = Array.from({ length: 700 }, () => crypto.randomUUID());
    const seen = new Set();
    const S = { id: [], vid: [], at: [], ref: [], ch: [], us: [], um: [], uc: [], dev: [], br: [], os: [], scr: [] };
    const E = { sid: [], vid: [], type: [], name: [], path: [], title: [], at: [] };
    const now = Date.now();
    for (let d = DAYS - 1; d >= 0; d--) {
      const day = new Date(now - d * 86400000); day.setUTCHours(0, 0, 0, 0);
      const growth = 1 + (DAYS - d) / DAYS * 0.5, weekend = [0, 6].includes(day.getUTCDay()) ? 0.65 : 1;
      const n = Math.round((45 + Math.random() * 25) * growth * weekend);
      for (let i = 0; i < n; i++) {
        const sid = crypto.randomUUID(), vid = pick(pool_);
        seen.add(vid);
        const start = day.getTime() + Math.random() * (d === 0 ? (now - day.getTime()) : 86400000);
        const ch = wpick(CHANNELS), dev = wpick(DEVICES), camp = CAMPAIGNS[ch] ? pick(CAMPAIGNS[ch]) : [null, null, null];
        S.id.push(sid); S.vid.push(vid); S.at.push(new Date(start).toISOString()); S.ref.push(REFS[ch] || null); S.ch.push(ch);
        S.us.push(camp[0]); S.um.push(camp[1]); S.uc.push(camp[2]); S.dev.push(dev);
        S.br.push(wpick(BROWSERS[dev])); S.os.push(wpick(OSES[dev])); S.scr.push(pick(SCREENS[dev]));
        const views = wpick([[1, 38], [2, 26], [3, 18], [4, 10], [5, 8]]);
        let t = start;
        for (let v = 0; v < views; v++) {
          const [path, title] = v === 0 && Math.random() < 0.5 ? PAGES[0] : wpick(PAGES.map((x) => [x, x[2]]));
          E.sid.push(sid); E.vid.push(vid); E.type.push('pageview'); E.name.push('pageview'); E.path.push(path); E.title.push(title); E.at.push(new Date(t).toISOString());
          if (Math.random() < 0.18) { t += 4000; E.sid.push(sid); E.vid.push(vid); E.type.push('event'); E.name.push(pick(['signup_click', 'add_to_cart', 'newsletter_signup', 'download_clicked'])); E.path.push(path); E.title.push(title); E.at.push(new Date(t).toISOString()); }
          t += 15000 + Math.random() * 90000;
        }
      }
    }
    await c.query('INSERT INTO visitors(website_id,id) SELECT $1::bigint, unnest($2::uuid[])', [w.id, [...seen]]);
    await c.query(`INSERT INTO sessions(website_id,id,visitor_id,started_at,last_seen_at,referrer,channel,utm_source,utm_medium,utm_campaign,device,browser,os,screen)
      SELECT $1::bigint, id, vid, at, at, ref, ch, us, um, uc, dev, br, os, scr
      FROM unnest($2::uuid[],$3::uuid[],$4::timestamptz[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::text[],$11::text[],$12::text[],$13::text[])
      AS t(id,vid,at,ref,ch,us,um,uc,dev,br,os,scr)`,
      [w.id, S.id, S.vid, S.at, S.ref, S.ch, S.us, S.um, S.uc, S.dev, S.br, S.os, S.scr]);
    await c.query(`INSERT INTO events(website_id,session_id,visitor_id,type,name,path,title,created_at,is_demo)
      SELECT $1::bigint, sid, vid, type, name, path, title, at, true
      FROM unnest($2::uuid[],$3::uuid[],$4::text[],$5::text[],$6::text[],$7::text[],$8::timestamptz[]) AS t(sid,vid,type,name,path,title,at)`,
      [w.id, E.sid, E.vid, E.type, E.name, E.path, E.title, E.at]);
    await c.query('COMMIT');
    console.log(`Seeded ${S.id.length} sessions and ${E.sid.length} events. Login: ${EMAIL} / ${PASSWORD}`);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); await pool.end(); }
})().catch((e) => { console.error(e); process.exit(1); });
