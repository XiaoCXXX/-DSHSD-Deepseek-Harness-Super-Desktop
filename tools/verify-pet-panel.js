'use strict'

// 验证重做后的宠物设置面板：
//   1. 结构：4 张分组卡片、字段齐全、控件类型正确
//   2. 主题适配：注入主题令牌后，面板的 bg/color 跟着变（浅色 + 暗色各测一次）
//   3. 自绘开关：点击能切换 aria-checked 并回调到状态
//   4. 悬停提示：字段标签带 data-hint
//   node tools/verify-pet-panel.js

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = path.join(ROOT, '.verify')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 起一个预览页，带上指定的主题令牌。 */
async function render(theme, port) {
  const mod = await import(`file:///${path.join(ROOT, 'plugins', 'dsh-desktop-pet', 'lib', 'index.js').replace(/\\/g, '/')}`)
  const handlers = {}
  mod.apply({
    webServer: {
      register: (r) => { handlers[r.path] = r.handler; return () => {} },
      tapIndex: () => () => {},
    },
    credentials: { resolve: async () => undefined },
    on: () => () => {},
    effect: (fn) => fn(),
    logger: { warn() {}, info() {} },
    get: () => undefined,
  })
  let widgetJs = null
  let imageBytes = null
  handlers['/dsh-pet/widget.js']({}, { writeHead() {}, end(b) { widgetJs = b } })
  handlers['/dsh-pet/image.png']({}, { writeHead() {}, end(b) { imageBytes = Buffer.isBuffer(b) ? b : Buffer.from(String(b)) } })

  const work = path.join(OUT, `panel-${theme}`)
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'pet.png'), imageBytes)

  const T = theme === 'dark'
    ? { bg: '#0B1220', text: '#EAF0FF', brand: '#5B7BFF' }
    : { bg: '#FFFFFF', text: '#1B2337', brand: '#2F5BD7' }
  const patched = widgetJs.replace(/var IMG_URL = [^\n]*/, "var IMG_URL = 'pet.png'")

  // 注入的令牌名必须与 DSH 真实声明的名字一致。
  // 这里以前写的是 --dsw-alias-text-primary —— DSH 根本没有这个令牌，
  // 于是「测试自己造了一个假令牌」：插件用 var(假名字, 兜底) 也照样取到测试注入的值，
  // 测试全绿，而在真实 DSH 里 var() 永远落到兜底的深蓝 #203170，
  // 暗色主题下就成了深蓝字压深色底，完全读不了。
  // 正文色的真实名字是 --dsw-alias-label-primary（见 tokens 静态断言）。
  fs.writeFileSync(path.join(work, 'index.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>:root{--dsw-alias-bg-base:${T.bg}!important;--dsw-alias-label-primary:${T.text}!important;--dsw-alias-brand-primary:${T.brand}!important}
html,body{margin:0;height:100%;background:${T.bg}}</style>
</head><body>
<script>
window.fetch = function (url) {
  const u = String(url)
  if (u.indexOf('size.json') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  if (u.indexOf('balance.json') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, currency: 'CNY', totalBalance: 147.18, todayUsage: 3.21 }) })
  if (u.indexOf('last-turn.json') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, seq: 0 }) })
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
}
</script>
<script>
${patched}
</script>
<script>
setTimeout(function () {
  const gear = document.querySelector('.dshwv-gear')
  if (gear) gear.click()
}, 900)
</script>
</body></html>`, 'utf8')

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(ELECTRON, [
    `--user-data-dir=${path.join(work, 'ud')}`,
    `--remote-debugging-port=${port}`, '--no-first-run', '--disable-gpu',
    '--window-size=760,700',
    path.join(work, 'index.html'),
  ], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {})

  let list = null
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { list = null }
    if (list && list.some((t) => t.url.includes('index.html'))) break
    list = null
  }
  if (!list) { child.kill(); throw new Error('CDP 未就绪') }

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
  await sleep(2200)
  return { child, ws, evaluate }
}

async function main() {
  const report = []
  const note = (ok, label, value) => {
    report.push(ok)
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value === undefined ? '' : `  ${value}`}`)
  }

  console.log(`\n宠物设置面板验证\n${'─'.repeat(58)}`)

  // ---- 0. 静态：插件引用的每个 --dsw-* 令牌都必须在 DSH 里真实存在
  // 这是「字体变蓝不可读」那类 bug 的总闸门：引用一个不存在的令牌时，
  // var() 不会报错，只会静默落到兜底值 —— 而兜底值是给浅色底设计的深蓝，
  // 一旦主题把背景变深，文字就糊在背景里了。CSS 层看不出任何异常，只有这条断言能拦住。
  const petFile = path.join(ROOT, 'plugins', 'dsh-desktop-pet', 'lib', 'index.js')
  const themePkg = [
    path.join(ROOT, 'vendor', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'),
    path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'),
  ].find((p) => fs.existsSync(p))
  if (!themePkg) {
    note(false, '找不到 DSH 主题包，无法校验令牌表')
  } else {
    const declared = new Set(
      (fs.readFileSync(themePkg, 'utf8').match(/--dsw-[a-z0-9-]+/g) || []))
    const used = new Set(
      (fs.readFileSync(petFile, 'utf8').match(/--dsw-[a-z0-9-]+/g) || []))
    // --dsw-alias-text-primary 只允许出现在 var() 的第二层兼容兜底里
    const allowedAsFallback = new Set(['--dsw-alias-text-primary'])
    const missing = [...used].filter((t) => !declared.has(t) && !allowedAsFallback.has(t))
    note(missing.length === 0,
      `引用的 ${used.size} 个 --dsw-* 令牌全部真实存在`,
      missing.length ? `不存在: ${missing.join(', ')}` : [...used].join(' '))
  }

  // ---- 浅色
  const light = await render('light', 9273)
  const shape = await light.evaluate(`(() => {
    const p = document.querySelector('.dshwv-panel')
    const cs = getComputedStyle(p)
    return {
      open: p.classList.contains('dshwv-panel-open'),
      bg: cs.backgroundColor,
      color: cs.color,
      radius: cs.borderRadius,
      cards: [...p.querySelectorAll('.dshwv-card')].map((c) => ({
        t: c.querySelector('.dshwv-card-title').textContent,
        n: c.querySelectorAll('.dshwv-field').length,
      })),
      fields: [...p.querySelectorAll('.dshwv-field-label')].map((l) => l.textContent),
      hints: p.querySelectorAll('.dshwv-field-label[data-hint]').length,
      switches: p.querySelectorAll('.dshwv-switch').length,
      selects: p.querySelectorAll('.dshwv-select').length,
      numbers: p.querySelectorAll('.dshwv-number').length,
      ranges: p.querySelectorAll('.dshwv-range').length,
      legacyMenu: p.querySelectorAll('.dshwv-menu-row, .dshwv-check, .dshwv-menu-sep, .dshwv-menu-btn').length,
      cardsHaveTitle: [...p.querySelectorAll('.dshwv-card-title')].every((t) => t.textContent.trim().length > 0),
    }
  })()`)

  note(shape.open, '面板已展开')
  note(shape.cards.length === 4, '4 张分组卡片', shape.cards.map((c) => `${c.t}(${c.n})`).join(' '))
  note(shape.cardsHaveTitle, '每张卡都有标题')
  note(shape.fields.length === 10, '10 个配置字段', shape.fields.join(' / '))
  note(shape.hints === shape.fields.length, '每个字段都有悬停解释', `${shape.hints}/${shape.fields.length}`)
  note(shape.switches === 3, '3 个自绘开关', String(shape.switches))
  note(shape.selects === 3, '3 个下拉', String(shape.selects))
  note(shape.numbers === 3, '3 个数字输入', String(shape.numbers))
  note(shape.ranges === 1, '1 个滑块', String(shape.ranges))
  note(shape.legacyMenu === 0, '没有旧菜单残留元素（menu-row/check/sep/menu-btn）')
  note(shape.radius === '14px', '卡片式圆角', shape.radius)

  // ---- 主题适配（浅色）
  note(shape.bg === 'rgb(255, 255, 255)', '浅色：bg 跟随 --dsw-alias-bg-base', shape.bg)
  note(shape.color === 'rgb(27, 35, 55)', '浅色：文字跟随 --dsw-alias-label-primary', shape.color)
  note(shape.color !== 'rgb(32, 49, 112)',
    '浅色：文字**不是**兜底色 #203170（说明令牌真的解析到了）', shape.color)

  // ---- 开关交互
  const sw = await light.evaluate(`(() => {
    const el = document.querySelector('.dshwv-switch')
    const before = el.getAttribute('aria-checked')
    el.click()
    const after = el.getAttribute('aria-checked')
    return { before, after, isButton: el.tagName === 'BUTTON', hasRole: el.getAttribute('role') === 'switch' }
  })()`)
  note(sw.before !== sw.after, '自绘开关点击能切换', `${sw.before} → ${sw.after}`)
  note(sw.isButton && sw.hasRole, '开关语义正确（button + role=switch）')

  light.ws.close()
  try { execFileSync('taskkill', ['/PID', String(light.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  await sleep(1200)

  // ---- 暗色
  const dark = await render('dark', 9275)
  const darkShape = await dark.evaluate(`(() => {
    const p = document.querySelector('.dshwv-panel')
    const cs = getComputedStyle(p)
    return {
      bg: cs.backgroundColor,
      color: cs.color,
      cardBg: getComputedStyle(p.querySelector('.dshwv-card')).backgroundColor,
      switchBg: getComputedStyle(p.querySelector('.dshwv-switch')).backgroundColor,
    }
  })()`)
  note(darkShape.bg === 'rgb(11, 18, 32)', '暗色：面板底跟随主题变深', darkShape.bg)
  note(darkShape.color === 'rgb(234, 240, 255)', '暗色：文字变浅', darkShape.color)
  note(darkShape.cardBg !== 'rgba(0, 0, 0, 0)', '暗色：卡片底是半透明叠加（不是死白）', darkShape.cardBg)

  // ---- 可读性：文字与面板底的对比度必须够
  // 这条是用户报的「字体变蓝、不可读」的直接防线：
  // 暗色主题下如果文字落到深蓝兜底色 #203170，对比度会低到 1.2 左右，一眼就能看出来。
  const contrast = (fg, bg) => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const a = lum(parse(fg)); const c = lum(parse(bg))
    return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)
  }
  const lightRatio = contrast(shape.color, shape.bg)
  note(lightRatio >= 4.5, `浅色对比度 ${lightRatio.toFixed(2)}:1（≥4.5 可读）`)
  const darkRatio = contrast(darkShape.color, darkShape.bg)
  note(darkRatio >= 4.5, `暗色对比度 ${darkRatio.toFixed(2)}:1（≥4.5 可读）`)

  dark.ws.close()
  try { execFileSync('taskkill', ['/PID', String(dark.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  await sleep(800)

  const failed = report.filter((ok) => !ok).length
  console.log(`${'─'.repeat(58)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('验证异常：', e.message); process.exit(1) })
