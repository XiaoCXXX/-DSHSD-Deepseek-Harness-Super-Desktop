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

const PARTITION = 'persist:dsh'
const WHALE_SPEC = 'github:MeteorNOX/DeepSeek-Balance-Whale-Widget'
const WHALE_NAME = 'dsh-whale-widget'
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
  const whaleSource = bundledPluginDir(WHALE_NAME)
  const result = ensureProfile({
    dir,
    plugins: [{ name: WHALE_NAME, sourceDir: whaleSource }],
    log: (message) => logger.info(message),
  })
  if (!whaleSource) {
    logger.error(`随包的插件 ${WHALE_NAME} 未找到，挂件将不会出现`)
  } else if (!resolvePackageDir(WHALE_NAME, { dshRoot: runtime.dshRoot, profile: dir })) {
    logger.error(`插件 ${WHALE_NAME} 未能安装到 profile，挂件将不会出现`)
  }
  return { ...result, runtime: runtime.mode }
}

// ---------------------------------------------------------------- 状态

function fullState() {
  const project = config.activeProject()
  const serverSnapshot = server ? server.snapshot() : { state: 'stopped' }
  return {
    server: serverSnapshot,
    // 界面形态：未运行 → 全面控制台；启动中/运行中 → 悬浮条
    surface: surfaceForState(serverSnapshot.state),
    themes: themeList(),
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

function pushState() {
  const nextSurface = surfaceForState((server ? server.snapshot() : { state: 'stopped' }).state)
  if (nextSurface !== surface) {
    surface = nextSurface
    // 形态切换立刻重排：控制台铺满窗口，悬浮条锚定右上角
    if (mainWindow && !mainWindow.isDestroyed()) layoutViews()
  }
  if (overlayView && !overlayView.webContents.isDestroyed()) {
    overlayView.webContents.send('state', fullState())
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
    logger.info(`主题已同步到 DSH：${id}`)
  } catch (error) {
    logger.error(`主题同步失败：${error?.message || error}`)
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
  // 服务未运行：控制台铺满窗口（此时下面只有占位页，不存在挡住 DSH 点击的问题）
  if (surface === 'console') {
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
      logger.info(`已用凭据库密钥签发会话 cookie（authority=${minted.authority}）`)
      return { url: uiUrl(port), mode: 'minted-cookie' }
    } catch (error) {
      logger.error(`写入 cookie 失败：${error.message}`)
    }
  }
  logger.info('无法获取启动令牌也无法签发 cookie，尝试匿名访问')
  return { url: uiUrl(port), mode: 'anonymous' }
}

async function loadDsh() {
  const project = config.activeProject()
  if (!project || !dshView) return
  const { url, mode } = await authenticate(project.port, server.token)
  logger.info(`加载界面（${mode}）：${url}`)
  dshView.setVisible(true)
  await dshView.webContents.loadURL(url).catch((error) => {
    logger.error(`界面加载失败：${error.message}`)
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
  const label = {
    stopped: '已停止',
    starting: '启动中…',
    running: '运行中',
    external: '运行中（接管）',
    stopping: '停止中…',
  }[snapshot.state] || snapshot.state

  let tooltip = `DSH 客户端 · ${label}`
  if (project) tooltip += `\n端口 ${project.port}`
  if (balance) {
    tooltip += `\n余额 ${balance.currency || ''} ${fmtMoney(balance.totalBalance)}`
    if (balance.todayUsage != null) tooltip += `\n今日已用 ${fmtMoney(balance.todayUsage)}`
  }
  tray.setToolTip(tooltip)
  tray.setContextMenu(buildTrayMenu())
}

function buildTrayMenu() {
  const snapshot = server ? server.snapshot() : { state: 'stopped' }
  const busy = snapshot.state === 'starting' || snapshot.state === 'stopping'
  const active = snapshot.state === 'running' || snapshot.state === 'external'

  return Menu.buildFromTemplate([
    {
      label: `状态：${{
        stopped: '已停止', starting: '启动中…', running: '运行中',
        external: '运行中（接管外部实例）', stopping: '停止中…',
      }[snapshot.state] || snapshot.state}`,
      enabled: false,
    },
    ...(balance
      ? [
          { label: `余额：${balance.currency || ''} ${fmtMoney(balance.totalBalance)}`, enabled: false },
          { label: `今日已用：${fmtMoney(balance.todayUsage)}`, enabled: false },
        ]
      : []),
    { type: 'separator' },
    { label: '显示窗口', click: () => openUi() },
    { label: '显示 / 隐藏悬浮栏', click: () => sendOverlay('toggle') },
    { type: 'separator' },
    { label: '启动服务', enabled: !active && !busy, click: () => doStart() },
    { label: '停止服务', enabled: active && !busy, click: () => doStop() },
    { label: '重启服务', enabled: !busy, click: () => doRestart() },
    { type: 'separator' },
    {
      label: '项目',
      submenu: config.all().projects.map((project) => ({
        label: `${project.name}  ·  ${project.port}`,
        type: 'radio',
        checked: project.id === config.all().activeProjectId,
        click: () => switchProject(config.setActive(project.id)),
      })),
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => setOpenAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
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
  tray.setToolTip('DSH 客户端')
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
    logger.error(`环境准备失败：${error.message}`)
  }
  const result = await server.start(project)
  pushState()
  if (result.ok) {
    await loadDsh()
    startBalancePolling()
  } else {
    dialog.showErrorBox('启动失败', result.error || '未知错误')
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
      const error = '找不到可用的 DSH 运行时，无法执行插件命令'
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
    logger.info(`执行：${runtime.nodeBin} ${fullArgs.join(' ')}`)
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
      logger.error(`插件命令启动失败：${error.message}`)
      resolve({ ok: false, error: error.message })
    })
    child.on('exit', (code) => {
      logger.info(`插件命令结束（code=${code}）`)
      if (code !== 0 && !hasPnpm()) {
        logger.error(
          '未检测到 pnpm：安装/更新/卸载插件需要它（可执行 npm i -g pnpm 安装）。' +
          '随安装包内置的挂件不受影响，仍可正常使用。',
        )
      }
      pushState()
      resolve({ ok: code === 0, code })
    })
  })
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('state:get', () => fullState())
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); return { ok: true } })
  ipcMain.handle('app:hideWindow', () => { if (mainWindow) mainWindow.hide(); return { ok: true } })

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
    pushState()
    return config.all()
  })

  ipcMain.handle('project:setActive', (_event, id) => switchProject(config.setActive(id)))

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
      title: '选择工作目录',
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
    if (surface === 'console') return { ok: true, ignored: true }
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
  server = new ServerManager({ logger })
  syncThemeToDsh(config.all().theme)

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
    logger.error(`环境准备失败：${error.message}`)
  }

  const project = config.activeProject()
  if (project) {
    if (config.all().adoptExternal) {
      await server.refresh(project)
      if (server.snapshot().state === 'external') {
        logger.info(`检测到端口 ${project.port} 上已有 DSH 实例，已接管`)
        startBalancePolling()
      }
    }
    const snapshot = server.snapshot()
    if (snapshot.state === 'running' || snapshot.state === 'external') {
      await loadDsh()
    } else if (config.all().autoStartOnLaunch) {
      // 双击即用：客户端起来就把服务拉起来，而不是停在占位页
      logger.info('服务未运行，按设置自动启动')
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
    logger.info('已停止由本客户端启动的服务进程')
    app.quit()
  }
})

process.on('uncaughtException', (error) => {
  if (logger) logger.error(`未捕获异常：${error?.stack || error?.message || error}`)
})
