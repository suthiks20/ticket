// Log each completed request with its method, path, status, and duration.
'use strict';

function requestLogger(request, reply, done) {
  const startedAt = process.hrtime.bigint();
  reply.raw.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    request.log.info({ method: request.method, path: request.url, status: reply.statusCode, durationMs }, 'request completed');
  });
  done();
}

module.exports = requestLogger;
