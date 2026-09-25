// seller/src/server.js (FIXED, BULLETPROOF VERSION)
const fastify = require('fastify')({ logger: false });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ticket:ticket@localhost:5432/tickets',
  max: 20,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
});

pool.on('error', (err) => console.error('Unexpected pool error:', err));

let currentSaleId = null;

// --- 1. RESET: Pre-allocate ticket rows atomically ---
fastify.post('/reset', async (request, reply) => {
  const { ticket_count } = request.body || {};
  if (!Number.isInteger(ticket_count) || ticket_count < 1 || ticket_count > 100000) {
    return reply.code(400).send({ error: 'Invalid ticket_count (must be 1-100000)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM tickets');
    await client.query('DELETE FROM sales');
    
    const saleRes = await client.query(
      'INSERT INTO sales (ticket_count, is_active) VALUES ($1, true) RETURNING sale_id',
      [ticket_count]
    );
    currentSaleId = saleRes.rows[0].sale_id;

    // Pre-allocate exactly N rows so we don't rely on counters
    await client.query(
      'INSERT INTO tickets (sale_id, ticket_number) SELECT $1, generate_series(1, $2)',
      [currentSaleId, ticket_count]
    );

    await client.query('COMMIT');
    return { ok: true, sale_id: currentSaleId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// --- 2. BUY: The Bulletproof Logic ---
fastify.post('/buy', async (request, reply) => {
  const { user_id, request_id } = request.body || {};
  if (!user_id || !request_id) {
    return reply.code(400).send({ error: 'Missing user_id or request_id' });
  }

  if (!currentSaleId) {
    return reply.code(409).send({ error: 'NO_ACTIVE_SALE' });
  }

  // Retry loop to handle lock contention gracefully
  for (let attempt = 0; attempt < 10; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Step A: Idempotency Check (Invariant 3)
      const replay = await client.query(
        'SELECT ticket_number, user_id FROM tickets WHERE sale_id = $1 AND request_id = $2',
        [currentSaleId, request_id]
      );
      
      if (replay.rows.length > 0) {
        await client.query('COMMIT');
        if (replay.rows[0].user_id !== user_id) {
          return reply.code(422).send({ error: 'REQUEST_ID_REUSE_BY_DIFFERENT_USER' });
        }
        return { ticket_number: replay.rows[0].ticket_number, sale_id: currentSaleId };
      }

      // Step B: Claim a ticket using FOR UPDATE SKIP LOCKED
      const claim = await client.query(`
        UPDATE tickets 
        SET user_id = $1, request_id = $2 
        WHERE ticket_number = (
          SELECT ticket_number FROM tickets 
          WHERE sale_id = $3 AND user_id IS NULL 
          ORDER BY ticket_number 
          LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING ticket_number
      `, [user_id, request_id, currentSaleId]);

      if (claim.rows.length > 0) {
        await client.query('COMMIT');
        return { ticket_number: claim.rows[0].ticket_number, sale_id: currentSaleId };
      }

      // Step C: If 0 rows claimed, check if truly sold out or just locked by others
      const available = await client.query(
        'SELECT EXISTS(SELECT 1 FROM tickets WHERE sale_id = $1 AND user_id IS NULL)',
        [currentSaleId]
      );
      await client.query('COMMIT');

      if (!available.rows[0].exists) {
        return reply.code(409).send({ error: 'SOLD_OUT' });
      }
      
      // If available but not claimed, another transaction holds the lock. Wait and retry.
      await new Promise(resolve => setTimeout(resolve, 5)); 

    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') { // Unique constraint violation (race on request_id)
        await new Promise(resolve => setTimeout(resolve, 5));
        continue; // Retry, Step A will catch it next time
      }
      throw e;
    } finally {
      client.release();
    }
  }
  
  // If we exhausted retries, it's just too busy
  return reply.code(503).send({ error: 'BUSY', retry_after: 1 });
});

// --- 3. STATUS: Single query for consistency (Invariant 4) ---
fastify.get('/status', async (request, reply) => {
  if (!currentSaleId) {
    return { sold: 0, tickets: [], sale_id: null };
  }

  // Derive 'sold' directly from the returned rows to guarantee they never disagree
  const res = await pool.query(
    `SELECT ticket_number, user_id, request_id FROM tickets 
     WHERE sale_id = $1 AND user_id IS NOT NULL 
     ORDER BY ticket_number`,
    [currentSaleId]
  );

  return { sold: res.rows.length, tickets: res.rows, sale_id: currentSaleId };
});

// --- 4. STARTUP: Ensure Schema ---
async function start() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales (
        sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
        ticket_count INT NOT NULL, 
        is_active BOOLEAN DEFAULT false,
        sold_out BOOLEAN DEFAULT false
      );
      
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_active
      ON sales (is_active)
      WHERE is_active = true;

      CREATE TABLE IF NOT EXISTS tickets (
        sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE, 
        ticket_number INT NOT NULL, 
        user_id TEXT, 
        request_id TEXT,
        PRIMARY KEY (sale_id, ticket_number)
      );
      
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_request
      ON tickets (sale_id, request_id)
      WHERE request_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_tickets_available
      ON tickets (sale_id, ticket_number)
      WHERE user_id IS NULL;
    `);
    const activeSale = await pool.query(
      'SELECT sale_id FROM sales WHERE is_active = true LIMIT 1'
    );
    currentSaleId = activeSale.rows[0]?.sale_id || null;
    console.log('Database schema ensured without changing existing sale data.');
    
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log('🚀 Fixed Seller running on http://localhost:3000');
  } catch (err) {
    console.error('❌ Server startup failed:', err);
    process.exit(1);
  }
}

start();
