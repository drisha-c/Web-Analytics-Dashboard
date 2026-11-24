Pulse: Web Analytics Platform

Built by Drisha C · github.com/drisha-c

A self-hosted web analytics tool. A small JavaScript snippet collects visits and events from any website, an Express API stores them in PostgreSQL, and a dashboard turns them into charts and tables.

What it does
Tracker (about 4 KB): page views, single-page-app navigation, click tracking, custom events, sessions, referrers, UTM campaigns, device, browser and OS. No cookies, never reads form fields, honours Do Not Track.
Dashboard: Overview, Audience, Pages, Events, Acquisition, Technology and Websites. Loading, empty and error states, responsive layout, keyboard-accessible, light and dark.
Accounts: registration and login with scrypt password hashing and signed tokens. Each user only sees their own websites.
Data: every number comes from SQL aggregation in PostgreSQL. Demo data is flagged separately from live events.
API docs: Swagger UI at /api/docs.
Tech stack

JavaScript, HTML5, CSS3, Chart.js, Node.js, Express, PostgreSQL. Only two runtime dependencies (express, pg).

Project structure
client/      dashboard (index.html, styles.css, app.js)
tracker/     analytics.js, the script websites include
server/src/  app.js, auth.js, db.js, analytics.js, details.js, ua.js, daterange.js, openapi.js, migrate.js, seed.js
server/test/ unit and end-to-end tests
migrations/  SQL schema
Setup

Requires Node 22.9+ and PostgreSQL 14+.

bash
npm install
# copy .env.example to .env, then set DATABASE_URL and JWT_SECRET
# generate a secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run migrate
npm run seed      # optional: demo account demo@example.com / demo12345 with 30 days of demo data
npm start         # http://localhost:3000
npm test

Windows: use copy .env.example .env instead of cp.

Using the tracker

Add a website under Websites, copy its snippet into your site:

html
<script src="https://YOUR-HOST/tracker.js" data-site-id="SITE_KEY" async></script>

Custom events:

js
Analytics.track('button_clicked', { button_name: 'Get Started', location: 'homepage' });

Or add data-analytics-event="name" to any element to track its clicks. Visitors can opt out with Do Not Track or localStorage['analytics-optout'] = '1'.

API

Interactive docs at /api/docs. Responses are { "data": ... } or { "error": "..." }. Endpoints: auth (register, login, me), websites (list, add, delete), POST /api/events/collect, GET /api/analytics/overview and /details with websiteId, startDate, endDate.

Testing

npm test runs 13 tests against the configured database: registration and login, authorization, website creation, event ingestion and origin checking, storage in PostgreSQL, aggregation maths, date-range filtering, isolation between users, and cascade deletion. The tracker was also checked in headless Chromium.

Deployment

Host the whole app on a Node service with a managed PostgreSQL database. Set DATABASE_URL, JWT_SECRET, NODE_ENV=production, and PGSSL=true if the database requires it, then run npm run migrate once. I haven't deployed it yet, so this part is untested. A serverless host isn't a good fit for the ingestion API.

Known limitations
Rate limiting is in memory, so it resets on restart and isn't shared across servers.
Login tokens are stored in the browser and logging out doesn't revoke them server-side.
The site key is public by design; the origin check stops other domains from posting events, but a script can still fake the header.
Not built yet: sparklines, time on page, event filtering and detail view, batch ingestion, geographic data.