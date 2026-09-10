'use strict'

// dsh web 服务进程的生命周期管理：启动、停止、重启、探测与接管。

const { spawn, execFile } = require('node:child_process')
const { EventEmitter } = require('node:events')
const http = require('node:http')
const { findNodeBin, findDshBin } = require('./dsh-locator')
const { resolveRuntime } = require('./runtime')

const TOKEN_PATTERN = /[?&]token=([A-Za-z0-9_-]+)/
const READY_TIMEOUT_MS = 90_000

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 探测端口上是否有 HTTP 服务在监听。 */
function probePort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.request(
      { host, port, path: '/', method: 'GET', timeout: timeoutMs },
      (response) => {
        response.resume()
        resolve({ alive: true, status: response.statusCode })
      },
    )
    request.on('timeout', () => {
      request.destroy()
      resolve({ alive: false })
    })
    request.on('error', () => resolve({ alive: false }))
    request.end()
  })
}

/** 通过 netstat 找出监听某端口的进程 PID（用于停止非本客户端启动的实例）。 */
function findPortOwners(port) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], { windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error && !stdout) return resolve([])
      const pids = new Set()
      for (const line of String(stdout).split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue
        if (!new RegExp(`:${port}\\s`).test(line)) continue
        const parts = line.trim().split(/\s+/)
        const pid = Number(parts[parts.length - 1])
        if (Number.isInteger(pid) && pid > 0) pids.add(pid)
      }
      resolve([...pids])
    })
  })
}

function killTree(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
  })
}

class ServerManager extends EventEmitter {
  constructor({ logger }) {
    super()
    this.logger = logger
    this.child = null
    this.project = null
    this.token = null
    this.startedAt = 0
    /** @type {'stopped'|'starting'|'running'|'external'|'stopping'} */
    this.state = 'stopped'
    this.lastError = null
  }

  snapshot() {
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      port: this.project?.port ?? null,
      host: '127.0.0.1',
      cwd: this.project?.cwd ?? null,
      projectId: this.project?.id ?? null,
      startedAt: this.startedAt,
      hasToken: Boolean(this.token),
      lastError: this.lastError,
    }
  }

  _setState(state) {
    this.state = state
    this.emit('state', this.snapshot())
  }

  /** 启动服务；若端口上已有实例则切换为「接管」模式。 */
  async start(project, { force = false } = {}) {
    if (this.state === 'running' || this.state === 'starting') {
      if (!force) return { ok: true, already: true, external: false }
      await this.stop()
    }
    if (this.state === 'external' && !force) {
      return { ok: true, already: true, external: true }
    }
    if (this.state === 'external' && force) {
      await this.stop()
    }

    this.project = project
    this.lastError = null
    this._setState('starting')
    this.logger.info(`启动服务：端口 ${project.port}，工作目录 ${project.cwd}`)

    // 端口已被占用 —— 直接接管，不重复启动
    const probe = await probePort('127.0.0.1', project.port)
    if (probe.alive) {
      this.logger.info(`端口 ${project.port} 已有服务在运行（HTTP ${probe.status}），切换为接管模式`)
      this._setState('external')
      return { ok: true, external: true }
    }

    const runtime = resolveRuntime()
    if (!runtime.nodeBin) {
      this.lastError = '找不到可用的 JavaScript 运行时（node 或 Electron）'
      this.logger.error(this.lastError)
      this._setState('stopped')
      return { ok: false, error: this.lastError }
    }
    if (!runtime.dshBin) {
      this.lastError = '找不到 dsh 的 bin.js（随包分发的版本缺失，且系统未安装 @deepseek-ai/dsh）'
      this.logger.error(this.lastError)
      this._setState('stopped')
      return { ok: false, error: this.lastError }
    }

    const args = [...runtime.nodeArgs, runtime.dshBin, 'web', '--port', String(project.port), '--no-open']
    this.logger.info(`运行时：${runtime.mode === 'bundled' ? '随包 DSH（Electron 内置 Node）' : '系统 node + 已安装 dsh'}`)
    this.logger.info(`执行：${runtime.nodeBin} ${args.join(' ')}`)

    const child = spawn(runtime.nodeBin, args, {
      cwd: project.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 不要注入 GIT_CONFIG_* 这类名字含 KEY/TOKEN/SECRET 的变量：
      // dsh-subprocess 会按 /KEY|PASSWORD|SECRET|TOKEN/i 清洗子进程环境，
      // GIT_CONFIG_KEY_n 会被丢掉而 GIT_CONFIG_COUNT/VALUE_n 留下，
      // git 随即报 "missing config key GIT_CONFIG_KEY_n"，
      // 导致 DSH 内所有 git 命令失效。git 的 schannel 在非受限进程里工作正常。
      env: {
        ...process.env,
        ...runtime.env,
      },
    })
    this.child = child
    this.token = null
    this.startedAt = Date.now()

    const ready = new Promise((resolve) => {
      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        resolve(result)
      }

      const handleChunk = (stream) => (buffer) => {
        const text = String(buffer)
        this.logger.write(stream, text)
        if (!this.token) {
          const match = TOKEN_PATTERN.exec(text)
          if (match) {
            this.token = match[1]
            this._setState('running')
            finish({ ok: true })
          }
        }
      }

      child.stdout.on('data', handleChunk('server'))
      child.stderr.on('data', handleChunk('server'))

      child.on('error', (error) => {
        this.lastError = error.message
        this.logger.error(`进程启动失败：${error.message}`)
        this._setState('stopped')
        finish({ ok: false, error: error.message })
      })

      child.on('exit', (code, signal) => {
        this.logger.info(`服务进程退出（code=${code} signal=${signal}）`)
        this.child = null
        this.token = null
        this.startedAt = 0
        if (this.state !== 'stopping') this._setState('stopped')
        finish({ ok: false, error: `服务进程已退出（code=${code}）` })
      })

      setTimeout(() => {
        if (settled) return
        // 超时后仍可能已经在跑（例如令牌没被打印），再探测一次端口
        probePort('127.0.0.1', project.port).then((result) => {
          if (result.alive) {
            this._setState('running')
            finish({ ok: true, warning: '未捕获到启动令牌' })
          } else {
            this.lastError = '启动超时'
            this._setState('stopped')
            finish({ ok: false, error: this.lastError })
          }
        })
      }, READY_TIMEOUT_MS)
    })

    const result = await ready
    if (!result.ok) {
      await this.stop()
    }
    return result
  }

  async stop() {
    if (this.child) {
      this._setState('stopping')
      const pid = this.child.pid
      this.logger.info(`停止服务进程 PID ${pid}`)
      await killTree(pid)
      await delay(400)
      this.child = null
      this.token = null
      this.startedAt = 0
      this._setState('stopped')
      return { ok: true }
    }

    // 接管模式：结束端口上的占用进程
    if (this.state === 'external' && this.project) {
      this._setState('stopping')
      const pids = await findPortOwners(this.project.port)
      if (pids.length === 0) {
        this._setState('stopped')
        return { ok: true, note: '端口上已无监听进程' }
      }
      for (const pid of pids) {
        this.logger.info(`停止接管实例 PID ${pid}`)
        await killTree(pid)
      }
      await delay(400)
      this._setState('stopped')
      return { ok: true }
    }

    this._setState('stopped')
    return { ok: true }
  }

  async restart(project) {
    await this.stop()
    await delay(600)
    return this.start(project, { force: true })
  }

  /** 刷新状态：用于接管检测（客户端启动时调用）。 */
  async refresh(project) {
    this.project = project
    if (this.child) return this.snapshot()
    const probe = await probePort('127.0.0.1', project.port)
    if (probe.alive) {
      this._setState('external')
    } else if (this.state !== 'stopped') {
      this._setState('stopped')
    }
    return this.snapshot()
  }

  /** 退出前的清理。 */
  async dispose({ kill = false } = {}) {
    if (kill && this.child) await this.stop()
  }
}

module.exports = { ServerManager, probePort, findPortOwners, killTree }
