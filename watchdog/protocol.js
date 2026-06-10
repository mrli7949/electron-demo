function now() {
  return Date.now()
}

function createEnvelope(type, payload = {}) {
  return {
    version: 1,
    type,
    app: 'electron-demo',
    ts: now(),
    pid: process.pid,
    ...payload,
  }
}

function createHeartbeat(payload = {}) {
  return createEnvelope('heartbeat', payload)
}

function createEvent(payload = {}) {
  return createEnvelope('event', payload)
}

function toJsonLine(message) {
  return `${JSON.stringify(message)}\n`
}

module.exports = {
  createEnvelope,
  createEvent,
  createHeartbeat,
  toJsonLine,
}
