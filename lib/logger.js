'use strict'

// 简单的环形缓冲 + 落盘日志，供控制台实时查看服务端输出。

const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

class Logger extends EventEmitter {
  constructor(file, { max = 3000 } = {}) {
    super()
    this.file = file
    this.max = max
    this.lines = []
    this.stream = null
    this._open()
  }

  _open() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      this.stream = fs.createWriteStream(this.file, { flags: 'a' })
      this.stream.on('error', () => { this.stream = null })
    } catch {
      this.stream = null
    }
  }

  /** 写入若干行；source 用于区分 client / server / plugin。 */
  write(source, text) {
    const at = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const chunks = String(text).split(/\r?\n/)
    for (const raw of chunks) {
      if (raw.trim() === '') continue
      const line = { ts: Date.now(), at, source, text: raw }
      this.lines.push(line)
      if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max)
      this.emit('line', line)
      if (this.stream) this.stream.write(`[${at}] [${source}] ${raw}\n`)
    }
  }

  info(text) { this.write('client', text) }
  error(text) { this.write('client', text) }

  /** 返回最近 n 行（默认全部）。 */
  tail(n = this.max) {
    return this.lines.slice(Math.max(0, this.lines.length - n))
  }

  clear() {
    this.lines = []
    this.emit('clear')
  }

  close() {
    if (this.stream) {
      try { this.stream.end() } catch { /* ignore */ }
      this.stream = null
    }
  }
}

module.exports = { Logger }
