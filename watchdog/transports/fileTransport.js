const fs = require('node:fs')
const path = require('node:path')
const { toJsonLine } = require('../protocol')

function pad(value, length = 2) {
  return String(value).padStart(length, '0')
}

function createTimestamp() {
  const date = new Date()
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function listLogFiles(logDir, filePrefix) {
  if (!fs.existsSync(logDir)) return []

  return fs
    .readdirSync(logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(`${filePrefix}-`) && name.endsWith('.log'))
    .map((name) => {
      const filePath = path.join(logDir, name)
      const stat = fs.statSync(filePath)
      return {
        name,
        filePath,
        mtimeMs: stat.mtimeMs,
      }
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
}

function createFileTransport(options) {
  const {
    logDir,
    filePrefix,
    maxFileSizeBytes,
    maxFiles,
    logHeartbeats,
  } = options

  let currentFilePath = null
  let currentFileSize = 0
  let fileIndex = 0

  function ensureLogDir() {
    fs.mkdirSync(logDir, { recursive: true })
  }

  function pruneOldFiles() {
    const files = listLogFiles(logDir, filePrefix)
    const overflow = files.length - maxFiles
    if (overflow <= 0) return

    for (const file of files.slice(0, overflow)) {
      try {
        fs.unlinkSync(file.filePath)
      } catch (error) {
        console.error('[watchdog file] failed to remove old log:', error.message)
      }
    }
  }

  function openNextFile() {
    ensureLogDir()
    fileIndex += 1
    currentFilePath = path.join(logDir, `${filePrefix}-${createTimestamp()}-${pad(fileIndex, 3)}.log`)
    currentFileSize = 0
    fs.closeSync(fs.openSync(currentFilePath, 'a'))
    pruneOldFiles()
  }

  function ensureWritableFile(nextLineBytes) {
    if (!currentFilePath) {
      openNextFile()
      return
    }

    if (currentFileSize + nextLineBytes > maxFileSizeBytes) {
      openNextFile()
    }
  }

  return {
    send(message) {
      if (message.type === 'heartbeat' && !logHeartbeats) return

      try {
        const line = toJsonLine(message)
        const lineBytes = Buffer.byteLength(line)
        ensureWritableFile(lineBytes)
        fs.appendFileSync(currentFilePath, line)
        currentFileSize += lineBytes
      } catch (error) {
        console.error('[watchdog file] failed to write log:', error.message)
      }
    },
    close() {},
  }
}

module.exports = {
  createFileTransport,
}
