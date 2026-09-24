// Define request and response JSON Schemas for POST /buy.
'use strict';

module.exports = {
  body: {
    type: 'object',
    required: ['user_id', 'request_id'],
    additionalProperties: false,
    properties: {
      user_id: { type: 'string', minLength: 1 },
      request_id: { type: 'string', minLength: 1 }
    }
  },
  response: {
    200: {
      type: 'object',
      required: ['ticket_number'],
      properties: { ticket_number: { type: 'integer', minimum: 1 } }
    }
  }
};
