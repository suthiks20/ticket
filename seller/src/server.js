// seller/src/server.js — FINAL PRODUCTION VERSION (FIXED CONNECTION LEAK)
const fastify = require('fastify')({ logger: false });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ticket:ticket@localhost:5432/tickets',
  max: 20,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
});

pool.on('error', (err) => console.error('Unexpected pool error (idle client):', err.message));

// Helper: read the currently active sale_id from the DB
async function getActiveSaleId(client) {
  const res = await client.query('SELECT sale_id FROM sales WHERE is_active = true LIMIT 1');
  return res.rows[0]?.sale_id || null;
}

// --- 1. RESET ---
fastify.post('/reset', async (request, reply) => {
  const { ticket_count } = request.body || {};
  if (!Number.isInteger(ticket_count) || ticket_count < 1 || ticket_count > 100000) {
    return reply.code(400).send({ error: 'Invalid ticket_count (must be 1-100000)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE sales SET is_active = false WHERE is_active = true');

    const saleRes = await client.query(
      'INSERT INTO sales (ticket_count, is_active) VALUES ($1, true) RETURNING sale_id',
      [ticket_count]
    );
    const saleId = saleRes.rows[0].sale_id;

    await client.query(
      'INSERT INTO tickets (sale_id, ticket_number) SELECT $1, generate_series(1, $2)',
      [saleId, ticket_count]
    );

    await client.query('COMMIT');
    return { ok: true, sale_id: saleId };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Reset failed:', e.message);
    return reply.code(500).send({ error: 'RESET_FAILED' });
  } finally {
    client.release();
  }
});

// --- 2. BUY (WITH CTE OPTIMIZATION & CRASH PREVENTION) ---
fastify.post('/buy', async (request, reply) => {
  const { user_id, request_id } = request.body || {};
  if (!user_id || !request_id) {
    return reply.code(400).send({ error: 'Missing user_id or request_id' });
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const client = await pool.connect();
    // CRITICAL FIX: Prevent process crash on DB connection loss
    client.on('error', (err) => console.error('Checked-out client error:', err.message));

    try {
      await client.query('BEGIN');

      const saleId = await getActiveSaleId(client);
      if (!saleId) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'NO_ACTIVE_SALE' });
      }

      // SINGLE-TRIP CTE: Idempotency check + Claim in one atomic query
      const result = await client.query(`
        WITH existing AS (
          SELECT ticket_number, user_id
          FROM tickets
          WHERE sale_id = $1 AND request_id = $2
        ),
        free AS MATERIALIZED (
          SELECT ticket_number
          FROM tickets
          WHERE sale_id = $1
            AND user_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM existing)
          ORDER BY ticket_number
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        ),
        claimed AS (
          UPDATE tickets t
          SET user_id = $3, request_id = $2
          FROM free f
          WHERE t.sale_id = $1 AND t.ticket_number = f.ticket_number
          RETURNING t.ticket_number, $3::text AS user_id
        )
        SELECT ticket_number, user_id, 'claimed'::text AS source
        FROM claimed
        UNION ALL
        SELECT ticket_number, user_id, 'replay'::text AS source
        FROM existing
      `, [saleId, request_id, user_id]);

      if (result.rows.length > 0) {
        const ticket = result.rows[0];
        if (ticket.source === 'replay' && ticket.user_id !== user_id) {
          await client.query('COMMIT');
          return reply.code(422).send({ error: 'REQUEST_ID_REUSE_BY_DIFFERENT_USER' });
        }
        await client.query('COMMIT');
        return { ticket_number: ticket.ticket_number, sale_id: saleId };
      }

      // If CTE returned 0 rows, check if truly sold out or just locked
      const available = await client.query(
        'SELECT EXISTS(SELECT 1 FROM tickets WHERE sale_id = $1 AND user_id IS NULL) AS exists',
        [saleId]
      );
      await client.query('COMMIT');

      if (!available.rows[0].exists) {
        return reply.code(409).send({ error: 'SOLD_OUT' });
      }
      
      // Brief backoff before retrying if locked
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 15));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      // Release client with error so pool discards the broken connection
      client.release(e); 
      
      if (e.code === '23505') {
        await new Promise((r) => setTimeout(r, 5));
        continue; 
      }
      console.error('Buy error:', e.message);
      return reply.code(503).send({ error: 'BUSY', retry_after: 1 });
    } finally {
      // CRITICAL FIX: Always release the client back to the pool
      client.release();
    }
  }
  return reply.code(503).send({ error: 'BUSY', retry_after: 1 });
});

// --- 3. STATUS (RETURNS TICKET_COUNT) ---
fastify.get('/status', async (request, reply) => {
  try {
    const client = await pool.connect();
    try {
      const saleId = await getActiveSaleId(client);
      if (!saleId) return { sold: 0, ticket_count: 0, tickets: [], sale_id: null };

      const countRes = await client.query(
        'SELECT ticket_count FROM sales WHERE sale_id = $1',
        [saleId]
      );
      const ticketCount = countRes.rows[0]?.ticket_count || 0;

      const res = await client.query(
        `SELECT ticket_number, user_id, request_id FROM tickets
         WHERE sale_id = $1 AND user_id IS NOT NULL ORDER BY ticket_number`,
        [saleId]
      );
      
      return { sold: res.rows.length, ticket_count: ticketCount, tickets: res.rows, sale_id: saleId };
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Status query failed:', e.message);
    return reply.code(503).send({ error: 'DB_UNAVAILABLE' });
  }
});

// --- 4. STARTUP: create schema if missing, NEVER drop it ---
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales (
      sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_count INT NOT NULL,
      is_active BOOLEAN DEFAULT false
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_active ON sales (is_active) WHERE is_active = true;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
      ticket_number INT NOT NULL,
      user_id TEXT,
      request_id TEXT,
      PRIMARY KEY (sale_id, ticket_number)
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_request
      ON tickets (sale_id, request_id) WHERE request_id IS NOT NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tickets_available
      ON tickets (sale_id, ticket_number) WHERE user_id IS NULL;
  `);
  console.log('✅ Schema ensured (no data dropped).');
}

async function start() {
  for (let i = 0; i < 15; i++) {
    try {
      await ensureSchema();
      break;
    } catch (e) {
      console.log(`Waiting for Postgres... (${i + 1}/15) — ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
      if (i === 14) throw e;
    }
  }

  await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
  console.log('🚀 Fixed Seller running on http://localhost:' + (process.env.PORT || 3000));
}

process.on('SIGINT', async () => {
  await fastify.close();
  await pool.end();
  process.exit(0);
});

start().catch((err) => {
  console.error('❌ Server startup failed:', err.message);
  process.exit(1);
});