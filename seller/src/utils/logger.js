// Provide a small console-backed logger with standard severity levels.
'use strict';

module.exports = Object.freeze({
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
});
