// seller/src/server.js (NAIVE VERSION - DELIBERATELY BROKEN)
const fastify = require('fastify')({ logger: false });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ticket:ticket@localhost:5432/tickets',
  max: 50,
});

let naiveSoldCount = 0;
let naiveTotal = 0;
let naiveTicketCounter = 0;
let currentSaleId = null;

fastify.post('/reset', async (request, reply) => {
  const { ticket_count } = request.body || {};
  if (!Number.isInteger(ticket_count) || ticket_count < 1) {
    return reply.code(400).send({ error: 'Invalid ticket_count' });
  }
  await pool.query('DELETE FROM tickets');
  await pool.query('DELETE FROM sales');
  const res = await pool.query('INSERT INTO sales (ticket_count, is_active) VALUES ($1, true) RETURNING sale_id', [ticket_count]);
  currentSaleId = res.rows[0].sale_id;
  naiveSoldCount = 0; naiveTotal = ticket_count; naiveTicketCounter = 0;
  return { ok: true, sale_id: currentSaleId };
});

fastify.post('/buy', async (request, reply) => {
  const { user_id, request_id } = request.body || {};
  if (!user_id || !request_id) return reply.code(400).send({ error: 'Missing fields' });
  if (!currentSaleId) return reply.code(409).send({ error: 'NO_ACTIVE_SALE' });
  
  if (naiveSoldCount >= naiveTotal) return reply.code(409).send({ error: 'SOLD_OUT' });
  
  // THE FLAW: Yield to event loop to force race condition
  await new Promise(resolve => setTimeout(resolve, 2));
  
  naiveSoldCount++; naiveTicketCounter++;
  await pool.query('INSERT INTO tickets (sale_id, ticket_number, user_id, request_id) VALUES ($1, $2, $3, $4)', [currentSaleId, naiveTicketCounter, user_id, request_id]);
  return { ticket_number: naiveTicketCounter, sale_id: currentSaleId };
});

fastify.get('/status', async (request, reply) => {
  if (!currentSaleId) return { sold: 0, tickets: [], sale_id: null };
  const res = await pool.query('SELECT ticket_number, user_id, request_id FROM tickets WHERE sale_id = $1 ORDER BY ticket_number', [currentSaleId]);
  return { sold: res.rows.length, tickets: res.rows, sale_id: currentSaleId };
});

async function start() {
  try {
    await pool.query('DROP TABLE IF EXISTS tickets CASCADE; DROP TABLE IF EXISTS sales CASCADE;');
    await pool.query('CREATE TABLE sales (sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ticket_count INT, is_active BOOLEAN); CREATE TABLE tickets (sale_id UUID, ticket_number INT, user_id TEXT, request_id TEXT);');
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Naive Seller running on port 3000');
  } catch (err) { console.error(err); process.exit(1); }
}
start();