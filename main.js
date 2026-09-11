'use strict'

// DSH 桌面客户端 —— Electron 主进程。
//
// 单窗口分层架构（不再有独立的控制台窗口，也没有「服务未运行」占位页）：
//   dshView          DSH 本体界面（运行/加载时显示，铺满窗口）
//   overlayView      悬浮选项栏（透明、最上层，只占自身所需区域，
//                    因此面板以外的鼠标事件照常落到下面的 DSH 界面上）
// 服务停止时直接收起 dshView，露出窗口底色，由悬浮栏显示状态。
//
// 托盘常驻，悬停显示服务状态与 DeepSeek 余额。

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')
const {
  app,
  BrowserWindow,
  WebContentsView,
  Tray,
  Menu,
  ipcMain,
  shell,
  dialog,
  nativeImage,
  session,
} = require('electron')

const { Config } = require('./lib/config')
const { Logger } = require('./lib/logger')
const { ServerManager, probePort } = require('./lib/server-manager')
const { mintSessionCookie, dshHome } = require('./lib/auth-cookie')
const { findNodeBin, findDshBin, findWhaleAssets } = require('./lib/dsh-locator')
const { resolveRuntime, resolvePackageDir, bundledPluginDir, profileDir } = require('./lib/runtime')
const { ensureProfile } = require('./lib/provision')
const { surfaceForState } = require('./lib/surface')
const { normalizeThemeId, themeList } = require('./lib/themes')
const { t, messagesFor, normalizeLanguage, languageEntry, LANGUAGES } = require('./lib/i18n')
const { writeDshLanguage } = require('./lib/dsh-settings')

const PARTITION = 'persist:dsh'
const WHALE_SPEC = 'github:MeteorNOX/DeepSeek-Balance-Whale-Widget'
const WHALE_NAME = 'dsh-whale-widget'
/** 快速提问后端，便携悬浮窗靠它拿回答。源码在仓库的 plugins/ 下。 */
const QUICK_NAME = 'dsh-quick-ask'
/** 随包分发、每次启动都要确保已启用的插件。 */
const BUNDLED_PLUGINS = [WHALE_NAME, QUICK_NAME]
const OVERLAY_MARGIN = 14
const DEFAULT_OVERLAY_SIZE = { width: 268, height: 46 }

let config
let logger
let server
let tray = null
let mainWindow = null
let dshView = null
let overlayView = null
let balance = null
let balanceTimer = null
let quitting = false
let quitAfterStop = false
let overlaySize = { ...DEFAULT_OVERLAY_SIZE }
let surface = 'console'

/** --hidden：窗口与托盘一律不显示，仅供开发期自动化验证使用。 */
const HIDDEN = process.argv.includes('--hidden')

// 隐藏的窗口会被 Chromium 节流，导致 CDP 截图取不到帧；验证模式下关掉节流。
if (HIDDEN) {
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()

// ---------------------------------------------------------------- 工具

function fetchJson(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const request = http.request(url, { method: 'GET', timeout: timeoutMs }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        return resolve(undefined)
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(body)) } catch { resolve(undefined) }
      })
    })
    request.on('timeout', () => { request.destroy(); resolve(undefined) })
    request.on('error', () => resolve(undefined))
    request.end()
  })
}

/** 金额格式化：避免出现 0.27000000000000013 这类浮点噪声。 */
function fmtMoney(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '--'
  if (number === 0) return '0.00'
  return Math.abs(number) >= 1 ? number.toFixed(2) : number.toFixed(4)
}

function uiUrl(port, token) {
  return token
    ? `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`
    : `http://127.0.0.1:${port}/`
}

function whaleIcon() {
  const assets = findWhaleAssets()
  if (assets) {
    const image = nativeImage.createFromPath(path.join(assets, 'DSniang1.png'))
    if (!image.isEmpty()) return image
  }
  return nativeImage.createEmpty()
}

function trayImage() {
  const image = whaleIcon()
  return image.isEmpty() ? image : image.resize({ width: 18, height: 18, quality: 'best' })
}

// ---------------------------------------------------------------- 插件清单

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** 随 DSH 内置、不作为用户插件展示的 bundle。 */
const BUILTIN_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

/**
 * 列出已启用的插件：以 profile 清单的 dsh.profile.bundles 为准
 * （这才是真正生效的层），并附带 dependencies 里记录到的来源。
 */
function listPlugins() {
  const dir = profileDir(dshHome())
  const manifest = readJson(path.join(dir, 'package.json'))
  if (!manifest) return []

  const runtime = resolveRuntime()
  const names = new Set()
  for (const name of manifest.dsh?.profile?.bundles || []) names.add(name)
  for (const name of Object.keys(manifest.dependencies || {})) names.add(name)
  for (const name of BUILTIN_BUNDLES) names.delete(name)

  return [...names].map((name) => {
    const packageDir = resolvePackageDir(name, { dshRoot: runtime.dshRoot, profile: dir })
    const pkg = packageDir ? readJson(path.join(packageDir, 'package.json')) : undefined
    return {
      name,
      spec: manifest.dependencies?.[name] || '随包分发',
      version: pkg?.version || null,
      bundle: Boolean(pkg?.dsh?.bundle?.patch),
      whale: name === WHALE_NAME,
      present: Boolean(packageDir),
    }
  })
}

/** 启动服务前准备运行环境：确保 profile 存在且已启用随包插件。 */
function prepareEnvironment() {
  const dir = profileDir(dshHome())
  const runtime = resolveRuntime()
  const plugins = BUNDLED_PLUGINS.map((name) => ({ name, sourceDir: bundledPluginDir(name) }))
  const result = ensureProfile({
    dir,
    plugins,
    log: (key, params) => logger.info(tr(key, params)),
  })
  for (const { name, sourceDir } of plugins) {
    if (!sourceDir) {
      logger.error(tr('log.whaleMissing', { name }))
    } else if (!resolvePackageDir(name, { dshRoot: runtime.dshRoot, profile: dir })) {
      logger.error(tr('log.pluginNotInstalled', { name }))
    }
  }
  return { ...result, runtime: runtime.mode }
}

// ---------------------------------------------------------------- 状态

/** 生效的界面语言：显式配置优先，否则跟随系统语言。 */
function effectiveLanguage() {
  const configured = config.all().language
  if (configured) return normalizeLanguage(configured)
  return String(app.getLocale() || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** 当前语言的取词。 */
function tr(key, params) {
  return t(effectiveLanguage(), key, params)
}

/**
 * 当前应显示的界面形态。
 * 自动模式跟随服务状态；手动模式用用户选定的形态（未选过则按状态推导一次）。
 * 'bubble'（便携悬浮窗）只能手动选——它跟服务状态无关，自动推导不出来。
 * @param {string} state - 服务状态
 * @returns {'bar'|'console'|'bubble'}
 */
function currentSurface(state) {
  const derived = surfaceForState(state)
  if (config.all().autoSurface) return derived
  const manual = config.all().surface
  if (manual === 'bar' || manual === 'console' || manual === 'bubble') return manual
  return derived
}

/** 把当前语言同步给 DSH 自身（写 $DSH_HOME/settings.yaml 的 locale.preference）。 */
function syncLanguageToDsh() {
  try {
    const entry = languageEntry(effectiveLanguage())
    const result = writeDshLanguage(dshHome(), entry.dsh)
    if (result.changed) logger.info(tr('log.languageSynced', { language: entry.dsh, file: result.file }))
  } catch (error) {
    logger.error(tr('log.languageSyncFailed', { message: error?.message || error }))
  }
}

function fullState() {
  const project = config.activeProject()
  const serverSnapshot = server ? server.snapshot() : { state: 'stopped' }
  return {
    server: serverSnapshot,
    // 界面形态：自动模式下未运行 → 全面控制台、运行中 → 悬浮条；手动模式下取用户选定值
    surface: currentSurface(serverSnapshot.state),
    themes: themeList(),
    language: effectiveLanguage(),
    languages: LANGUAGES.map((language) => ({ id: language.id, label: language.label })),
    config: config.all(),
    project,
    balance,
    plugins: listPlugins(),
    resolved: (() => {
      const runtime = resolveRuntime()
      return {
        runtime: runtime.mode,
        node: runtime.nodeBin || findNodeBin(),
        dsh: runtime.dshBin || findDshBin(),
        whaleAssets: findWhaleAssets() || null,
        dshHome: dshHome(),
        uiUrl: project ? `http://127.0.0.1:${project.port}/` : null,
      }
    })(),
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    versions: { electron: process.versions.electron, node: process.versions.node },
  }
}

/**
 * 主进程侧的当前形态。
 * 必须与 fullState() 用同一个来源——曾经这里直接用 surfaceForState()，
 * 忽略了手动选择，导致「渲染层按控制台铺满、视图 bounds 却还是悬浮条大小」，
 * 界面被挤在右上角一小块且无法操作。
 * @returns {'bar'|'console'}
 */
function activeSurface() {
  return currentSurface(server ? server.snapshot().state : 'stopped')
}

function pushState() {
  const nextSurface = activeSurface()
  if (nextSurface !== surface) {
    const previous = surface
    surface = nextSurface
    // 形态切换立刻重排：控制台铺满窗口，悬浮条锚定右上角
    if (mainWindow && !mainWindow.isDestroyed()) layoutViews()
    // 悬浮窗形态要换成另一个窗口来承载
    applySurfaceWindows(previous, nextSurface)
  }
  if (overlayView && !overlayView.webContents.isDestroyed()) {
    overlayView.webContents.send('state', fullState())
  }
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('state', fullState())
  }
  updateTray()
}

function sendOverlay(command) {
  if (overlayView && !overlayView.webContents.isDestroyed()) {
    overlayView.webContents.send('overlay:command', command)
  }
}

/** 把客户端主题同步给 DSH 侧：主题包读 $DSH_HOME/.dsh-theme.json，注入的页面脚本轮询后应用。 */
function syncThemeToDsh(themeId) {
  const id = normalizeThemeId(themeId)
  try {
    const file = path.join(dshHome(), '.dsh-theme.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ theme: id, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
    logger.info(tr('log.themeSynced', { theme: id }))
  } catch (error) {
    logger.error(tr('log.themeSyncFailed', { message: error?.message || error }))
  }
}

// ---------------------------------------------------------------- 视图布局

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [width, height] = mainWindow.getContentSize()
  if (dshView) dshView.setBounds({ x: 0, y: 0, width, height })
  positionOverlay(width, height)
}

function positionOverlay(windowWidth, windowHeight) {
  if (!overlayView) return
  // 控制台形态：叠加视图铺满窗口（内容本来就要占满，也不需要点击穿透）
  if (activeSurface() === 'console') {
    overlayView.setBounds({ x: 0, y: 0, width: windowWidth, height: windowHeight })
    return
  }
  const width = Math.max(120, Math.min(overlaySize.width, windowWidth - OVERLAY_MARGIN * 2))
  const height = Math.max(40, Math.min(overlaySize.height, windowHeight - OVERLAY_MARGIN * 2))
  // 悬浮栏锚定右上角：DSH 的小鲸鱼挂件在右下角，避开它
  overlayView.setBounds({
    x: windowWidth - width - OVERLAY_MARGIN,
    y: OVERLAY_MARGIN,
    width,
    height,
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'DSH',
    icon: whaleIcon(),
    backgroundColor: '#12131a',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.on('resize', layoutViews)
  mainWindow.on('maximize', layoutViews)
  mainWindow.on('unmaximize', layoutViews)
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    dshView = null
    overlayView = null
  })

  // 1) DSH 本体界面（远程内容，不挂 preload）
  dshView = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  dshView.setBackgroundColor('#12131a')
  mainWindow.contentView.addChildView(dshView)
  dshView.setVisible(false)

  // 2) 悬浮选项栏（透明、最上层）
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true,
    },
  })
  overlayView.setBackgroundColor('#00000000')
  overlayView.webContents.loadFile(path.join(__dirname, 'renderer', 'control.html'))
  mainWindow.contentView.addChildView(overlayView)

  for (const view of [dshView, overlayView]) {
    view.webContents.setBackgroundThrottling(false)
  }

  layoutViews()
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (!HIDDEN) {
    mainWindow.show()
    mainWindow.focus()
  }
}

// ---------------------------------------------------------------- 便携悬浮窗

// 「便携悬浮窗」模式下整个客户端只剩两件东西：悬浮控制台 + 可以打字的气泡。
// 它用一个独立的无边框置顶小窗承载——主窗口不能改 frame，形态之间来回切会很难看。
// 提问走随包插件 dsh-quick-ask 暴露的 SSE 路由：插件在 DSH 进程内用
// sessionController 发问、用 session/event 收答案，客户端不需要碰 DSH 的内部协议。

/** 够放下控制条和几轮问答，又不至于挡住视线。 */
const BUBBLE_WIDTH = 380
const BUBBLE_HEIGHT = 540
/** 随包插件 dsh-quick-ask 的路由（GET + text/event-stream）。 */
const QUICK_PATH = '/dsh-quick/ask'
/** 气泡里最多保留多少轮，避免长期开着无限增长。 */
const QUICK_MAX_TURNS = 40

let bubbleWindow = null
/** 正在进行的提问：{ id, req }；同一时刻只允许一个。 */
let quickActive = null
/** 快速提问历史（仅内存）：气泡窗口重开时据此恢复。 */
const quickTurns = []

function createBubbleWindow() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) return bubbleWindow
  bubbleWindow = new BrowserWindow({
    width: BUBBLE_WIDTH,
    height: BUBBLE_HEIGHT,
    minWidth: 300,
    minHeight: 280,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'DSH',
    icon: whaleIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true,
    },
  })
  bubbleWindow.setMenuBarVisibility(false)
  // floating 层：普通窗口之上，但不至于盖住系统对话框
  bubbleWindow.setAlwaysOnTop(true, 'floating')
  bubbleWindow.loadFile(path.join(__dirname, 'renderer', 'bubble.html'))
  bubbleWindow.webContents.setBackgroundThrottling(false)
  bubbleWindow.on('close', (event) => {
    if (quitting) return
    // 关掉悬浮窗 = 收起，不是退出客户端
    event.preventDefault()
    bubbleWindow.hide()
  })
  bubbleWindow.on('closed', () => { bubbleWindow = null })
  return bubbleWindow
}

/**
 * 关掉便携悬浮窗：收起它，并回到「能看到 DSH 界面」的形态。
 *
 * 主窗口在悬浮窗形态下是**一直可见**的（用户要求），所以这里只收悬浮窗，
 * 并把形态从 bubble 切回 bar。之前悬浮窗的 ✕ 复用了主窗口的 app:hideWindow，
 * 结果「关悬浮窗」把主界面藏了、悬浮窗自己还在——反了。
 */
function closeBubbleWindow() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide()
  if (activeSurface() === 'bubble') {
    config.patch({ surface: 'bar' })
    pushState()          // 形态变化由 pushState 负责收悬浮窗、把主窗口叫到前面
  } else {
    showWindow()
  }
  return { ok: true }
}

/** 形态发生切换时，决定该露哪个窗口。只在真正变化时动作，避免反复抢焦点。 */
function applySurfaceWindows(previous, next) {
  if (previous === next) return
  if (next === 'bubble') {
    const win = createBubbleWindow()
    // 便携悬浮窗与主窗口并存：这里刻意不隐藏主窗口，主要界面必须一直在（用户要求）
    if (!HIDDEN && !win.isVisible()) win.showInactive()
    return
  }
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide()
  // 从悬浮窗切回来看 DSH 界面：把主窗口叫回来
  if (previous === 'bubble') showWindow()
}

function pushQuickEvent(event) {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('quick:event', event)
  }
}

function trimQuickTurns() {
  while (quickTurns.length > QUICK_MAX_TURNS) quickTurns.shift()
}

/**
 * 向随包插件发起一次快速提问，并把 SSE 事件转发给气泡窗口。
 * @param {string} question
 * @returns {{ok:boolean, id?:string, error?:string}}
 */
function startQuickAsk(question) {
  const project = config.activeProject()
  if (!project) return { ok: false, error: tr('quick.noProject') }
  if (quickActive) return { ok: false, error: tr('quick.busy') }
  if (server.snapshot().state !== 'running' && server.snapshot().state !== 'external') {
    return { ok: false, error: tr('quick.notRunning') }
  }

  const minted = mintSessionCookie('127.0.0.1', project.port)
  if (!minted) return { ok: false, error: tr('quick.noCookie') }

  const id = `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const turn = { id, question, answer: '', summary: '', status: 'running', error: '' }
  quickTurns.push(turn)
  trimQuickTurns()

  // 缺省即专用会话；只有显式 active 才复用当前活跃会话。
  // 这条要和插件侧 targetSession 的判定保持一致，否则配置写歪了就会静默混进活跃对话。
  const targetMode = config.all().quickAsk.session === 'active' ? 'active' : 'dedicated'
  const query = new URLSearchParams({
    id,
    q: question,
    session: targetMode,
    summary: config.all().quickAsk.summary,
  })
  logger.info(tr('log.quickDispatch', { session: targetMode, summary: query.get('summary') }))
  const req = http.request({
    host: '127.0.0.1',
    port: project.port,
    path: `${QUICK_PATH}?${query.toString()}`,
    method: 'GET',
    headers: { accept: 'text/event-stream', cookie: `${minted.name}=${minted.value}` },
  }, (res) => {
    if (res.statusCode !== 200) {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => finishQuick(turn, {
        type: 'error',
        message: tr('quick.httpError', { status: res.statusCode, body: body.slice(0, 160) }),
      }))
      return
    }
    res.setEncoding('utf8')
    let buffer = ''
    res.on('data', (chunk) => {
      buffer += chunk
      // SSE：事件之间用空行分隔
      let at
      while ((at = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        const event = parseSse(raw)
        if (event) consumeQuickEvent(turn, event)
      }
    })
    res.on('end', () => {
      if (turn.status === 'running') finishQuick(turn, { type: 'error', message: tr('quick.closed') })
    })
  })

  req.on('error', (error) => {
    finishQuick(turn, { type: 'error', message: tr('quick.netError', { message: error.message }) })
  })
  req.end()
  quickActive = { id, req }
  pushQuickEvent({ type: 'start', id, question })
  return { ok: true, id }
}

function parseSse(raw) {
  let name = 'message'
  const dataLines = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { type: name, ...JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

function consumeQuickEvent(turn, event) {
  if (event.type === 'answer') {
    turn.answer = String(event.text || '')
    pushQuickEvent({ type: 'answer', id: turn.id, text: turn.answer })
    return
  }
  if (event.type === 'summary') {
    turn.summary = String(event.text || '')
    pushQuickEvent({ type: 'summary', id: turn.id, text: turn.summary })
    return
  }
  if (event.type === 'done') {
    finishQuick(turn, { type: 'done', answer: turn.answer, sessionId: event.sessionId })
    return
  }
  if (event.type === 'error') {
    finishQuick(turn, { type: 'error', message: String(event.message || tr('quick.failed')) })
  }
}

function finishQuick(turn, event) {
  if (turn.status !== 'running') return
  if (event.type === 'done') {
    turn.status = 'done'
    if (typeof event.answer === 'string' && event.answer) turn.answer = event.answer
    if (!turn.summary) turn.summary = turn.answer
    turn.sessionId = event.sessionId || ''
  } else {
    turn.status = 'failed'
    turn.error = event.message || tr('quick.failed')
  }
  quickActive = null
  pushQuickEvent({ ...event, id: turn.id })
  logger.info(tr('log.quickDone', { id: turn.id, status: turn.status }))
}

function cancelQuickAsk() {
  if (quickActive) {
    try { quickActive.req.destroy() } catch { /* 已经结束 */ }
    const turn = quickTurns.find((item) => item.id === quickActive.id)
    if (turn && turn.status === 'running') {
      turn.status = 'failed'
      turn.error = tr('quick.cancelled')
      pushQuickEvent({ type: 'error', id: turn.id, message: turn.error })
    }
    quickActive = null
  }
  return { ok: true }
}

/** 「查看完整回答」：切回能看到 DSH 界面的形态，并把窗口叫到前面。 */
function openQuickInDsh() {
  if (activeSurface() === 'bubble') {
    config.patch({ surface: 'bar' })
    pushState()          // 形态变化由 pushState 检测并切换窗口
  } else {
    showWindow()
  }
  return { ok: true }
}

// ---------------------------------------------------------------- 界面加载

async function authenticate(port, token) {
  if (token) return { url: uiUrl(port, token), mode: 'token' }

  const minted = mintSessionCookie('127.0.0.1', port)
  if (minted) {
    try {
      await session.fromPartition(PARTITION).cookies.set({
        url: `http://127.0.0.1:${port}/`,
        name: minted.name,
        value: minted.value,
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        expirationDate: minted.expiresAt / 1000,
      })
      logger.info(tr('log.mintedCookie', { authority: minted.authority }))
      return { url: uiUrl(port), mode: 'minted-cookie' }
    } catch (error) {
      logger.error(tr('log.cookieWriteFailed', { message: error.message }))
    }
  }
  logger.info(tr('log.anonymous'))
  return { url: uiUrl(port), mode: 'anonymous' }
}

async function loadDsh() {
  const project = config.activeProject()
  if (!project || !dshView) return
  const { url, mode } = await authenticate(project.port, server.token)
  logger.info(tr('log.loadUi', { mode, url }))
  dshView.setVisible(true)
  await dshView.webContents.loadURL(url).catch((error) => {
    logger.error(tr('log.uiLoadFailed', { message: error.message }))
  })
}

/** 服务未运行时收起 DSH 视图，露出窗口底色，状态由悬浮栏表达。
 *  （不再有独立的「服务未运行」占位页——它在启动过程中会造成突兀的闪切。） */
function showIdle() {
  if (dshView) dshView.setVisible(false)
}

async function openUi() {
  const project = config.activeProject()
  if (!project) return
  showWindow()

  const snapshot = server.snapshot()
  if (snapshot.state === 'running' || snapshot.state === 'external') {
    await loadDsh()
    return
  }
  const probe = await probePort('127.0.0.1', project.port)
  if (probe.alive) {
    await server.refresh(project)
    await loadDsh()
    return
  }
  showIdle()
}

// ---------------------------------------------------------------- 托盘

function updateTray() {
  if (!tray || tray.isDestroyed()) return
  const project = config.activeProject()
  const snapshot = server ? server.snapshot() : { state: 'stopped' }
  const label = tr(`state.${snapshot.state}`)

  let tooltip = `${tr('app.title')} · ${label}`
  if (project) tooltip += `\n${tr('service.port', { port: project.port })}`
  if (balance) {
    const amount = `${balance.currency || ''} ${fmtMoney(balance.totalBalance)}`.trim()
    tooltip += `\n${tr('tray.balance', { value: amount })}`
    if (balance.todayUsage != null) tooltip += `\n${tr('tray.todayUsage', { value: fmtMoney(balance.todayUsage) })}`
  }
  tray.setToolTip(tooltip)
  tray.setContextMenu(buildTrayMenu())
}

function buildTrayMenu() {
  const snapshot = server ? server.snapshot() : { state: 'stopped' }
  const busy = snapshot.state === 'starting' || snapshot.state === 'stopping'
  const active = snapshot.state === 'running' || snapshot.state === 'external'

  return Menu.buildFromTemplate([
    { label: tr('tray.status', { state: tr(`state.${snapshot.state}`) }), enabled: false },
    ...(balance
      ? [
          { label: tr('tray.balance', { value: `${balance.currency || ''} ${fmtMoney(balance.totalBalance)}`.trim() }), enabled: false },
          { label: tr('tray.todayUsage', { value: fmtMoney(balance.todayUsage) }), enabled: false },
        ]
      : []),
    { type: 'separator' },
    { label: tr('tray.showWindow'), click: () => openUi() },
    { label: tr('tray.toggleOverlay'), click: () => sendOverlay('toggle') },
    { type: 'separator' },
    { label: tr('bar.start'), enabled: !active && !busy, click: () => doStart() },
    { label: tr('bar.stop'), enabled: active && !busy, click: () => doStop() },
    { label: tr('bar.restart'), enabled: !busy, click: () => doRestart() },
    { type: 'separator' },
    {
      label: tr('tray.projects'),
      submenu: config.all().projects.map((project) => ({
        label: `${project.name}  ·  ${project.port}`,
        type: 'radio',
        checked: project.id === config.all().activeProjectId,
        click: () => switchProject(config.setActive(project.id)),
      })),
    },
    {
      label: tr('settings.openAtLogin'),
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => setOpenAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: tr('tray.quit'), click: () => { quitting = true; app.quit() } },
  ])
}

function setOpenAtLogin(enabled) {
  config.patch({ openAtLogin: enabled })
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: app.isPackaged ? [] : [path.resolve(__dirname)],
  })
  pushState()
}

function createTray() {
  if (HIDDEN) return
  tray = new Tray(trayImage())
  tray.setToolTip(tr('app.title'))
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => openUi())
  tray.on('double-click', () => sendOverlay('toggle'))
}

// ---------------------------------------------------------------- 服务控制

async function doStart() {
  const project = config.activeProject()
  try {
    prepareEnvironment()
  } catch (error) {
    logger.error(tr('log.envPrepFailed', { message: error.message }))
  }
  const result = await server.start(project)
  pushState()
  if (result.ok) {
    await loadDsh()
    startBalancePolling()
  } else {
    dialog.showErrorBox(tr('dialog.startFailed'), result.error || tr('dialog.unknownError'))
  }
  return result
}

async function doStop() {
  await server.stop()
  stopBalancePolling()
  balance = null
  showIdle()
  pushState()
  return { ok: true }
}

async function doRestart() {
  const project = config.activeProject()
  stopBalancePolling()
  const result = await server.restart(project)
  pushState()
  if (result.ok) {
    await loadDsh()
    startBalancePolling()
  }
  return result
}

async function switchProject(project) {
  // 只有「由本客户端启动」的服务才停掉；接管来的外部实例保持不动
  if (server.snapshot().state === 'running') await server.stop()
  await server.refresh(project)
  const snapshot = server.snapshot()
  if (snapshot.state === 'running' || snapshot.state === 'external') {
    await loadDsh()
  } else {
    showIdle()
    stopBalancePolling()
    balance = null
  }
  pushState()
  return project
}

// ---------------------------------------------------------------- 余额轮询

function startBalancePolling() {
  stopBalancePolling()
  const tick = async () => {
    const project = config.activeProject()
    if (!project) return
    const snapshot = server.snapshot()
    if (snapshot.state !== 'running' && snapshot.state !== 'external') {
      balance = null
    } else {
      const data = await fetchJson(`http://127.0.0.1:${project.port}/dsh-whale/balance.json`)
      balance = data && data.ok ? data : null
    }
    updateTray()
    if (overlayView && !overlayView.webContents.isDestroyed()) {
      overlayView.webContents.send('balance', balance)
    }
  }
  tick()
  balanceTimer = setInterval(tick, 30_000)
}

function stopBalancePolling() {
  if (balanceTimer) clearInterval(balanceTimer)
  balanceTimer = null
}

// ---------------------------------------------------------------- 插件命令

function hasPnpm() {
  try {
    execFileSync('where', ['pnpm'], { windowsHide: true, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function runPluginCommand({ mode, name, spec }) {
  return new Promise((resolve) => {
    const runtime = resolveRuntime()
    if (!runtime.dshBin || !runtime.nodeBin) {
      const error = tr('log.runtimeMissing')
      logger.error(error)
      return resolve({ ok: false, error })
    }
    const argsByMode = {
      install: ['plugin', '--profile', 'web', 'add', spec || WHALE_SPEC],
      update: ['plugin', '--profile', 'web', 'update', name || WHALE_NAME],
      remove: ['plugin', '--profile', 'web', 'remove', name || WHALE_NAME],
    }
    const args = argsByMode[mode]
    if (!args) return resolve({ ok: false, error: `未知操作：${mode}` })

    const fullArgs = [...runtime.nodeArgs, runtime.dshBin, ...args]
    logger.info(tr('log.exec', { command: `${runtime.nodeBin} ${fullArgs.join(' ')}` }))
    const child = spawn(runtime.nodeBin, fullArgs, {
      cwd: config.activeProject()?.cwd || undefined,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 不要注入 GIT_CONFIG_* 这类名字含 KEY/TOKEN/SECRET 的变量：
      // dsh-subprocess 会按 /KEY|PASSWORD|SECRET|TOKEN/i 清洗子进程环境，
      // GIT_CONFIG_KEY_n 会被丢掉而 GIT_CONFIG_COUNT/VALUE_n 留下，
      // git 随即报 "missing config key GIT_CONFIG_KEY_n" 并拒绝执行任何命令。
      env: {
        ...process.env,
        ...runtime.env,
      },
    })
    child.stdout.on('data', (chunk) => logger.write('plugin', String(chunk)))
    child.stderr.on('data', (chunk) => logger.write('plugin', String(chunk)))
    child.on('error', (error) => {
      logger.error(tr('log.pluginSpawnFailed', { message: error.message }))
      resolve({ ok: false, error: error.message })
    })
    child.on('exit', (code) => {
      logger.info(tr('log.pluginFinished', { code }))
      if (code !== 0 && !hasPnpm()) {
        logger.error(tr('log.pnpmMissing'))
      }
      pushState()
      resolve({ ok: code === 0, code })
    })
  })
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('state:get', () => fullState())
  ipcMain.handle('i18n:messages', () => ({
    language: effectiveLanguage(),
    messages: messagesFor(effectiveLanguage()),
  }))
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); return { ok: true } })
  ipcMain.handle('app:hideWindow', () => { if (mainWindow) mainWindow.hide(); return { ok: true } })
  // 悬浮窗的 ✕ 走这条：收悬浮窗、回主界面，不碰主窗口的显示状态
  ipcMain.handle('bubble:close', () => closeBubbleWindow())

  ipcMain.handle('server:start', () => doStart())
  ipcMain.handle('server:stop', () => doStop())
  ipcMain.handle('server:restart', () => doRestart())
  ipcMain.handle('server:openBrowser', async () => {
    const project = config.activeProject()
    if (!project) return { ok: false }
    const { url } = await authenticate(project.port, server.token)
    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('config:patch', (_event, patch) => {
    config.patch(patch || {})
    if (patch && 'openAtLogin' in patch) setOpenAtLogin(Boolean(patch.openAtLogin))
    if (patch && 'theme' in patch) syncThemeToDsh(config.all().theme)
    // 语言：一次切换同时作用于本客户端（渲染层重新取词）与 DSH 自身
    if (patch && 'language' in patch) syncLanguageToDsh()
    pushState()
    return config.all()
  })

  ipcMain.handle('project:setActive', (_event, id) => switchProject(config.setActive(id)))

  /**
   * 切换界面形态。手动切换隐含「我要自己控制」，因此会同时关掉自动切换，
   * 否则下一次服务状态变化就会把它顶回去。设置里的开关可以再打开自动模式。
   */
  ipcMain.handle('surface:set', (_event, value) => {
    const state = server ? server.snapshot().state : 'stopped'
    let next
    if (value === 'toggle') next = currentSurface(state) === 'console' ? 'bar' : 'console'
    else if (value === 'bubble') next = 'bubble'
    else if (value === 'console') next = 'console'
    else next = 'bar'
    config.patch({ surface: next, autoSurface: false })
    pushState()
    return next
  })

  // ---------------------------------------------------------- 便携悬浮窗

  ipcMain.handle('quick:ask', (_event, payload) => {
    const question = String(payload?.question || '').trim()
    if (!question) return { ok: false, error: tr('quick.emptyQuestion') }
    return startQuickAsk(question)
  })
  ipcMain.handle('quick:cancel', () => cancelQuickAsk())
  ipcMain.handle('quick:history', () => quickTurns)
  ipcMain.handle('quick:openInDsh', () => openQuickInDsh())

  ipcMain.handle('project:upsert', async (_event, project) => {
    const saved = config.upsertProject(project || {})
    if (saved.id === config.all().activeProjectId) await switchProject(saved)
    else pushState()
    return saved
  })

  ipcMain.handle('project:remove', async (_event, id) => {
    const ok = config.removeProject(id)
    await switchProject(config.activeProject())
    return { ok }
  })

  ipcMain.handle('dialog:pickDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: tr('dialog.pickDirectory'),
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('logs:tail', () => logger.tail(500))
  ipcMain.handle('logs:clear', () => { logger.clear(); return { ok: true } })
  ipcMain.handle('logs:openFile', async () => { await shell.openPath(logger.file); return { ok: true } })

  ipcMain.handle('plugins:list', () => listPlugins())
  ipcMain.handle('plugin:run', (_event, payload) => runPluginCommand(payload || {}))

  ipcMain.handle('balance:refresh', async () => {
    const project = config.activeProject()
    if (!project) return null
    const data = await fetchJson(`http://127.0.0.1:${project.port}/dsh-whale/balance.json`)
    balance = data && data.ok ? data : null
    updateTray()
    return balance
  })

  /** 悬浮栏上报自身内容尺寸；主进程据此精确设置视图大小，
   *  面板以外的区域因此仍能正常点击到下面的 DSH 界面。 */
  ipcMain.handle('overlay:resize', (_event, size) => {
    // 控制台形态由主进程铺满窗口，忽略上报尺寸，否则会被缩回悬浮条大小
    if (activeSurface() === 'console') return { ok: true, ignored: true }
    const width = Math.max(40, Math.round(Number(size?.width) || DEFAULT_OVERLAY_SIZE.width))
    const height = Math.max(40, Math.round(Number(size?.height) || DEFAULT_OVERLAY_SIZE.height))
    if (width === overlaySize.width && height === overlaySize.height) return { ok: true }
    overlaySize = { width, height }
    if (mainWindow && !mainWindow.isDestroyed()) positionOverlay(...mainWindow.getContentSize())
    return { ok: true }
  })
}

// ---------------------------------------------------------------- 生命周期

app.on('second-instance', () => openUi())

app.whenReady().then(async () => {
  config = new Config(app.getPath('userData'))
  logger = new Logger(path.join(app.getPath('logs'), 'dsh-client.log'))
  server = new ServerManager({ logger, tr })
  syncThemeToDsh(config.all().theme)
  // 让 DSH 的界面语言与客户端保持一致（写 settings.yaml，DSH 监听该文件即时生效）
  syncLanguageToDsh()

  server.on('state', () => pushState())
  logger.on('line', (line) => {
    if (overlayView && !overlayView.webContents.isDestroyed()) {
      overlayView.webContents.send('log', line)
    }
  })

  app.setLoginItemSettings({
    openAtLogin: config.all().openAtLogin,
    path: process.execPath,
    args: app.isPackaged ? [] : [path.resolve(__dirname)],
  })

  registerIpc()
  createTray()
  createWindow()

  // 首次运行：确保 DSH profile 存在且已启用随包插件（不依赖 pnpm）
  try {
    prepareEnvironment()
  } catch (error) {
    logger.error(tr('log.envPrepFailed', { message: error.message }))
  }

  const project = config.activeProject()
  if (project) {
    if (config.all().adoptExternal) {
      await server.refresh(project)
      if (server.snapshot().state === 'external') {
        logger.info(tr('log.adopted', { port: project.port }))
        startBalancePolling()
      }
    }
    const snapshot = server.snapshot()
    if (snapshot.state === 'running' || snapshot.state === 'external') {
      await loadDsh()
    } else if (config.all().autoStartOnLaunch) {
      // 双击即用：客户端起来就把服务拉起来，而不是停在占位页
      logger.info(tr('log.autoStart'))
      await doStart()
    } else {
      showIdle()
    }
  }

  pushState()
  if (!HIDDEN) showWindow()
})

app.on('window-all-closed', () => {
  // 托盘常驻：不因窗口关闭而退出
})

app.on('before-quit', async (event) => {
  if (quitAfterStop) return
  quitting = true
  stopBalancePolling()
  if (config.all().stopServerOnQuit && server && server.child) {
    event.preventDefault()
    quitAfterStop = true
    await server.dispose({ kill: true })
    logger.info(tr('log.stoppedByClient'))
    app.quit()
  }
})

process.on('uncaughtException', (error) => {
  if (logger) logger.error(tr('log.uncaught', { message: error?.stack || error?.message || error }))
})
