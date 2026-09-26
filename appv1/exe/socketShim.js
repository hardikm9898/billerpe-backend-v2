// The exe pushes live changes to its LAN devices over sockets. POS App
// devices poll GET /app/v1/version instead, so every emit* is a no-op here.
module.exports = new Proxy({}, { get: () => () => {} });
