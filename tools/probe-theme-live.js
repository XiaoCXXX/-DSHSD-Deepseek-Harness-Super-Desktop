'use strict'

// 在深色主题下巡检 DSH 页面：找出**底色仍然很亮**的元素。
// 深色主题里还亮着的区域，就是没有被主题覆盖、用户看到「颜色不变」的地方。
//   node tools/probe-theme-live.js

delete process.env.ELECTRON_RUN_AS_NODE

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USER_DATA = path.join(ROOT, '.verify', 'probe-theme-userdata')
const PORT = 9241
const DARK_THEME = 'midnight'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  } catch {
    return null
  }
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('WS 失败')) })
  let seq = 0
  const send = (method, params = {}, timeout = 30000) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => reject(new Error(`${method} 超时`)), timeout)
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, send }
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || '页面脚本抛错')
  return result.result?.value
}

/** 列出底色偏亮、面积达标的可见元素（深色主题下这些就是漏网的） */
const FIND_LIGHT = `(() => {
  const lum = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c)
    if (!m) return null
    const p = m[1].split(',').map((x) => parseFloat(x))
    if (p.length >= 4 && p[3] < 0.5) return null   // 太透明，忽略
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
  }
  const out = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width < 80 || r.height < 28) continue
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.2) continue
    const l = lum(s.backgroundColor)
    if (l === null || l < 190) continue
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 70),
      id: el.id || '',
      bg: s.backgroundColor,
      area: Math.round(r.width * r.height),
      pos: Math.round(r.x) + ',' + Math.round(r.y),
      size: Math.round(r.width) + 'x' + Math.round(r.height),
      corner: (r.y < innerHeight / 3 ? '上' : r.y > innerHeight * 2 / 3 ? '下' : '中') + (r.x < innerWidth / 3 ? '左' : r.x > innerWidth * 2 / 3 ? '右' : '中'),
    })
  }
  out.sort((a, b) => b.area - a.area)
  return out
})()`

async function main() {
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(ELECTRON, ['.', '--hidden', `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env,
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  let list = null
  for (let i = 0; i < 45; i++) {
    await sleep(1000)
    list = await targets()
    if (list && list.some((t) => t.url.includes('control.html')) && list.some((t) => /127\.0\.0\.1:\d+/.test(t.url))) break
    list = null
  }
  if (!list) { console.error('未就绪'); cleanup(); process.exit(1) }

  const overlay = await connect(list.find((t) => t.url.includes('control.html')))
  const dsh = await connect(list.find((t) => /127\.0\.0\.1:\d+/.test(t.url)))
  await sleep(3000)

  await evaluate(overlay.send, `(async () => { await window.dshClient.patchConfig({ theme: ${JSON.stringify(DARK_THEME)} }); })()`)
  await sleep(8000)

  const info = await evaluate(dsh.send, `(async () => { const r = await fetch('/dsh-theme/theme.json',{cache:'no-store'}); return r.json() })()`)
  console.log(`\n深色主题（${DARK_THEME}）下的亮色残留巡检`)
  console.log(`主题状态：${JSON.stringify({ theme: info.theme, colorScheme: info.colorScheme, vars: info.vars ? Object.keys(info.vars).length : 0 })}`)
  console.log('═'.repeat(78))

  const light = await evaluate(dsh.send, FIND_LIGHT)
  console.log(`底色偏亮、面积达标的元素：${light.length} 个（按面积降序）\n`)
  for (const e of light.slice(0, 30)) {
    console.log(`  ${String(e.area).padStart(8)} ${e.corner.padEnd(4)} ${e.size.padEnd(11)} @${e.pos.padEnd(11)} ${e.bg.padEnd(22)} ${e.tag}.${e.cls}${e.id ? ' #' + e.id : ''}`)
  }

  // 同时看一下打字框：所有 textarea / contenteditable / 搜索框
  const inputs = await evaluate(dsh.send, `(() => {
    const out = []
    for (const el of document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""], input')) {
      const r = el.getBoundingClientRect()
      if (r.width < 40) continue
      const s = getComputedStyle(el)
      out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className||'').slice(0,50), ph: el.getAttribute('placeholder') || '',
                 size: Math.round(r.width)+'x'+Math.round(r.height), pos: Math.round(r.x)+','+Math.round(r.y),
                 bg: s.backgroundColor, border: s.borderTopColor, color: s.color })
    }
    return out
  })()`)
  console.log(`\n输入类元素（${inputs.length} 个）：`)
  for (const e of inputs) {
    console.log(`  ${e.size.padEnd(11)} @${e.pos.padEnd(11)} bg=${e.bg.padEnd(22)} border=${e.border.padEnd(20)} ${e.tag}.${e.cls} ${e.ph ? '「' + e.ph.slice(0, 20) + '」' : ''}`)
  }

  overlay.ws.close()
  dsh.ws.close()
  cleanup()
  await sleep(500)
}

main().catch((error) => {
  console.error('探针异常：', error.message)
  process.exit(1)
})
