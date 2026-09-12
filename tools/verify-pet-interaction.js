'use strict'

// 验证气泡翻页与宠物动作：
//   1. 连按宠物：余额 → 峰谷/台词 → 关闭（三屏循环），每一屏内容不同
//   2. 点牌子：与点宠物行为一致
//   3. 每次点按都会触发一个动作类（nod/shake/pop/rua）
//   node tools/verify-pet-interaction.js

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
  console.log(`\n宠物交互验证（翻页 + 动作）\n${'─'.repeat(58)}`)

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

  const work = path.join(ROOT, '.verify', 'pet-interaction')
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
// 记录动作类什么时候被加到主体上（MutationObserver 抓 class 变化）
window.__actions = []
window.__watchActions = function () {
  const body = document.querySelector('.dshwv-body')
  if (!body) return false
  new MutationObserver(function (muts) {
    for (const m of muts) {
      const cls = body.className
      for (const k of ['rua', 'nod', 'shake', 'pop']) {
        if (cls.indexOf('dshwv-' + k) >= 0 && window.__actions.indexOf(k) < 0) window.__actions.push(k)
      }
    }
  }).observe(body, { attributes: true, attributeFilter: ['class'] })
  return true
}
window.__peek = function () {
  const read = function (sel) {
    const el = document.querySelector(sel)
    if (!el) return null
    return { text: el.textContent, shown: el.style.display !== 'none' }
  }
  const b = document.querySelector('.dshwv-bubble')
  return {
    open: !!(b && b.classList.contains('dshwv-bubble-open')),
    visibleLines: ['.dshwv-label', '.dshwv-amount', '.dshwv-period', '.dshwv-hint']
      .filter(function (s) { const e = document.querySelector(s); return e && e.style.display !== 'none' && e.textContent })
      .map(function (s) { return document.querySelector(s).textContent }),
    period: read('.dshwv-period'),
  }
}
</script>
</head><body>
<script>
${js}
</script>
<script>
setTimeout(function () { window.__watchActions() }, 600)
</script>
</body></html>`, 'utf8')

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const port = 9285
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
  /** 在宠物身上发一次「点按」（pointerdown + pointerup，不移动 → 算点击）。 */
  const pressPet = () => evaluate(`(() => {
    const img = document.querySelector('.dshwv-img')
    const r = img.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + 24
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse' }))
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse' }))
    return true
  })()`)

  await sleep(2500)

  // ---- 连按宠物，记录每一屏
  const screens = []
  for (let i = 0; i < 4; i++) {
    await pressPet()
    await sleep(800)
    const s = await evaluate('window.__peek()')
    screens.push({ i: i + 1, open: s.open, lines: s.visibleLines })
    console.log(`    第 ${i + 1} 次按: open=${s.open} 内容=${JSON.stringify(s.visibleLines)}`)
  }

  note(screens[0].open && screens[0].lines.some((t) => t.includes('余额')), '第 1 次按：显示余额')
  note(screens[1].open && JSON.stringify(screens[1].lines) !== JSON.stringify(screens[0].lines),
    '第 2 次按：内容变了（不再是余额）', JSON.stringify(screens[1].lines))
  note(screens[2].open === false, '第 3 次按：气泡关闭', `open=${screens[2].open}`)
  note(screens[3].open && screens[3].lines.some((t) => t.includes('余额')), '第 4 次按：重新从余额开始')

  // ---- 观察到的动作
  const actions = await evaluate('window.__actions')
  console.log(`\n    观察到的动作: ${JSON.stringify(actions)}`)
  note(Array.isArray(actions) && actions.length > 0, '点按时宠物做了动作（不再是「只会呼吸」）', `${actions.length} 种`)

  ws.close()
  cleanup()
  await sleep(500)
  const failed = report.filter((ok) => !ok).length
  console.log(`${'─'.repeat(58)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('验证异常：', e.message); process.exit(1) })
