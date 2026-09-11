'use strict'

// 随包 DSH 以 Electron 内置 Node 运行，会把 ELECTRON_RUN_AS_NODE=1 传染给子进程。
// 不清掉的话，本脚本启动的 electron.exe 会以纯 Node 模式运行（app 为 undefined）并崩溃。
delete process.env.ELECTRON_RUN_AS_NODE

// 开发期自动验证：以 --hidden 启动客户端（不显示任何窗口、不建托盘），
// 通过 CDP 读取界面真实状态并尽力截图，最后自行退出。全程不打扰用户。
//   node tools/verify.js
//
// 分两阶段：
//   阶段 1（无服务）：服务未运行 → 必须是「全面控制台」形态，视图铺满窗口、五个面板全展开
//   阶段 2（接管真实服务）：运行中 → 悬浮条形态，结构与交互保持原样
// 另外包含不依赖 Electron 的纯 node 检查（形态映射、主题数据、令牌 CSS 是否过期）。

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

/**
 * 子进程环境：必须清掉 ELECTRON_RUN_AS_NODE。
 * 当宿主（例如客户端用「Electron 当 Node」拉起的 bundled dsh web）带着这个变量时，
 * electron.exe 会退化成纯 Node，require('electron').app 为 undefined，
 * 客户端一启动就崩在 main.js 的 app.commandLine 上。
 */
const childEnv = () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
const OUT_DIR = path.join(ROOT, '.verify')

const { surfaceForState } = require('../lib/surface')
const { THEMES, DEFAULT_THEME_ID, THEME_IDS } = require('../lib/themes')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const report = []
const note = (ok, label, value) => {
  report.push({ ok, label, value })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${value ? `  ${value}` : ''}`)
}

// ---------------------------------------------------------------- 纯 node 检查

function staticChecks() {
  console.log('— 静态检查（不需要 Electron）—')
  note(surfaceForState('stopped') === 'console', 'stopped → console（服务未运行不折叠）', surfaceForState('stopped'))
  note(surfaceForState('starting') === 'bar', 'starting → bar（只有启动中折叠）', surfaceForState('starting'))
  note(surfaceForState('stopping') === 'bar', 'stopping → bar', surfaceForState('stopping'))
  note(surfaceForState('running') === 'bar', 'running → bar', surfaceForState('running'))
  note(surfaceForState('external') === 'bar', 'external → bar', surfaceForState('external'))
  note(surfaceForState(undefined) === 'console', '未知状态 → console（宁可多给控制项）', surfaceForState(undefined))
  note(THEMES.length === 6 && THEME_IDS.length === 6, '主题数量 6', String(THEMES.length))
  note(DEFAULT_THEME_ID === 'dsh-white-blue', '默认主题是 DSH 原生白蓝', DEFAULT_THEME_ID)
  note(THEMES.every((t) => t.palette && Object.keys(t.palette).length === 22), '每套主题 22 个角色色值')
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'gen-theme-css.js'), '--check'], { stdio: 'pipe' })
    note(true, 'renderer/theme-tokens.css 与主题数据一致')
  } catch (error) {
    note(false, 'renderer/theme-tokens.css 需要重新生成', String(error.stdout || error.message).trim())
  }
  console.log('')
}

// ---------------------------------------------------------------- CDP

async function cdpTargets(port) {
  try {
    return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
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

async function evaluate(send, expression, attempts = 3) {
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

async function screenshot(send, file) {
  await send('Page.enable', {}, 8000)
  const shot = await send('Page.captureScreenshot', { format: 'png' }, 8000)
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
}

/** 写入一份隔离的客户端配置（user-data-dir 下的 config.json）。 */
function writeConfig(dir, config) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
}

/** 启动一个隐藏的客户端实例并等到 CDP 就绪。 */
async function launch(userDataDir, cdpPort) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const child = spawn(ELECTRON, ['.', '--hidden', `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${cdpPort}`], {
    cwd: ROOT,
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const output = []
  child.stdout.on('data', (d) => output.push(String(d)))
  child.stderr.on('data', (d) => output.push(String(d)))
  const cleanup = () => {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      /* 已退出 */
    }
  }
  let targets = null
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    targets = await cdpTargets(cdpPort)
    if (targets && targets.some((t) => t.url.includes('control.html'))) break
    targets = null
  }
  if (!targets) {
    cleanup()
    throw new Error(`CDP 未就绪（port ${cdpPort}），进程输出：\n${output.join('')}`)
  }
  return { child, targets, cleanup, output }
}

const tryShot = async (send, file, label) => {
  try {
    await screenshot(send, file)
    note(true, `${label}已截图`, path.basename(file))
  } catch {
    // 透明 WebContentsView 无法用 CDP 截图（已知限制）；外观改由 preview-overlay 覆盖
    console.log(`  ⚠️  ${label}：CDP 无法截取透明视图，跳过`)
  }
}

// ---------------------------------------------------------------- 阶段 1：服务未运行

async function phaseConsole() {
  const userData = path.join(OUT_DIR, 'userdata-console')
  fs.rmSync(userData, { recursive: true, force: true })
  writeConfig(userData, {
    version: 1,
    projects: [{ id: 'p-verify', name: 'verify', cwd: ROOT, port: 3099 }],
    activeProjectId: 'p-verify',
    openAtLogin: false,
    // 不接管、不自动启动：让服务停在 stopped，验证「未运行 → 全面控制台」
    adoptExternal: false,
    openUiOnStart: false,
    autoStartOnLaunch: false,
    stopServerOnQuit: false,
    dshBinPath: '',
    nodeBinPath: '',
    theme: 'dsh-white-blue',
  })

  console.log('— 阶段 1：服务未运行（全面控制台）—')
  const { targets, cleanup } = await launch(userData, 9231)
  try {
    note(targets.some((t) => t.url.includes('control.html')), '悬浮选项栏视图已创建')
    note(!targets.some((t) => t.url.includes('placeholder.html')), '已移除「服务未运行」占位页视图')

    const overlay = targets.find((t) => t.url.includes('control.html'))
    const { ws, send } = await connect(overlay)
    await sleep(2500)

    const surface = await evaluate(send, `document.body.dataset.surface`)
    note(surface === 'console', '未运行时进入全面控制台形态', String(surface))

    const serverState = await evaluate(send, `window.__dshControl ? 'ok' : 'missing'`)
    note(serverState === 'ok', '验证钩子已注入')

    const viewport = await evaluate(send, `({ w: window.innerWidth, h: window.innerHeight })`)
    note(viewport.w > 600 && viewport.h > 400, '控制台视图铺满窗口（不是 320×54 的悬浮条）', `${viewport.w}×${viewport.h}`)

    const layout = await evaluate(send, `(() => {
      const panel = document.getElementById('panel')
      const accs = [...document.querySelectorAll('.acc')]
      const toggle = document.getElementById('btnToggle')
      return {
        panelDisplay: getComputedStyle(panel).display,
        panelHidden: panel.classList.contains('hidden'),
        sections: accs.map((a) => a.dataset.key),
        allOpen: accs.every((a) => a.classList.contains('open') && getComputedStyle(a.querySelector('.acc-body')).display !== 'none'),
        toggleDisplay: getComputedStyle(toggle).display,
        titleDisplay: getComputedStyle(document.getElementById('consoleTitle')).display,
        bodyBg: getComputedStyle(document.body).backgroundColor,
      }
    })()`)
    note(layout.panelDisplay === 'grid', '五个面板改成网格铺开（不是 380px 弹层）', layout.panelDisplay)
    note(layout.panelHidden === false, '面板在控制台里不再折叠')
    note(JSON.stringify(layout.sections) === JSON.stringify(['service', 'projects', 'plugins', 'logs', 'settings']), '五个面板齐全', layout.sections.join(' / '))
    note(layout.allOpen === true, '五个面板全部展开')
    note(layout.toggleDisplay === 'none', '控制台里隐藏「展开/收起」按钮', layout.toggleDisplay)
    note(layout.titleDisplay !== 'none', '控制台标题可见')
    note(!/rgba\(0, 0, 0, 0\)|transparent/.test(layout.bodyBg), '控制台底色不透明（不会透出占位页）', layout.bodyBg)
    await tryShot(send, path.join(OUT_DIR, 'console.png'), '全面控制台')

    // ---- 主题
    const theme = await evaluate(send, `(() => ({
      attr: document.body.dataset.theme,
      options: [...document.querySelectorAll('#optTheme option')].map((o) => o.value),
      label: document.querySelector('#optTheme option:checked') ? document.querySelector('#optTheme option:checked').textContent : null,
      pageBg: getComputedStyle(document.body).getPropertyValue('--c-page').trim(),
    }))()`)
    note(theme.attr === 'dsh-white-blue', '默认客户端主题是 DSH 原生白蓝', String(theme.attr))
    note(JSON.stringify(theme.options) === JSON.stringify(THEME_IDS), '主题下拉列出全部 6 套主题', theme.options.join(' / '))
    note(theme.pageBg.toUpperCase() === '#FFFFFF', '默认主题页面底色为白', theme.pageBg)
    note(String(theme.label).includes('原生白蓝'), '默认主题显示名正确', String(theme.label))

    const switched = await evaluate(send, `(() => {
      const select = document.getElementById('optTheme')
      select.value = 'midnight'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return document.body.dataset.theme
    })()`)
    await sleep(900)
    const after = await evaluate(send, `(() => ({
      attr: document.body.dataset.theme,
      pageBg: getComputedStyle(document.body).getPropertyValue('--c-page').trim(),
    }))()`)
    note(switched === 'midnight' && after.attr === 'midnight', '切换主题立即生效（midnight）', `${switched} → ${after.attr}`)
    note(after.pageBg.toUpperCase() === '#070B16', 'midnight 令牌已应用', after.pageBg)
    const persisted = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')).theme
    note(persisted === 'midnight', '主题已持久化到客户端配置', String(persisted))
    const dshThemeFile = path.join(process.env.DSH_HOME || path.join(require('node:os').homedir(), '.dsh'), '.dsh-theme.json')
    let dshTheme = null
    try { dshTheme = JSON.parse(fs.readFileSync(dshThemeFile, 'utf8')).theme } catch { /* 读不到就算了 */ }
    note(dshTheme === 'midnight', '主题已同步给 DSH 侧（$DSH_HOME/.dsh-theme.json）', String(dshTheme))
    await evaluate(send, `window.__dshControl.setTheme('dsh-white-blue')`)

    // ---- 回到悬浮条形态，验证原结构没被破坏
    await evaluate(send, `window.__dshControl.setSurface('bar')`)
    await sleep(500)
    const bar = await evaluate(send, `(() => {
      const panel = document.getElementById('panel')
      const r = document.body.getBoundingClientRect()
      return {
        surface: document.body.dataset.surface,
        panelHidden: panel.classList.contains('hidden'),
        w: Math.ceil(r.width),
        h: Math.ceil(r.height),
        sections: [...document.querySelectorAll('.acc')].map((a) => a.dataset.key),
      }
    })()`)
    note(bar.surface === 'bar', '可切回悬浮条形态', bar.surface)
    note(bar.panelHidden === true, '悬浮条默认收起', `${bar.w}×${bar.h}`)
    note(JSON.stringify(bar.sections) === JSON.stringify(['service', 'projects', 'plugins', 'logs', 'settings']), '悬浮条结构完整', bar.sections.join(' / '))

    await evaluate(send, `document.getElementById('btnToggle').click()`)
    await sleep(600)
    const expanded = await evaluate(send, `(() => {
      const r = document.body.getBoundingClientRect()
      return { w: Math.ceil(r.width), h: Math.ceil(r.height) }
    })()`)
    note(expanded.h > bar.h, '展开后视图随之变大', `${bar.w}×${bar.h} → ${expanded.w}×${expanded.h}`)
    note(expanded.w <= 420, '悬浮条面板宽度仍受 380px 设计值约束', `w=${expanded.w}`)
    note((await evaluate(send, `document.querySelectorAll('.acc[data-key="plugins"] .plugin').length`)) > 0, '插件栏已列出插件')
    note((await evaluate(send, `document.querySelectorAll('#projects .project').length`)) >= 1, '项目列表已渲染')
    note((await evaluate(send, `document.getElementById('logs').textContent.split('\\n').filter(Boolean).length`)) > 0, '日志已加载')
    ws.close()
  } finally {
    cleanup()
    await sleep(400)
  }
  console.log('')
}

// ---------------------------------------------------------------- 阶段 2：接管运行中的服务

async function phaseRunning() {
  const userData = path.join(OUT_DIR, 'userdata-running')
  fs.rmSync(userData, { recursive: true, force: true })
  writeConfig(userData, {
    version: 1,
    projects: [{ id: 'p-verify', name: 'verify', cwd: ROOT, port: 3080 }],
    activeProjectId: 'p-verify',
    openAtLogin: false,
    adoptExternal: true,
    openUiOnStart: false,
    autoStartOnLaunch: false,
    stopServerOnQuit: false,
    dshBinPath: '',
    nodeBinPath: '',
    theme: 'dsh-white-blue',
  })

  console.log('— 阶段 2：运行中（悬浮条 + DSH 界面）—')
  const { targets, cleanup } = await launch(userData, 9232)
  try {
    const dshTarget = targets.find((t) => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url))
    note(Boolean(dshTarget), 'DSH 界面视图已创建', dshTarget ? dshTarget.url : '未找到（3080 上没有服务？）')

    const overlay = targets.find((t) => t.url.includes('control.html'))
    const { ws, send } = await connect(overlay)
    await sleep(3000)

    const state = await evaluate(send, `(() => ({
      surface: document.body.dataset.surface,
      serverState: document.querySelector('#barState') ? document.querySelector('#barState').textContent : null,
    }))()`)
    const expected = surfaceForState(/接管/.test(String(state.serverState)) ? 'external' : 'running')
    note(state.surface === expected, '运行中的形态与状态映射一致', `${state.serverState} → ${state.surface}`)
    note(state.surface === 'bar', '运行中保持悬浮条形态（不铺满窗口）', String(state.surface))
    note((await evaluate(send, `document.body.getBoundingClientRect().width`)) <= 420, '运行中视图仍是小尺寸悬浮条')
    ws.close()

    if (dshTarget) {
      const dsh = await connect(dshTarget)
      await sleep(2500)
      note(Boolean(await evaluate(dsh.send, 'document.title')), 'DSH 页面标题', await evaluate(dsh.send, 'document.title'))
      const length = await evaluate(dsh.send, 'document.body ? document.body.innerText.length : 0')
      note(length > 50, 'DSH 页面已渲染内容', `${length} 字符`)
      // 主题包要等 dsh web 重启后才会加载；没加载时只提示，不算失败
      let pluginLive = false
      try {
        pluginLive = (await fetch('http://127.0.0.1:3080/dsh-theme/theme.json')).ok
      } catch {
        pluginLive = false
      }
      if (pluginLive) {
        const injected = await evaluate(dsh.send, `document.querySelector('script[src="/dsh-theme/theme.js"]') ? 'yes' : 'no'`)
        note(injected === 'yes', 'DSH 页面已注入主题应用脚本（dsh-theme-pack）', injected)
        const applier = await evaluate(dsh.send, `typeof window.__dshThemePack === 'object' && window.__dshThemePack !== null`)
        note(applier === true, '主题应用脚本已执行')
      } else {
        console.log('  ⚠️  dsh-theme-pack 尚未被 dsh web 加载（需重启服务），跳过注入检查')
      }
      dsh.ws.close()
    }
  } finally {
    cleanup()
    await sleep(400)
  }
  console.log('')
}

// ---------------------------------------------------------------- 主流程

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  staticChecks()
  await phaseConsole()
  await phaseRunning()

  const failed = report.filter((r) => !r.ok).length
  console.log(`${'─'.repeat(58)}\n截图输出：${OUT_DIR}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('验证脚本异常：', error.message)
  process.exit(1)
})
