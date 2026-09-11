'use strict'

// 主题 × 客户端形态 的验证矩阵。
//   node tools/verify-matrix.js              全部格子
//   node tools/verify-matrix.js --themes=dsh-white-blue,ocean
//   node tools/verify-matrix.js --surfaces=bar,bubble
//
// 为什么要矩阵：之前每修一个主题 bug 都只测自己刚改的那条路径，
// 结果反复漏掉同构的其它路径（切回原生主题修了、原生↔原生又漏；
// 控制台测了、悬浮窗又漏）。这里把「主题 × 形态」全组合跑一遍。
//
// 每个格子验的是**实际计算样式**，不是「属性设上了没有」。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = path.join(ROOT, '.verify')
const USER_DATA = path.join(OUT, 'userdata-matrix')
const CDP_PORT = 9237
const SERVICE = 'http://127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const THEME_FILE = path.join(DSH_HOME, '.dsh-theme.json')

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3).split(',') : fallback
}

const THEMES = arg('themes', ['dsh-white-blue', 'dsh-dark', 'ice', 'ocean', 'midnight', 'contrast'])
// 悬浮窗是独立窗口，单独验；control.html 在 bar / console 下都渲染，所以合成的 surface 值取 bar/console
const SURFACES = arg('surfaces', ['bubble', 'bar', 'console'])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const childEnv = () => { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; return e }

const report = []
const note = (ok, label, value) => {
  report.push({ ok, label })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${value === undefined ? '' : `  ${value}`}`)
}

async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json() } catch { return null }
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('WS 失败')) })
  let seq = 0
  const send = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(new Error(`${method} 超时`)), timeout)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
  return { ws, send }
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '页面抛错')
  return r.result?.value
}

/** 客户端界面的主题状态（control.html 与 bubble.html 共用同一套 --c-* 令牌）。 */
const CLIENT_PROBE = `(() => {
  const cs = getComputedStyle(document.body)
  const panel = document.getElementById('bubble') || document.getElementById('root')
  return {
    theme: document.body.dataset.theme || null,
    accent: cs.getPropertyValue('--c-accent').trim(),
    text: cs.color,
    panelBg: panel ? getComputedStyle(panel).backgroundColor : null,
  }
})()`

/** DSH 页面的主题状态。 */
const DSH_PROBE = `(() => {
  const body = document.body
  const root = document.documentElement
  const read = (el) => getComputedStyle(el).getPropertyValue('--dsw-alias-bg-base').trim()
  return {
    applied: window.__dshThemePack ? window.__dshThemePack.appliedTheme : null,
    dark: body.hasAttribute('data-ds-dark-theme'),
    rootVar: read(root),
    bodyVar: read(body),
    leftovers: (() => {
      const names = []
      for (const el of [document.documentElement, document.body]) {
        for (let i = 0; i < el.style.length; i++) if (el.style[i].indexOf('--dsw-') === 0) names.push(el.style[i])
      }
      return names.length
    })(),
  }
})()`

async function main() {
  console.log(`\n主题 × 形态 验证矩阵\n${'─'.repeat(62)}`)
  console.log(`  主题   : ${THEMES.join(', ')}`)
  console.log(`  形态   : ${SURFACES.join(', ')}`)

  // 服务端主题清单（拿每套主题的 colorScheme，用于断言基底模式）
  const catalog = await fetch(`${SERVICE}/dsh-theme/theme.json`).then((r) => r.json()).catch(() => null)
  if (!catalog) {
    console.error(`${SERVICE}/dsh-theme/theme.json 不可达——确认 dsh web 在跑且带 dsh-theme-pack`)
    process.exit(1)
  }
  const scheme = new Map(catalog.themes.map((t) => [t.id, t.colorScheme]))
  const native = new Map(catalog.themes.map((t) => [t.id, Boolean(t.native)]))
  const original = catalog.theme

  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.writeFileSync(path.join(USER_DATA, 'config.json'), JSON.stringify({
    version: 1,
    projects: [{ id: 'p-m', name: 'matrix', cwd: ROOT, port: 3080 }],
    activeProjectId: 'p-m',
    autoStartOnLaunch: false,
    openUiOnStart: false,
    adoptExternal: true,
    stopServerOnQuit: false,
    theme: THEMES[0],
    surface: SURFACES[0],
    autoSurface: false,
  }, null, 2))

  const child = spawn(ELECTRON, ['.', '--hidden', `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`], {
    cwd: ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  // bubble.html 只在形态切到 bubble 时才被创建，所以开局**不能**等它，
  // 否则永远等不到（曾经就是这么死锁的）。先等两个常驻 target。
  let list = null
  for (let i = 0; i < 45; i++) {
    await sleep(1000)
    list = await targets()
    const ready = list &&
      list.some((t) => t.url.includes('control.html')) &&
      list.some((t) => /127\.0\.0\.1:3080/.test(t.url))
    if (ready) break
    list = null
  }
  if (!list) {
    console.error('CDP 未就绪（需要 control.html 与 DSH 页面）')
    cleanup()
    process.exit(1)
  }

  const dsh = await connect(list.find((t) => t.type === 'page' && /127\.0\.0\.1:3080/.test(t.url)))
  const control = await connect(list.find((t) => t.url.includes('control.html')))
  await sleep(3000)

  /** 需要时再去连悬浮窗；它会按需创建。 */
  async function connectBubble() {
    for (let i = 0; i < 20; i++) {
      const now = await targets()
      const target = now && now.find((t) => t.url.includes('bubble.html'))
      if (target) return connect(target)
      await sleep(1000)
    }
    return null
  }

  /** 通过客户端下拉切主题（会写 state 文件、推 state、两侧各自更新）。 */
  const setTheme = (id) => evaluate(control.send, `(() => {
    const s = document.getElementById('optTheme')
    s.value = ${JSON.stringify(id)}
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return document.body.dataset.theme
  })()`)

  const setSurface = (value) => evaluate(control.send, `window.dshClient.setSurface(${JSON.stringify(value)})`)

  let cells = 0
  let bad = 0
  let bubble = null

  for (const surface of SURFACES) {
    console.log(`\n— 形态 ${surface} —`)
    await setSurface(surface === 'console' ? 'console' : surface === 'bubble' ? 'bubble' : 'bar')
    await sleep(2500)

    // 该形态下客户端界面的观测点。悬浮窗是独立窗口，切过去之后才有 target。
    if (surface === 'bubble' && !bubble) {
      bubble = await connectBubble()
      if (!bubble) {
        note(false, '悬浮窗 target 出现')
        continue
      }
      await sleep(1500)
    }
    const clientTarget = surface === 'bubble' ? bubble : control

    for (const theme of THEMES) {
      cells += 1
      const applied = await setTheme(theme)
      await sleep(4200)   // 等 applier 轮询（3s）+ 余量

      const client = await evaluate(clientTarget.send, CLIENT_PROBE)
      const dshState = await evaluate(dsh.send, DSH_PROBE)
      const wantScheme = scheme.get(theme)
      const wantDark = wantScheme === 'dark'
      const wantsVars = !native.get(theme)

      const problems = []
      if (applied !== theme) problems.push(`客户端下拉未生效(${applied})`)
      if (client.theme !== theme) problems.push(`${surface} 客户端属性=${client.theme}`)
      if (!client.accent) problems.push(`${surface} 没有 --c-accent`)
      if (dshState.applied !== theme) problems.push(`DSH applied=${dshState.applied}`)
      if (dshState.dark !== wantDark) problems.push(`基底模式=${dshState.dark} 期望 ${wantDark}`)
      if (wantsVars && dshState.leftovers === 0) problems.push('非原生主题却没有写入任何 --dsw-* 变量')
      if (!wantsVars && dshState.leftovers !== 0) problems.push(`原生主题残留 ${dshState.leftovers} 个 --dsw-*`)

      if (problems.length === 0) {
        console.log(`  ✅ ${surface} × ${theme}${wantsVars ? '' : '（原生）'}  dark=${dshState.dark} leftovers=${dshState.leftovers}`)
      } else {
        bad += 1
        console.log(`  ❌ ${surface} × ${theme}  ${problems.join('；')}`)
      }
    }
  }

  // 收尾：把主题还原成进来时的那个，别把用户停在测试状态
  await setTheme(original)
  await sleep(1200)

  dsh.ws.close(); control.ws.close()
  if (bubble) bubble.ws.close()
  cleanup()
  await sleep(500)

  const pass = cells - bad
  console.log(`\n${'─'.repeat(62)}`)
  console.log(`矩阵：${pass}/${cells} 格通过${bad === 0 ? '' : `，${bad} 格失败`}`)
  console.log(`（主题已还原为 ${original}）\n`)
  process.exit(bad === 0 ? 0 : 1)
}

main().catch((error) => { console.error('矩阵验证异常：', error.message); process.exit(1) })
