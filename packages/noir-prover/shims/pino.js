/**
 * Browser shim for pino logger
 *
 * pino is a Node.js logging library that leaks into browser bundles
 * via @aztec/bb.js transitive dependencies. This shim provides a
 * no-op implementation to prevent import errors.
 */

const noop = () => {};

const logger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  trace: noop,
  fatal: noop,
  silent: noop,
  level: 'silent',
  child: function() { return this; },
};

export function pino() {
  return logger;
}

export default pino;
