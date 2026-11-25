const json = (schema) => ({ 'application/json': { schema } });
const ok = (description, code = 200) => ({ [code]: { description, content: json({ type: 'object', properties: { data: { type: 'object' } } }) } });
const err = (...codes) => Object.fromEntries(codes.map((c) => [c, { description: 'Error', content: json({ type: 'object', properties: { error: { type: 'string' } } }) }]));
const sec = [{ bearerAuth: [] }];
const q = (name, description, required = false) => ({ name, in: 'query', required, description, schema: { type: 'string' } });
const range = [q('websiteId', 'Website id', true), q('startDate', 'YYYY-MM-DD, UTC, inclusive (default: 29 days before endDate)'), q('endDate', 'YYYY-MM-DD, UTC, inclusive (default: today)')];
const cred = { required: true, content: json({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } } }) };
const site = { type: 'object', properties: { name: { type: 'string' }, domain: { type: 'string', example: 'example.com' } }, required: ['name', 'domain'] };
const event = { type: 'object', required: ['siteKey', 'vid', 'sid', 'type', 'name', 'url', 'path'], properties: {
  siteKey: { type: 'string' }, vid: { type: 'string', format: 'uuid' }, sid: { type: 'string', format: 'uuid' }, type: { type: 'string', enum: ['pageview', 'event'] },
  name: { type: 'string', maxLength: 100 }, url: { type: 'string' }, path: { type: 'string', example: '/pricing' }, title: { type: 'string' }, ref: { type: 'string' },
  utm_source: { type: 'string' }, utm_medium: { type: 'string' }, utm_campaign: { type: 'string' }, screen: { type: 'string', example: '1920x1080' },
  props: { type: 'object', description: 'Flat object, max 2 KB' } } };
module.exports = {
  openapi: '3.0.3',
  info: { title: 'Pulse Analytics API', version: '1.0.0', description: 'Success responses are `{ "data": ... }`, errors are `{ "error": "message" }`. Authenticate with `Authorization: Bearer <token>` from login/register.' },
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  paths: {
    '/api/auth/register': { post: { tags: ['Auth'], summary: 'Create an account', requestBody: cred, responses: { ...ok('Created', 201), ...err(400, 409, 429) } } },
    '/api/auth/login': { post: { tags: ['Auth'], summary: 'Sign in', requestBody: cred, responses: { ...ok('Token and user'), ...err(401, 429) } } },
    '/api/auth/me': { get: { tags: ['Auth'], summary: 'Current user', security: sec, responses: { ...ok('User'), ...err(401) } } },
    '/api/websites': {
      get: { tags: ['Websites'], summary: 'List your websites with integration status', security: sec, responses: { ...ok('Websites'), ...err(401) } },
      post: { tags: ['Websites'], summary: 'Add a website and generate its tracking key', security: sec, requestBody: { required: true, content: json(site) }, responses: { ...ok('Created', 201), ...err(400, 401) } } },
    '/api/websites/{id}': { delete: { tags: ['Websites'], summary: 'Delete a website and all its data', security: sec, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { ...ok('Deleted'), ...err(401, 404) } } },
    '/api/events/collect': { post: { tags: ['Ingestion'], summary: 'Record one event (public, rate-limited; Origin must match the site domain)', requestBody: { required: true, content: json(event) }, responses: { ...ok('Accepted', 202), ...err(400, 403, 404, 429) } } },
    '/api/analytics/overview': { get: { tags: ['Analytics'], summary: 'KPIs with period comparison, daily series, top pages, channels, devices, browsers, OS, recent events', security: sec, parameters: range, responses: { ...ok('Overview'), ...err(400, 401, 404) } } },
    '/api/analytics/events': { get: { tags: ['Analytics'], summary: 'Paginated custom event log, optionally filtered by name', security: sec, parameters: [...range, q('name', 'Event name filter'), q('page', 'Page number (default 1)'), q('limit', 'Rows per page (default 10, max 50)')], responses: { ...ok('Events'), ...err(400, 401, 404) } } },
    '/api/analytics/details': { get: { tags: ['Analytics'], summary: 'Audience, pages, events, acquisition and technology breakdowns', security: sec, parameters: range, responses: { ...ok('Details'), ...err(400, 401, 404) } } },
  },
};
