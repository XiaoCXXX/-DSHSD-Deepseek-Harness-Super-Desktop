'use strict'

// 悬浮栏 UI 预览：用普通（可截图的）窗口加载 control.html，
// 喂入模拟数据后截图，用来快速迭代外观，不必启动整个客户端。
//   electron tools/preview-overlay.js

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const OUT_DIR = path.join(__dirname, '..', '.verify')
const OUT = path.join(OUT_DIR, 'overlay-preview.png')

const now = Date.now()
const MOCK_STATE = {
  server: {
    state: 'external',
    pid: 17000,
    port: 3080,
    host: '127.0.0.1',
    cwd: 'D:\\Testing Arena',
    projectId: 'p-default',
    startedAt: now - 372000,
    hasToken: false,
    lastError: null,
  },
  config: {
    version: 1,
    projects: [
      { id: 'p-default', name: '默认项目', cwd: 'D:\\Testing Arena', port: 3080 },
      { id: 'p-second', name: '文档站点', cwd: 'D:\\Work\\docs-site', port: 3081 },
    ],
    activeProjectId: 'p-default',
    openAtLogin: false,
    adoptExternal: true,
    openUiOnStart: true,
    stopServerOnQuit: false,
  },
  balance: { ok: true, currency: 'CNY', totalBalance: 148.29, todayUsage: 0.68 },
  plugins: [
    {
      name: 'dsh-whale-widget',
      spec: 'github:MeteorNOX/DeepSeek-Balance-Whale-Widget',
      version: '0.2.10',
      bundle: true,
      whale: true,
    },
  ],
  resolved: {
    node: 'C:\\Program Files\\nodejs\\node.exe',
    dsh: 'C:\\Users\\xiaoc\\AppData\\Local\\npm-cache\\_npx\\1e7f6d9597241db0\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    whaleAssets: 'C:\\Users\\xiaoc\\.dsh\\profiles\\web\\node_modules\\dsh-whale-widget\\assets',
    dshHome: 'C:\\Users\\xiaoc\\.dsh',
    uiUrl: 'http://127.0.0.1:3080/',
  },
  openAtLogin: false,
  versions: { electron: '44.3.0', node: '26.7.0' },
}

const MOCK_LOGS = [
  { ts: now - 5000, at: '15:40:29', source: 'client', text: '检测到端口 3080 上已有 DSH 实例，已接管' },
  { ts: now - 4900, at: '15:40:29', source: 'client', text: '已用凭据库密钥签发会话 cookie（authority=127.0.0.1:3080）' },
  { ts: now - 4800, at: '15:40:29', source: 'client', text: '加载界面（minted-cookie）：http://127.0.0.1:3080/' },
  { ts: now - 2000, at: '15:41:02', source: 'server', text: 'dsh web: http://127.0.0.1:3080/?token=••••••' },
  { ts: now - 1000, at: '15:41:03', source: 'plugin', text: 'Progress: resolved 1, reused 1, downloaded 0, added 1, done' },
]

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  ipcMain.handle('state:get', () => MOCK_STATE)
  ipcMain.handle('logs:tail', () => MOCK_LOGS)
  ipcMain.handle('overlay:resize', () => ({ ok: true }))
  for (const channel of [
    'app:quit', 'app:hideWindow', 'server:start', 'server:stop', 'server:restart',
    'server:openBrowser', 'config:patch', 'project:setActive', 'project:upsert',
    'project:remove', 'dialog:pickDirectory', 'logs:clear', 'logs:openFile',
    'plugins:list', 'plugin:run', 'balance:refresh',
  ]) {
    ipcMain.handle(channel, () => ({ ok: true }))
  }

  const win = new BrowserWindow({
    width: 460,
    height: 880,
    show: false,
    backgroundColor: '#12131a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'control.html'))
  await new Promise((resolve) => setTimeout(resolve, 900))

  // 展开面板并打开全部折叠栏，便于一次看全
  await win.webContents.executeJavaScript(`
    document.getElementById('btnToggle').click();
    document.querySelectorAll('.acc').forEach((a) => a.classList.add('open'));
    true;
  `)
  await new Promise((resolve) => setTimeout(resolve, 900))

  const image = await win.webContents.capturePage()
  const png = image.toPNG()
  if (png.length === 0) {
    console.error('截图为空')
    app.exit(1)
    return
  }
  fs.writeFileSync(OUT, png)
  console.log(`已保存 ${OUT}（${png.length} 字节）`)
  app.exit(0)
})
