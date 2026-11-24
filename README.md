# Pulse — Web Analytics Platform

Self-hosted web analytics: a tiny tracking script, an Express + PostgreSQL backend, and a dashboard (vanilla JS + Chart.js).
Only two runtime dependencies: `express` and `pg`. Passwords use scrypt and sessions use HMAC-signed tokens from Node's `crypto`.

## Status — read this first
Built and checked in a sandbox with **no network and no PostgreSQL**, so the server and database path has **not been run**.

| Verified | Not verified (run these yourself) |
|---|---|
| Syntax of all JS files | `npm install`, server startup |
| Unit tests: UA parsing, channel classification, date ranges (`npm test`) | Migration and seed against a real Postgres |
| Tracker in real Chromium: pageview, click, custom event, SPA nav, dedupe, retry after 503, UTM, opt-out, no form data | SQL queries, auth flow, ingestion, data isolation |
| | Dashboard rendering against live API (incl. Chart.js CDN) |

## Quick start
Requires Node >= 22.9 and PostgreSQL 14+.
```bash
npm install
cp .env.example .env          # set DATABASE_URL and JWT_SECRET (openssl rand -hex 32)
createdb webanalytics
npm run migrate
npm run seed                  # demo@example.com / demo12345 + 30 days of demo data (flagged is_demo)
npm start                     # http://localhost:3000
npm test
```
The server serves the dashboard (`client/`) and the tracker (`/tracker.js`) from one origin.

## Install the tracker
Add a website under **Websites**, then paste its snippet into your site:
```html
<script src="https://YOUR-HOST/tracker.js" data-site-id="SITE_KEY" async></script>
```
```js
Analytics.track('button_clicked', { button_name: 'Get Started', location: 'homepage' });
```
Add `data-analytics-event="name"` to any element to track its clicks. Opt-out: Do Not Track, `localStorage['analytics-optout']='1'`, or `window.AnalyticsOptOut=true`.
The tracker uses no cookies, never reads form fields, drops nested/non-primitive properties, and caps events per page load.

## API (all responses `{data}` or `{error}`)
`POST /api/auth/register|login` · `GET /api/auth/me` · `GET|POST /api/websites` · `DELETE /api/websites/:id` ·
`POST /api/events/collect` (public, rate-limited) · `GET /api/analytics/overview?websiteId&startDate&endDate` (UTC, inclusive).
Analytics are owner-only; other users get 404.

## Deployment
Host the whole app on a Node host with managed Postgres (Render, Railway, Fly). Set `DATABASE_URL`, `JWT_SECRET`, `PGSSL=true` if required, then run `npm run migrate`.
Serverless (Vercel) is a poor fit for the ingestion API (connection pooling, burst writes), so it is not configured. To host the dashboard separately, set `window.API_BASE` before `app.js` loads and `CLIENT_ORIGIN` on the server.

## Known limitations
- Dashboard has Overview and Websites only. Audience/Pages/Events/Acquisition/Technology pages, sparklines and time-on-page are not built.
- No Swagger UI, no `/events/batch`, no DB integration or API tests, no Vercel config.
- Rate limiting is in-memory per process; use a shared store when running multiple instances.
- Tokens live in `localStorage` and logout is client-side (stateless token, 7-day expiry).
- Collect does not check the request Origin against the site's domain, so the site key is not a secret.
- Geographic data is not collected.
