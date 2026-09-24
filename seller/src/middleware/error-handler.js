// Map known application errors to their HTTP response status.
'use strict';

function errorHandler(error, request, reply) {
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  reply.code(statusCode).send({ error: error.message || 'Internal Server Error' });
}

module.exports = errorHandler;
