function createConsoleTransport(options = {}) {
  return {
    send(message) {
      if (message.type === 'heartbeat' && !options.logHeartbeats) return

      const level = message.level || (message.type === 'event' ? 'info' : 'debug')
      const writer = level === 'fatal' || level === 'error' ? console.error : console.log
      writer('[watchdog]', JSON.stringify(message))
    },
    close() {},
  }
}

module.exports = {
  createConsoleTransport,
}
