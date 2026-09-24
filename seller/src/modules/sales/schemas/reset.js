// Define request and response JSON Schemas for POST /reset.
'use strict';

module.exports = {
  body: {
    type: 'object',
    required: ['ticket_count'],
    additionalProperties: false,
    properties: { ticket_count: { type: 'integer', minimum: 1 } }
  },
  response: {
    200: {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    }
  }
};
