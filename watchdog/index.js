const { createWatchdogConfig } = require('./config')
const { createRendererWatchdog } = require('./rendererWatchdog')
const { createConsoleTransport } = require('./transports/consoleTransport')
const { createFileTransport } = require('./transports/fileTransport')
const { createJsonlTcpClient } = require('./transports/jsonlTcpClient')

function createWatchdog(options) {
  const config = createWatchdogConfig(options.config)
  const transports = [createConsoleTransport({ logHeartbeats: config.logHeartbeats })]

  if (config.fileLog.enabled && options.logDir) {
    transports.push(
      createFileTransport({
        logDir: options.logDir,
        filePrefix: config.fileLog.filePrefix,
        maxFileSizeBytes: config.fileLog.maxFileSizeMb * 1024 * 1024,
        maxFiles: config.fileLog.maxFiles,
        logHeartbeats: config.fileLog.logHeartbeats,
      }),
    )
  }

  if (config.tcp.enabled && config.tcp.port > 0) {
    transports.push(createJsonlTcpClient(config.tcp))
  }

  return createRendererWatchdog({
    config,
    transports,
    requestRecovery: options.requestRecovery,
  })
}

module.exports = {
  createWatchdog,
}
