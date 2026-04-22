const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'safeways',
  password: 'TU_PASSWORD',
  port: 5432
});

module.exports = pool;  