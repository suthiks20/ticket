// Create and export the PostgreSQL connection pool.
'use strict';

const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 5000,
  keepAlive: true
});
pool.on('error', (err) => console.error('Unexpected pool error:', err));

module.exports = pool;
