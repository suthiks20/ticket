// Ensure the application database schema has been applied.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('./pool');

async function ensureSchema() {
  const candidates = [
    path.resolve(process.cwd(), 'schema.sql'),
    path.resolve(__dirname, '../../../schema.sql')
  ];
  let schema;
  let lastError;
  for (const schemaPath of candidates) {
    try {
      schema = await fs.readFile(schemaPath, 'utf8');
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (schema === undefined) throw lastError;
  await pool.query(schema);
}

module.exports = { ensureSchema };
