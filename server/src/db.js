const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c timezone=UTC',
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
pool.on('error', (e) => console.error(JSON.stringify({ level: 'error', msg: 'idle db client error: ' + e.message })));
module.exports = { pool, query: (text, params) => pool.query(text, params) };
