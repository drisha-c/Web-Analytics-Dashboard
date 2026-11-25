const app = require('./app');
const { pool } = require('./db');
const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(JSON.stringify({ level: 'info', msg: 'listening', port })));
const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);