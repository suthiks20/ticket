// Define the JSON Schema for the GET /status response.
'use strict';

module.exports = {
  response: {
    200: {
      type: 'object',
      required: ['sold', 'tickets'],
      properties: {
        sold: { type: 'integer', minimum: 0 },
        tickets: {
          type: 'array',
          items: {
            type: 'object',
            required: ['ticket_number', 'user_id'],
            properties: {
              ticket_number: { type: 'integer', minimum: 1 },
              user_id: { type: 'string' }
            }
          }
        }
      }
    }
  }
};
