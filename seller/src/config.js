// Load environment settings and export immutable seller configuration.
'use strict';

require('dotenv').config();

const config = Object.freeze({
  databaseUrl: process.env.DATABASE_URL || 'postgres://ticket:ticket@localhost:5432/tickets',
  port: Number.parseInt(process.env.PORT || '3000', 10),
  sellerMode: process.env.SELLER_MODE || 'naive',
  pgPoolMax: Number.parseInt(process.env.PG_POOL_MAX || '20', 10)
});

module.exports = config;
