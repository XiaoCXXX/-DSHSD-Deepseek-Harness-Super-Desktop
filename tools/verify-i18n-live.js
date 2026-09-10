'use strict'

// 语言切换 + 动画的真实客户端验证。
// 用隔离的 userData 与 DSH_HOME，不触碰你正在运行的客户端与真实 DSH 设置。
//   node tools/verify-i18n-live.js

delete process.env.ELECTRON_RUN_AS_NODE

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const yaml = require('js-yaml')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SANDBOX = path.join(ROOT, '.verify', 'i18n-run')
const HOME = path.join(SANDBOX, 'dshhome')
const USER_DATA = path.join(SANDBOX, 'userdata')
const PORT = 9251

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

/** 抓取界面上代表性的文案 + 动画相关的计算样式 */
const SNAPSHOT = `(() => {
  const text = (sel) => document.querySelector(sel)?.textContent.trim() ?? null
  const rowButtons = [...document.querySelectorAll('#projects .project .row-actions button')].map((b) => b.textContent.trim())
  const btn = document.querySelector('.btn')
  const accBody = document.querySelector('.acc-body')
  const csBtn = btn ? getComputedStyle(btn) : null
  const csAcc = accBody ? getComputedStyle(accBody) : null
  let keyframes = []
  for (const sheet of document.styleSheets) {
    try { for (const rule of sheet.cssRules) if (rule.type === CSSRule.KEYFRAMES_RULE) keyframes.push(rule.name) } catch {}
  }
  return {
    htmlLang: document.documentElement.lang,
    language: window.__dshControl.language,
    theme: window.__dshControl.theme,
    sectionService: text('.acc[data-key="service"] .acc-head span'),
    sectionSettings: text('.acc[data-key="settings"] .acc-head span'),
    startButton: text('#btnStart'),
    addProject: text('#btnAddProject'),
    logOpenFile: text('#btnLogFile'),
    logAllChip: text('#logFilters .chip[data-source="all"]'),
    openAtLogin: text('label.toggle span'),
    themeLabel: text('label.field span'),
    rowButtons,
    rowButtonTitles: [...document.querySelectorAll('#projects .project .row-actions button')].map((b) => b.title),
    stateText: text('#barState'),
    btnTransition: csBtn ? csBtn.transitionProperty + ' / ' + csBtn.transitionDuration : null,
    accTransition: csAcc ? csAcc.transitionProperty + ' / ' + csAcc.transitionDuration : null,
    keyframes,
  }
})()`

async function main() {
  const report = []
  const note = (ok, label, value = '') => {
    report.push(ok)
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value ? `  ${value}` : ''}`)
  }

  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.mkdirSync(HOME, { recursive: true })
  // 预置一个已有其它命名空间的 settings.yaml，验证写入时不会冲掉它
  fs.writeFileSync(path.join(HOME, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n', 'utf8')
  // 让测试客户端去接管 3080（不新起服务），并关掉自动启动避免副作用
  fs.writeFileSync(path.join(USER_DATA, 'config.json'), JSON.stringify({
    version: 1,
    projects: [{ id: 'p-i18n', name: 'i18n 测试', cwd: SANDBOX, port: 3080 }],
    activeProjectId: 'p-i18n',
    openAtLogin: false,
    adoptExternal: true,
    openUiOnStart: false,
    autoStartOnLaunch: false,
    stopServerOnQuit: false,
    language: 'zh',
  }, null, 2))

  const env = { ...process.env, DSH_HOME: HOME }
  delete env.ELECTRON_RUN_AS_NODE

  console.log('\n语言切换与动效验证（隔离 DSH_HOME）\n' + '─'.repeat(62))
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
    if (list && list.some((t) => t.url.includes('control.html'))) break
    list = null
  }
  if (!list) { console.error('未就绪'); cleanup(); process.exit(1) }

  const overlay = await connect(list.find((t) => t.url.includes('control.html')))
  const send = overlay.send
  await sleep(2500)

  // ---------- 中文
  const zh = await evaluate(send, SNAPSHOT)
  note(zh.language === 'zh', '初始语言为中文', zh.language)
  note(zh.htmlLang === 'zh-CN', '<html lang> 为 zh-CN', zh.htmlLang)
  note(zh.rowButtons[0] === '编辑' && zh.rowButtons[1] === '删除',
    '项目按钮已改为「编辑 / 删除」', zh.rowButtons.join(' / '))
  note(zh.logOpenFile === '打开日志文件', '日志按钮不再是「文件」', zh.logOpenFile)
  note(zh.sectionService === '服务' && zh.sectionSettings === '设置', '分区标题为中文')

  // ---------- 动效
  note(/transform/.test(zh.btnTransition || ''), '按钮有 transition（含 transform）', zh.btnTransition)
  note(/max-height/.test(zh.accTransition || ''), '折叠栏用 max-height 过渡', zh.accTransition)
  note(zh.keyframes.includes('surface-in'), '形态切换关键帧已定义', zh.keyframes.join(', '))

  // ---------- 切到英文
  await evaluate(send, `window.__dshControl.setLanguage('en')`)
  await sleep(1800)
  const en = await evaluate(send, SNAPSHOT)
  note(en.language === 'en', '语言已切到英文', en.language)
  note(en.htmlLang === 'en', '<html lang> 为 en', en.htmlLang)
  note(en.sectionService === 'Service' && en.sectionSettings === 'Settings', '分区标题已变英文',
    `${en.sectionService} / ${en.sectionSettings}`)
  note(en.rowButtons[0] === 'Edit' && en.rowButtons[1] === 'Delete', '项目按钮为 Edit / Delete', en.rowButtons.join(' / '))
  note(en.logOpenFile === 'Open log file', '日志按钮为 Open log file', en.logOpenFile)
  note(en.logAllChip === 'All', '日志筛选项为 All', en.logAllChip)
  note(en.openAtLogin === 'Launch at login', '开关文案已英文化', en.openAtLogin)
  note(!/[\u4e00-\u9fa5]/.test([en.sectionService, en.sectionSettings, en.startButton, en.addProject, en.logOpenFile, en.openAtLogin, en.themeLabel, ...en.rowButtons].join(' ')),
    '取样的英文界面无残留中文')

  // ---------- 日志跟随界面语言
  // 触发一次会产生客户端日志的动作（主进程会写 log.themeSynced）
  await evaluate(send, `(async () => { await window.dshClient.patchConfig({ theme: 'midnight' }) })()`)
  await sleep(1600)
  const logText = await evaluate(send, `document.getElementById('logs').textContent`)
  const themeLines = String(logText).split('\n').filter((line) => /synced to DSH|主题已同步/.test(line))
  const latestThemeLine = themeLines.slice(-1)[0]?.trim() || ''
  note(/Theme synced to DSH/.test(latestThemeLine),
    '英文界面下新产生的客户端日志为英文', latestThemeLine || '(未捕获)')
  // 只检查最新那条：更早的行是中文界面时期产生的，日志是历史记录，保留原语言是对的
  note(latestThemeLine.length > 0 && !/[\u4e00-\u9fa5]/.test(latestThemeLine),
    '最新日志行内无残留中文', latestThemeLine)

  // ---------- 界面形态手动切换
  const readSurface = () => evaluate(send, `(async () => {
    const s = await window.dshClient.getState()
    return { surface: s.surface, auto: s.config.autoSurface, manual: s.config.surface }
  })()`)

  const before = await readSurface()
  note(before.auto === false, '「服务启停时自动切换界面」默认关闭', `auto=${before.auto}`)
  note(before.surface === 'bar', '接管状态下默认形态为悬浮条', before.surface)

  await evaluate(send, `(async () => { await window.dshClient.setSurface('toggle') })()`)
  await sleep(900)
  const toConsole = await readSurface()
  note(toConsole.surface === 'console', '切换按钮把形态切到客户端界面', toConsole.surface)
  note(toConsole.manual === 'console', '手动选择已写入配置', `surface=${toConsole.manual}`)
  note((await evaluate(send, `getComputedStyle(document.getElementById('btnSurfaceConsole')).display`)) !== 'none',
    '控制台形态下显示「返回 DSH 界面」按钮')
  // 关键：形态换了以后叠加视图的 bounds 必须跟着换，否则界面会被挤在右上角一小块
  const consoleView = await evaluate(send, `({ w: window.innerWidth, h: window.innerHeight })`)
  note(consoleView.w > 1000 && consoleView.h > 600,
    '控制台形态下叠加视图铺满窗口', `${consoleView.w}×${consoleView.h}`)
  // 留一张控制台截图便于人眼确认；透明视图常常截不出来，因此失败只告警不算失败
  try {
    await send('Page.enable', {}, 8000)
    const shot = await send('Page.captureScreenshot', { format: 'png' }, 8000)
    fs.writeFileSync(path.join(ROOT, '.verify', 'surface-console.png'), Buffer.from(shot.data, 'base64'))
    console.log('  📷 已保存控制台截图 .verify/surface-console.png')
  } catch {
    console.log('  ⚠️  透明视图无法 CDP 截图，跳过（尺寸断言已覆盖此问题）')
  }

  await evaluate(send, `(async () => { await window.dshClient.setSurface('toggle') })()`)
  await sleep(900)
  const toBar = await readSurface()
  note(toBar.surface === 'bar', '再切一次回到 DSH 界面', toBar.surface)
  note((await evaluate(send, `getComputedStyle(document.getElementById('btnSurfaceBar')).display`)) !== 'none',
    '悬浮条形态下显示切换图标按钮')
  const barView = await evaluate(send, `({ w: window.innerWidth, h: window.innerHeight })`)
  note(barView.w < 600, '回到悬浮条后视图缩回小尺寸', `${barView.w}×${barView.h}`)

  // 打开自动模式后，形态应回到由服务状态推导的结果
  await evaluate(send, `(async () => { await window.dshClient.patchConfig({ autoSurface: true }) })()`)
  await sleep(900)
  const autoOn = await readSurface()
  note(autoOn.auto === true && autoOn.surface === 'bar', '打开自动模式后形态跟随服务状态', `${autoOn.surface}/auto=${autoOn.auto}`)
  await evaluate(send, `(async () => { await window.dshClient.patchConfig({ autoSurface: false }) })()`)
  await sleep(600)

  // ---------- DSH 侧语言
  const settingsPath = path.join(HOME, 'settings.yaml')
  const doc = yaml.load(fs.readFileSync(settingsPath, 'utf8'))
  note(doc?.locale?.preference === 'en', 'DSH 语言已写入 settings.yaml', JSON.stringify(doc?.locale))
  note(doc?.['ui-onboarding']?.welcomeNoticeVersion === '2026-08-13.1', '原有命名空间未被冲掉')

  // ---------- 切回中文
  await evaluate(send, `window.__dshControl.setLanguage('zh')`)
  await sleep(1800)
  const back = await evaluate(send, SNAPSHOT)
  note(back.language === 'zh' && back.sectionService === '服务', '可切回中文', back.sectionService)
  const doc2 = yaml.load(fs.readFileSync(settingsPath, 'utf8'))
  note(doc2?.locale?.preference === 'zh', 'DSH 语言同步切回', JSON.stringify(doc2?.locale))

  overlay.ws.close()
  cleanup()
  await sleep(500)

  const failed = report.filter((ok) => !ok).length
  console.log('─'.repeat(62) + `\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('验证异常：', error.message)
  process.exit(1)
})
