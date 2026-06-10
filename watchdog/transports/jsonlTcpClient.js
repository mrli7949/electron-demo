const net = require('node:net')
const { toJsonLine } = require('../protocol')

function createJsonlTcpClient(options) {
  const { host, port, reconnectMs } = options
  let socket = null
  let reconnectTimer = null
  const queue = []

  function scheduleReconnect() {
    if (reconnectTimer || !port) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, reconnectMs)
  }

  function flush() {
    if (!socket || socket.destroyed || !socket.writable) return
    while (queue.length > 0) {
      socket.write(queue.shift())
    }
  }

  function connect() {
    if (!port || socket) return

    socket = net.createConnection({ host, port }, flush)
    socket.on('error', (error) => {
      console.error('[watchdog tcp] connection error:', error.message)
    })
    socket.on('close', () => {
      socket = null
      scheduleReconnect()
    })
  }

  connect()

  return {
    send(message) {
      queue.push(toJsonLine(message))
      if (queue.length > 200) {
        queue.splice(0, queue.length - 200)
      }
      flush()
    },
    close() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (socket) {
        socket.destroy()
        socket = null
      }
      queue.length = 0
    },
  }
}

module.exports = {
  createJsonlTcpClient,
}
