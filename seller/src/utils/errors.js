// Define HTTP-aware errors for seller request outcomes.
'use strict';

class SoldOutError extends Error {
  constructor(message = 'SOLD_OUT') {
    super(message);
    this.name = 'SoldOutError';
    this.statusCode = 409;
  }
}

class BusyError extends Error {
  constructor(message = 'BUSY') {
    super(message);
    this.name = 'BusyError';
    this.statusCode = 503;
  }
}

class ConflictError extends Error {
  constructor(message = 'request_id is already associated with a different user_id') {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 422;
  }
}

class ValidationError extends Error {
  constructor(message = 'Invalid request') {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

module.exports = { SoldOutError, BusyError, ConflictError, ValidationError };
