// Build and configure the Fastify application without starting its listener.
'use strict';

const Fastify = require('fastify');
const errorHandler = require('./middleware/error-handler');
const salesRoutes = require('./modules/sales/routes');
const ticketRoutes = require('./modules/tickets/routes');

async function createApp() {
  const fastify = Fastify({ logger: true });
  fastify.setErrorHandler(errorHandler);
  await fastify.register(salesRoutes);
  await fastify.register(ticketRoutes);
  return fastify;
}

module.exports = createApp;
