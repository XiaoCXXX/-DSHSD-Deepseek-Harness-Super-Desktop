'use strict'

// 随包 DSH 以 Electron 内置 Node 运行，会把 ELECTRON_RUN_AS_NODE=1 传染给子进程。
// 不清掉的话，本脚本启动的 electron.exe 会以纯 Node 模式运行（app 为 undefined）并崩溃。
delete process.env.ELECTRON_RUN_AS_NODE

// 生命周期功能验证：在独立端口上真实地启动 → 重启 → 停止服务。
// 全程以 --hidden 运行，不显示任何窗口；绝不触碰 3080 上正在运行的实例。
//   node tools/verify-lifecycle.js

const path = require('node:path')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
// 独立的用户数据目录：避免与正在运行的正式客户端争抢单实例锁 / 共用配置
const USER_DATA = path.join(ROOT, '.verify', 'userdata-lifecycle')
const DEBUG_PORT = 9232
const TEST_PORT = 3099
const TEST_NAME = '生命周期测试（可删除）'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function probe(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode || 0)
    })
    req.on('timeout', () => { req.destroy(); resolve(0) })
    req.on('error', () => resolve(0))
    req.end()
  })
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })
  let seq = 0
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => reject(new Error(`${method} 超时`)), 120000)
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
        else resolve(msg.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, send }
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || '页面内脚本抛错')
  }
  return result.result?.value
}

async function main() {
  const report = []
  const note = (ok, label, value) => {
    report.push({ ok, label, value })
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value ? `  ${value}` : ''}`)
  }

  console.log(`\n生命周期功能验证（测试端口 ${TEST_PORT}，不影响 3080）\n${'─'.repeat(60)}`)

  const before3080 = await probe(3080)
  note(before3080 > 0, '前置检查：3080 上原有实例存活', `HTTP ${before3080}`)

  const child = spawn(ELECTRON, ['.', '--hidden', `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* ignore */ }
  }
  process.on('exit', cleanup)

  let targets = null
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    try {
      targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      if (targets.some((t) => t.url.includes('control.html'))) break
      targets = null
    } catch { /* 继续等待 */ }
  }
  if (!targets) {
    console.error('CDP 未就绪')
    cleanup()
    process.exit(1)
  }

  const control = targets.find((t) => t.url.includes('control.html'))
  const { ws, send } = await connect(control)
  await sleep(1500)

  let projectId = null
  try {
    // 1) 新建测试项目并切换过去
    const created = await evaluate(send, `(async () => {
      const p = await window.dshClient.upsertProject({ name: ${JSON.stringify(TEST_NAME)}, cwd: ${JSON.stringify(ROOT)}, port: ${TEST_PORT} })
      await window.dshClient.setActiveProject(p.id)
      return p
    })()`)
    projectId = created?.id
    note(Boolean(projectId), '新建并切换到测试项目', `:${TEST_PORT}`)

    const afterSwitch = await evaluate(send, `(async () => (await window.dshClient.getState()).server)()`)
    note(afterSwitch.state === 'stopped', '切换项目后未触碰 3080 实例', `state=${afterSwitch.state}`)

    // 2) 启动服务
    const started = await evaluate(send, `(async () => await window.dshClient.start())()`)
    note(started?.ok === true, '启动服务返回成功', JSON.stringify(started))

    const running = await evaluate(send, `(async () => (await window.dshClient.getState()).server)()`)
    note(running.state === 'running', '状态变为 running', `pid=${running.pid}`)
    note(running.hasToken === true, '已捕获启动令牌', running.hasToken ? 'yes' : 'no')

    const portUp = await probe(TEST_PORT)
    note(portUp > 0, `端口 ${TEST_PORT} 可访问`, `HTTP ${portUp}`)

    // 3) 余额接口（挂件）
    const balance = await evaluate(send, `(async () => await window.dshClient.refreshBalance())()`)
    note(Boolean(balance), '余额接口可用', balance ? `${balance.currency} ${balance.totalBalance}` : '无数据（挂件未加载）')

    // 4) 重启
    const restarted = await evaluate(send, `(async () => await window.dshClient.restart())()`)
    note(restarted?.ok === true, '重启服务返回成功', JSON.stringify(restarted))
    const afterRestart = await evaluate(send, `(async () => (await window.dshClient.getState()).server)()`)
    note(afterRestart.state === 'running', '重启后仍在运行', `pid=${afterRestart.pid}`)
    note(afterRestart.pid !== running.pid, '重启确实换了新进程', `${running.pid} -> ${afterRestart.pid}`)

    // 5) 停止
    await evaluate(send, `(async () => await window.dshClient.stop())()`)
    await sleep(1200)
    const stopped = await evaluate(send, `(async () => (await window.dshClient.getState()).server)()`)
    note(stopped.state === 'stopped', '停止后状态为 stopped', `state=${stopped.state}`)
    const portDown = await probe(TEST_PORT)
    note(portDown === 0, `端口 ${TEST_PORT} 已释放`, `HTTP ${portDown}`)
  } catch (error) {
    note(false, '测试过程异常', error.message)
  } finally {
    // 收尾：切回默认项目并删除测试项目
    try {
      const state = await evaluate(send, `(async () => await window.dshClient.getState())()`)
      const fallback = (state.config.projects || []).find((p) => p.id !== projectId)
      if (fallback) await evaluate(send, `(async () => await window.dshClient.setActiveProject(${JSON.stringify(fallback.id)}))()`)
      if (projectId) await evaluate(send, `(async () => await window.dshClient.removeProject(${JSON.stringify(projectId)}))()`)
    } catch { /* ignore */ }
    ws.close()
  }

  const after3080 = await probe(3080)
  note(after3080 > 0, '收尾检查：3080 上原有实例仍存活', `HTTP ${after3080}`)

  cleanup()
  await sleep(500)

  const failed = report.filter((r) => !r.ok).length
  console.log(`${'─'.repeat(60)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('验证脚本异常：', error.message)
  process.exit(1)
})
