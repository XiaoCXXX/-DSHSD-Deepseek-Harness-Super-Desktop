'use strict'

// 端到端验证「一次切换同时作用于两个平面」：
//   客户端切主题 → 写 config.json + $DSH_HOME/.dsh-theme.json
//   → dsh-theme-pack 的 GET 返回新调色板 → 注入的 applier 改写 --dsw-* 与基底模式
//   → DSH 界面的实际计算样式随之变化
//
//   node tools/verify-dsh-theme.js      需要 3080 上已有 dsh web（含 dsh-theme-pack）

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT_DIR = path.join(ROOT, '.verify')
const USER_DATA = path.join(OUT_DIR, 'userdata-dsh-theme')
const CDP_PORT = 9233
const SERVICE = 'http://127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const THEME_FILE = path.join(DSH_HOME, '.dsh-theme.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const report = []
const note = (ok, label, value) => {
  report.push({ ok, label, value })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${value ? `  ${value}` : ''}`)
}

async function cdpTargets() {
  try {
    return await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  } catch {
    return null
  }
}

async function connect(target, defaultTimeout = 20000) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })
  let seq = 0
  const send = (method, params = {}, timeout = defaultTimeout) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => reject(new Error(`${method} 超时`)), timeout)
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

async function evaluate(send, expression, attempts = 4) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, 15000)
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || '页面脚本抛错')
      return result.result?.value
    } catch (error) {
      lastError = error
      if (!String(error.message).includes('超时')) throw error
      await sleep(1000)
    }
  }
  throw lastError
}

/** 读取 DSH 页面里主题相关的真实状态。 */
const DSH_PROBE = `(() => {
  const body = document.body
  const root = document.documentElement
  const read = (el) => getComputedStyle(el).getPropertyValue('--dsw-alias-bg-base').trim()
  return {
    scriptTag: Boolean(document.querySelector('script[src="/dsh-theme/theme.js"]')),
    applier: typeof window.__dshThemePack === 'object' && window.__dshThemePack !== null,
    appliedTheme: window.__dshThemePack ? window.__dshThemePack.appliedTheme : null,
    darkAttr: body.hasAttribute('data-ds-dark-theme'),
    bodyVar: read(body),
    rootVar: read(root),
    bodyBg: getComputedStyle(body).backgroundColor,
    rootBg: getComputedStyle(root).backgroundColor,
  }
})()`

async function main() {
  const probe = await fetch(`${SERVICE}/dsh-theme/theme.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  if (!probe) {
    console.error(`${SERVICE}/dsh-theme/theme.json 不可达：请确认 dsh web 已带 dsh-theme-pack 重启`)
    process.exit(1)
  }
  console.log('— dsh-theme-pack 服务端 —')
  note(probe.themes.length === 6, '服务端列出 6 套主题', String(probe.themes.length))

  // 用 ocean 启动客户端：主进程会把主题写进 $DSH_HOME/.dsh-theme.json
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.writeFileSync(
    path.join(USER_DATA, 'config.json'),
    JSON.stringify(
      {
        version: 1,
        projects: [{ id: 'p-verify', name: 'verify', cwd: ROOT, port: 3080 }],
        activeProjectId: 'p-verify',
        openAtLogin: false,
        adoptExternal: true,
        openUiOnStart: false,
        autoStartOnLaunch: false,
        stopServerOnQuit: false,
        theme: 'ocean',
      },
      null,
      2,
    ),
    'utf8',
  )

  const child = spawn(ELECTRON, ['.', '--hidden', `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const cleanup = () => {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      /* 已退出 */
    }
  }
  process.on('exit', cleanup)

  let targets = null
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    targets = await cdpTargets()
    const hasDsh = targets && targets.some((t) => t.type === 'page' && /127\.0\.0\.1:3080/.test(t.url))
    if (targets && hasDsh && targets.some((t) => t.url.includes('control.html'))) break
    targets = null
  }
  if (!targets) {
    console.error('CDP 未就绪（客户端是否成功接管 3080？）')
    cleanup()
    process.exit(1)
  }

  try {
    console.log('\n— 客户端 → DSH 文件 —')
    note(fs.existsSync(THEME_FILE), '$DSH_HOME/.dsh-theme.json 存在', THEME_FILE)
    note(JSON.parse(fs.readFileSync(THEME_FILE, 'utf8')).theme === 'ocean', '客户端启动时把 ocean 同步给了 DSH 侧')

    const dshTarget = targets.find((t) => t.type === 'page' && /127\.0\.0\.1:3080/.test(t.url))
    const dsh = await connect(dshTarget)
    await sleep(4000) // 等 applier 轮询（3s 一次）

    console.log('\n— DSH 界面（首页里的注入与令牌）—')
    let state = await evaluate(dsh.send, DSH_PROBE)
    note(state.scriptTag, 'DSH 页面已注入 /dsh-theme/theme.js')
    note(state.applier, 'applier 脚本已执行（window.__dshThemePack）')
    note(state.appliedTheme === 'ocean', 'applier 已应用 ocean', String(state.appliedTheme))
    note(state.rootVar.toUpperCase() === '#0B2233', '--dsw-alias-bg-base 被改写为 ocean 底色', state.rootVar)
    note(state.bodyVar.toUpperCase() === '#0B2233', 'body 上同样生效', state.bodyVar)
    note(state.darkAttr === true, 'ocean 是暗色主题 → 已钉住 data-ds-dark-theme')
    note(
      state.rootBg === 'rgb(11, 34, 51)' || state.bodyBg === 'rgb(11, 34, 51)',
      'DSH 界面实际绘制底色 = ocean (#0B2233)',
      `html=${state.rootBg} body=${state.bodyBg}`,
    )

    console.log('\n— 客户端里切换主题 → DSH 界面跟着变 —')
    const overlay = targets.find((t) => t.url.includes('control.html'))
    const control = await connect(overlay)
    await sleep(2000)
    const switched = await evaluate(control.send, `(() => {
      const select = document.getElementById('optTheme')
      select.value = 'contrast'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return document.body.dataset.theme
    })()`)
    note(switched === 'contrast', '客户端切到 contrast', String(switched))
    note(JSON.parse(fs.readFileSync(THEME_FILE, 'utf8')).theme === 'contrast', '切换后立即同步到 DSH 侧文件')

    await sleep(5000) // 等 applier 下一轮轮询
    state = await evaluate(dsh.send, DSH_PROBE)
    note(state.appliedTheme === 'contrast', 'DSH 界面无需刷新即切到 contrast', String(state.appliedTheme))
    note(state.darkAttr === false, 'contrast 是浅色主题 → 基底模式已切回 light')
    note(state.rootVar.toUpperCase() === '#FFFFFF', '--dsw-alias-bg-base 变为 contrast 底色', state.rootVar)
    note(
      state.rootBg === 'rgb(255, 255, 255)' || state.bodyBg === 'rgb(255, 255, 255)',
      'DSH 界面实际绘制底色 = 白',
      `html=${state.rootBg} body=${state.bodyBg}`,
    )
    dsh.ws.close()
    control.ws.close()
  } finally {
    cleanup()
    await sleep(400)
  }

  const failed = report.filter((r) => !r.ok).length
  console.log(`\n${'─'.repeat(58)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('验证脚本异常：', error.message)
  process.exit(1)
})
