'use strict'

// 验证悬浮栏拖动的行为与性能：
//   1. 位移能精确累积（dx/dy 增量叠加后 = 目标位置）
//   2. 拖动过程中**不写磁盘**，松手才写（这是卡顿的根源）
//   3. 边界夹取：拖出窗口外会被拉回可视范围
//   4. 复位：mode:'reset' 回到右上角
//   node tools/verify-overlay-drag.js

delete process.env.ELECTRON_RUN_AS_NODE

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SANDBOX = path.join(ROOT, '.verify', 'overlay-drag')
const USER_DATA = path.join(SANDBOX, 'userdata')
const CDP_PORT = 9263
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const report = []
  const note = (ok, label, value) => {
    report.push(ok)
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value === undefined ? '' : `  ${value}`}`)
  }

  console.log(`\n悬浮栏拖动验证（CDP ${CDP_PORT}）\n${'─'.repeat(58)}`)

  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  const configFile = path.join(USER_DATA, 'config.json')
  fs.writeFileSync(configFile, JSON.stringify({
    version: 1,
    projects: [{ id: 'p', name: 'drag', cwd: ROOT, port: 3080 }],
    activeProjectId: 'p',
    autoStartOnLaunch: false,
    openUiOnStart: false,
    adoptExternal: true,
    stopServerOnQuit: false,
    surface: 'bar',
    autoSurface: false,
  }, null, 2))

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(ELECTRON, ['.', '--hidden', `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {})
  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  let list = null
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json() } catch { list = null }
    if (list && list.some((t) => t.url.includes('control.html'))) break
    list = null
  }
  if (!list) { console.error('CDP 未就绪'); cleanup(); process.exit(1) }

  const target = list.find((t) => t.url.includes('control.html'))
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS')) })
  let seq = 0
  const send = (method, params = {}, timeout = 20000) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(new Error('超时')), timeout)
    const onMessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== id) return
      clearTimeout(timer); ws.removeEventListener('message', onMessage)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '抛错')
    return r.result?.value
  }

  await sleep(3000)

  const before = await evaluate(`(async () => (await window.dshClient.getState()).overlayPos)()`)
  note(Boolean(before), '拿到初始位置', JSON.stringify(before))

  // 先把面板拖到窗口中间，远离边界——否则边界夹取会干扰后面的累积断言。
  // （初始位置就是右上角贴边，往右拖会被夹住，这是**正确行为**，
  //   但会让「位移是否精确累积」这个断言算不通。）
  const away = await evaluate(`window.dshClient.overlayMove({ dx: -400, dy: 200 })`)
  note(away.ok, '先移到窗口中间（脱离边界）', JSON.stringify(away.pos))
  const base = away.pos

  const diskBefore = fs.statSync(configFile).mtimeMs

  // ---- 1. 模拟拖动：一串增量（不 commit）
  const moves = [{ dx: 10, dy: 5 }, { dx: -30, dy: 20 }, { dx: 12, dy: -8 }, { dx: 5, dy: 5 }]
  let last = null
  for (const m of moves) {
    last = await evaluate(`window.dshClient.overlayMove({ dx: ${m.dx}, dy: ${m.dy}, commit: false })`)
  }
  const totalDx = moves.reduce((a, m) => a + m.dx, 0)
  const totalDy = moves.reduce((a, m) => a + m.dy, 0)
  const expectX = base.x + totalDx
  const expectY = base.y + totalDy
  note(last.pos.x === expectX && last.pos.y === expectY,
    '位移精确累积',
    `期望 (${expectX},${expectY})，实际 (${last.pos.x},${last.pos.y})`)

  // ---- 2. 拖动期间不该写盘
  await sleep(500)
  const diskDuringDrag = fs.statSync(configFile).mtimeMs
  note(diskDuringDrag === diskBefore, '拖动过程中不写磁盘（卡顿的根源）',
    diskDuringDrag === diskBefore ? '' : '文件被改了')

  // ---- 3. 松手才落盘
  const committed = await evaluate(`window.dshClient.overlayMove({ dx: 1, dy: 1 })`)
  await sleep(600)
  const diskAfterCommit = fs.statSync(configFile).mtimeMs
  note(diskAfterCommit > diskBefore, '松手（不带 commit:false）时落盘')
  const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  note(saved.overlayPos && saved.overlayPos.x === committed.pos.x,
    '落盘的位置与内存一致', JSON.stringify(saved.overlayPos))

  // ---- 4. 边界夹取：往左上角拖很远
  const clamped = await evaluate(`window.dshClient.overlayMove({ dx: -99999, dy: -99999 })`)
  note(clamped.pos.x >= 14 && clamped.pos.y >= 14, '拖出边界会被夹回可视范围',
    `(${clamped.pos.x},${clamped.pos.y})`)

  // ---- 5. 复位
  const reset = await evaluate(`window.dshClient.overlayMove({ mode: 'reset' })`)
  await sleep(500)
  const afterReset = JSON.parse(fs.readFileSync(configFile, 'utf8')).overlayPos
  note(reset.pos.x > 500, 'reset 回到右上角', JSON.stringify(reset.pos))
  note(afterReset && afterReset.x === reset.pos.x, '复位结果已落盘')

  // ---- 6. 拖动一帧的 IPC 次数（性能）：模拟 60 次 pointermove
  const timing = await evaluate(`(async () => {
    const t0 = performance.now()
    for (let i = 0; i < 60; i++) {
      await window.dshClient.overlayMove({ dx: 1, dy: 0, commit: false })
    }
    return performance.now() - t0
  })()`)
  note(timing < 1500, `60 次拖动上报耗时 ${timing.toFixed(0)}ms（越低越顺）`)

  ws.close()
  cleanup()
  await sleep(500)
  const failed = report.filter((ok) => !ok).length
  console.log(`${'─'.repeat(58)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('验证异常：', e.message); process.exit(1) })
