// Shared ticket module table names and response messages.
'use strict';

module.exports = Object.freeze({
  TABLE_NAMES: Object.freeze({ tickets: 'tickets', requests: 'ticket_requests' }),
  ERROR_MESSAGES: Object.freeze({ soldOut: 'SOLD_OUT', busy: 'BUSY' })
});
