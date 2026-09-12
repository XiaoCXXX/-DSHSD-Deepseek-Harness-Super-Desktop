'use strict'

// 验证「点宠物 → 余额 → 再点气泡 → 峰谷/台词」这条链路。
//   node .verify/verify-peak-flow.js
//
// 与之前那个探针的区别（之前误判过，记在这里）：
//   1. 三行文字各有**不同的类名**：A→dshwv-label、B→dshwv-amount、
//      P→dshwv-period、C→dshwv-hint。只读 label+amount 会漏掉峰谷行
//      （峰谷用的是 dshwv-period），从而误判成「没切换」。
//   2. swapBubbleContent 有 190ms 延时，采样必须等够。

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const report = []
const note = (ok, label, value) => {
  report.push(ok)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${value === undefined ? '' : `  ${value}`}`)
}

async function main() {
  const mod = await import(`file:///${path.join(ROOT, 'plugins', 'dsh-desktop-pet', 'lib', 'index.js').replace(/\\/g, '/')}`)
  const handlers = {}
  mod.apply({
    webServer: { register: (r) => { handlers[r.path] = r.handler; return () => {} }, tapIndex: () => () => {} },
    credentials: { resolve: async () => undefined },
    on: () => () => {}, effect: (fn) => fn(), logger: { warn() {}, info() {} }, get: () => undefined,
  })
  let widgetJs = null
  let imageBytes = null
  handlers['/dsh-pet/widget.js']({}, { writeHead() {}, end(b) { widgetJs = b } })
  handlers['/dsh-pet/image.png']({}, { writeHead() {}, end(b) { imageBytes = Buffer.isBuffer(b) ? b : Buffer.from(String(b)) } })

  const work = path.join(ROOT, '.verify', 'peak-flow')
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'pet.png'), imageBytes)

  const js = widgetJs.replace(/var IMG_URL = [^\n]*/, "var IMG_URL = 'pet.png'")

  fs.writeFileSync(path.join(work, 'index.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%}</style>
<script>
window.fetch = function (url) {
  const u = String(url)
  if (u.indexOf('size.json') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  if (u.indexOf('balance.json') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, currency: 'CNY', totalBalance: 147.18, todayUsage: 3.21 }) })
  if (u.indexOf('last-turn.json') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, seq: 0 }) })
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
}
// 读全部三行的**真实内容与显隐**。按类名取，因为三行用的类不同。
window.__peek = function () {
  var read = function (sel) {
    var el = document.querySelector(sel)
    if (!el) return null
    return { text: el.textContent, shown: el.style.display !== 'none' && getComputedStyle(el).display !== 'none', cls: el.className }
  }
  var b = document.querySelector('.dshwv-bubble')
  return {
    open: !!(b && b.classList.contains('dshwv-bubble-open')),
    label: read('.dshwv-label'),
    amount: read('.dshwv-amount'),
    period: read('.dshwv-period'),
    hint: read('.dshwv-hint'),
    // 三行里到底哪些可见
    visible: ['.dshwv-label', '.dshwv-amount', '.dshwv-period', '.dshwv-hint']
      .filter(function (s) { var e = document.querySelector(s); return e && e.style.display !== 'none' })
      .map(function (s) { return s.replace('.dshwv-', '') }),
  }
}
</script>
</head><body>
<script>
${js}
</script>
</body></html>`, 'utf8')

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const port = 9281
  const child = spawn(ELECTRON, [
    `--user-data-dir=${path.join(work, 'ud')}`, `--remote-debugging-port=${port}`,
    '--no-first-run', '--disable-gpu', '--window-size=900,760', path.join(work, 'index.html'),
  ], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {})
  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  let list = null
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { list = null }
    if (list && list.some((t) => t.url.includes('index.html'))) break
    list = null
  }
  if (!list) { console.error('CDP 未就绪'); cleanup(); process.exit(1) }

  const target = list.find((t) => t.url.includes('index.html'))
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

  await sleep(2500)

  const initial = await evaluate('window.__peek()')
  note(initial.label && initial.label.text === 'DeepSeek 余额', '初始显示余额标题', initial.label && initial.label.text)

  // 1) 点宠物弹气泡
  await evaluate(`(() => {
    const img = document.querySelector('.dshwv-img')
    const r = img.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + 20
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse' }))
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse' }))
    return true
  })()`)
  await sleep(1000)
  const opened = await evaluate('window.__peek()')
  note(opened.open === true, '点宠物后气泡打开')
  note(opened.label && opened.label.text === 'DeepSeek 余额', '第一屏是余额', opened.label && opened.label.text)

  // 2) 点气泡 → 应切到峰谷或台词（多次点击，因为随机组有权重）
  const seen = new Set()
  let sawPeriodOrAmount = false
  for (let i = 0; i < 12; i++) {
    await evaluate(`document.querySelector('.dshwv-bubble').click()`)
    await sleep(400)
    const s = await evaluate('window.__peek()')
    const sig = `${s.label && s.label.text}|${s.period && s.period.text}|${s.amount && s.amount.text}`
    seen.add(sig)
    if (s.visible.indexOf('period') >= 0) sawPeriodOrAmount = true
    // 每次点完等气泡关闭再重新点开（避免第二次点击变成「关闭」）
    await sleep(300)
    await evaluate(`(() => {
      const b = document.querySelector('.dshwv-bubble')
      if (b && !b.classList.contains('dshwv-bubble-open')) {
        const img = document.querySelector('.dshwv-img')
        const r = img.getBoundingClientRect()
        const x = r.left + r.width / 2, y = r.top + 20
        document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse' }))
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse' }))
      }
      return true
    })()`)
    await sleep(400)
  }

  console.log(`\n  采样到的不同内容组合：${seen.size} 种`)
  for (const s of seen) console.log(`    ${s}`)
  note(seen.size > 1, '点击气泡能切换到不同的内容', `${seen.size} 种`)
  note(sawPeriodOrAmount, '观察到峰谷行（dshwv-period）出现过')

  ws.close()
  cleanup()
  await sleep(500)
  const failed = report.filter((ok) => !ok).length
  console.log(`${'─'.repeat(58)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('验证异常：', e.message); process.exit(1) })
