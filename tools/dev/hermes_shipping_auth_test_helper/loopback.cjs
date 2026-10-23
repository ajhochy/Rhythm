// Test transport guard, not a replacement for API/auth/security behavior.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const [options] = net._normalizeArgs(args);
  if (options.path || !['127.0.0.1', '::1', 'localhost'].includes(options.host || 'localhost')) {
    throw new Error('auth fixture forbids non-loopback/Unix transport');
  }
  if ([4001, 4096, 4898, 4998].includes(Number(options.port))) {
    throw new Error('auth fixture forbids live/peer ports');
  }
  return connect.apply(this, args);
};
