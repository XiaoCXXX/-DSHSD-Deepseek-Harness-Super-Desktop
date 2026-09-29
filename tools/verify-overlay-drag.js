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

  // ---- 7. 拖动期间「尺寸冻结」
  // 反复闪烁的根源：拖动中任何一次 overlay:resize 都会让主进程重排整块透明视图。
  // 余额轮询刷新文本 → 悬浮条宽度变一两像素 → ResizeObserver 上报 → 视图重排 → 闪。
  // 这里在拖动中**故意**上报一个不同的尺寸，断言它被忽略、视图几何没变。
  // 先离开右边界，否则位移会被边界夹住，断言算不通。
  const geomBefore = (await evaluate(`window.dshClient.overlayMove({ dx: -300, dy: 120 })`)).pos
  // 先进入拖动状态
  await evaluate(`window.dshClient.overlayMove({ dx: 3, dy: 3, commit: false })`)
  const ignoredResize = await evaluate(`window.dshClient.overlayResize({ width: 400, height: 54 })`)
  note(ignoredResize && ignoredResize.ignored === true,
    '拖动中上报尺寸被忽略（几何冻结）', JSON.stringify(ignoredResize))
  // 拖动中仍然能改位置
  const movedDuringDrag = await evaluate(`window.dshClient.overlayMove({ dx: 5, dy: 5, commit: false })`)
  note(movedDuringDrag.ok && movedDuringDrag.pos.x === geomBefore.x + 8,
    '拖动中位置照样更新（只冻尺寸，不冻位置）',
    `期望 x=${geomBefore.x + 8}，实际 x=${movedDuringDrag.pos.x}`)
  // 松手解冻：此时尺寸上报应被接受
  await evaluate(`window.dshClient.overlayMove({ dx: 0, dy: 0 })`)
  await sleep(200)
  const acceptedResize = await evaluate(`window.dshClient.overlayResize({ width: 398, height: 54 })`)
  note(acceptedResize && acceptedResize.ignored !== true,
    '松手后尺寸上报被重新接受（解冻）', JSON.stringify(acceptedResize))

  // ---- 8. 拖动期间不因尺寸上报而改变位置（端到端：位置必须单调）
  await evaluate(`window.dshClient.overlayMove({ mode: 'reset' })`)
  await sleep(150)
  const monotonic = await evaluate(`(async () => {
    const base = (await window.dshClient.getState()).overlayPos
    const xs = []
    for (let i = 1; i <= 12; i++) {
      // 每一步都夹一次尺寸上报，模拟余额文本变化触发的 ResizeObserver
      window.dshClient.overlayResize({ width: 396 + (i % 2), height: 54 })
      const r = await window.dshClient.overlayMove({ dx: -6, dy: 2, commit: false })
      xs.push(r.pos.x)
    }
    await window.dshClient.overlayMove({ dx: 0, dy: 0 })
    return { base: base.x, xs }
  })()`)
  let backwards = 0
  for (let i = 1; i < monotonic.xs.length; i++) {
    if (monotonic.xs[i] !== monotonic.xs[i - 1] - 6) backwards++
  }
  note(backwards === 0, '拖动位置不受尺寸上报干扰（每一步精确 −6）',
    `${monotonic.xs.join(',')}`)

  // ---- 9. 拖动基准：必须用**屏幕**坐标，不能用 clientX/clientY
  //
  // 这是「拖动时来回闪烁」的真正原因，也是前面所有用例都漏掉的一条：
  // client 坐标是「相对叠加视图页面」的，而这个视图**正是被拖动的那个对象**。
  // 视图一移动 Δ，同一个静止的鼠标其 clientX 就跟着变 Δ，于是
  //     位移 = (clientX − startClientX) − sentX
  // 把视图自己的移动又算了一遍：视图前进 Δ → 上报 ≈ −2Δ → 被拉回去 → 再前进……
  // 形成正反馈，肉眼就是来回抖/闪。
  //
  // 关键：必须打**真实 pointer 事件**打到把手上，才能走到 bindDrag 里的运算。
  // 直接调 overlayMove 只是绕过渲染层在下发位移，测不到这段算术。
  // 合成事件的 x/y 是「相对视图」的，所以这里每步都按 OS 的真实行为换算：
  //     viewportX = 鼠标屏幕坐标 − 视图当前 x
  async function dragWithRealEvents(steps = 16, stepPx = 4) {
    await evaluate(`window.dshClient.overlayMove({ dx: -300, dy: 150 })`)
    // 等视图真正落位再开始拖：位移是相对**主进程当前 bounds** 累积的，
    // 上一次移动还没生效就按下会把那段位移算重，测出来是假的抖动。
    let last = null
    for (let i = 0; i < 20; i++) {
      await sleep(50)
      const st = await evaluate(`(async () => (await window.dshClient.getState()).overlayPos)()`)
      if (last && st.x === last.x && st.y === last.y) break
      last = st
    }
    const base = last
    const h = await evaluate(`(() => {
      const r = document.getElementById('dragHandle').getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    const cursor0 = { x: base.x + h.x, y: base.y + h.y }   // 按下时鼠标的屏幕坐标
    let view = { x: base.x, y: base.y }
    const at = (cursor) => ({ x: Math.round(cursor.x - view.x), y: Math.round(cursor.y - view.y) })

    const p0 = at(cursor0)
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', clickCount: 1, buttons: 1,
    })

    const xs = []
    const ys = []
    for (let i = 1; i <= steps; i++) {
      const cursor = { x: cursor0.x - i * stepPx, y: cursor0.y + i * 2 }
      const p = at(cursor)
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1,
      })
      await sleep(26)
      const st = await evaluate(`(async () => (await window.dshClient.getState()).overlayPos)()`)
      view = { x: st.x, y: st.y }
      xs.push(st.x)
      ys.push(st.y)
    }

    const pe = at({ x: cursor0.x - steps * stepPx, y: cursor0.y + steps * 2 })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: pe.x, y: pe.y, button: 'left', buttons: 0,
    })
    await sleep(150)
    return { startX: base.x, startY: base.y, xs, ys }
  }

  const real = await dragWithRealEvents()
  const expectTrack = Array.from({ length: 16 }, (_, i) => real.startX - 4 * (i + 1))
  const tracked = real.xs.every((v, i) => v === expectTrack[i])
  const stalled = real.xs.filter((v, i) => i > 0 && v === real.xs[i - 1]).length
  note(tracked, '真实 pointer 事件下 1:1 跟随鼠标（每步精确 −4）',
    tracked ? `${real.xs[0]} → ${real.xs[real.xs.length - 1]}`
      : `实际 ${real.xs.join(',')}`)
  note(stalled === 0, '拖动无「走一步停一步」（停步数应为 0）', `停步 ${stalled}`)
  note(real.xs[real.xs.length - 1] === real.startX - 64,
    '横向 16 步累计位移 = 鼠标总位移 64px',
    `${real.startX} → ${real.xs[real.xs.length - 1]}`)
  // 纵轴同样要 1:1：每步 +2
  const expectTrackY = Array.from({ length: 16 }, (_, i) => real.startY + 2 * (i + 1))
  const trackedY = real.ys.every((v, i) => v === expectTrackY[i])
  note(trackedY, '纵向同样 1:1 跟随（每步精确 +2）',
    trackedY ? `${real.ys[0]} → ${real.ys[real.ys.length - 1]}`
      : `实际 ${real.ys.join(',')}`)

  ws.close()
  cleanup()
  await sleep(500)
  const failed = report.filter((ok) => !ok).length
  console.log(`${'─'.repeat(58)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('验证异常：', e.message); process.exit(1) })
