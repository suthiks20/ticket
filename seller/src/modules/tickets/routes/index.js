// seller/src/modules/tickets/routes/index.js
const buyHandler = require('../handlers/buy');
const statusHandler = require('../handlers/status');
const buySchema = require('../schemas/buy');
const statusSchema = require('../schemas/status');

async function ticketRoutes(fastify) {
  fastify.post('/buy', { schema: buySchema }, buyHandler);
  fastify.get('/status', { schema: statusSchema }, statusHandler);
}

module.exports = ticketRoutes;