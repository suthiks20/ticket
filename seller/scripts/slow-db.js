// Hold conflicting PostgreSQL locks briefly to simulate seller write contention.
'use strict';

const { Pool } = require('pg');

function readSeconds(argv) {
  const flagIndex = argv.findIndex((value) => value === '--seconds' || value.startsWith('--seconds='));
  if (flagIndex === -1) return 10;
  const rawValue = argv[flagIndex].startsWith('--seconds=')
    ? argv[flagIndex].slice('--seconds='.length)
    : argv[flagIndex + 1];
  const seconds = Number(rawValue);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('--seconds must be a positive number');
  }
  return seconds;
}

async function main() {
  const seconds = readSeconds(process.argv.slice(2));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://ticket:ticket@localhost:5432/tickets',
    max: 1,
    connectionTimeoutMillis: 5000,
    keepAlive: true,
  });
  pool.on('error', (err) => console.error('[slow-db] Unexpected pool error:', err));

  let client;
  let releaseError;
  let transactionStarted = false;
  try {
    console.log(`[slow-db] Waiting for contention locks at ${new Date().toISOString()}`);
    client = await pool.connect();
    client.on('error', (err) => console.error('[slow-db] PostgreSQL client error:', err));
    await client.query('BEGIN');
    transactionStarted = true;

    // SHARE conflicts with the ROW EXCLUSIVE lock taken by the seller's ticket UPDATEs.
    await client.query('LOCK TABLE tickets IN EXCLUSIVE MODE');
    const activeSale = await client.query(
      'SELECT sale_id FROM sales WHERE is_active = true LIMIT 1 FOR UPDATE'
    );
    if (activeSale.rows.length === 0) {
      throw new Error('No active sale found; start a sale before running the slowdown.');
    }

    console.log(`[slow-db] LOCK HELD START ${new Date().toISOString()} active_sale_id=${activeSale.rows[0].sale_id} duration=${seconds}s`);
    await client.query('SELECT pg_sleep($1)', [seconds]);
    await client.query('COMMIT');
    transactionStarted = false;
    console.log(`[slow-db] LOCK RELEASED END ${new Date().toISOString()}`);
  } catch (err) {
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError = rollbackError;
      }
    }
    throw err;
  } finally {
    if (client) client.release(releaseError);
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`[slow-db] Failed at ${new Date().toISOString()}:`, err);
  process.exitCode = 1;
});
