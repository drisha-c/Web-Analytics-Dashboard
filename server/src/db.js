const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c timezone=UTC',
});
module.exports = { pool, query: (text, params) => pool.query(text, params) };
