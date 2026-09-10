'use strict'

// 悬浮选项栏渲染进程逻辑。

const api = window.dshClient
const $ = (id) => document.getElementById(id)

const WHALE_SPEC = 'github:MeteorNOX/DeepSeek-Balance-Whale-Widget'

const stateLabels = {
  stopped: '已停止',
  starting: '启动中…',
  running: '运行中',
  external: '运行中 · 接管',
  stopping: '停止中…',
}

let current = null
let logBuffer = []
let logFilter = 'all'
let lastSize = { width: 0, height: 0 }
const MAX_LOG_LINES = 800

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function fmtMoney(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '--'
  if (number === 0) return '0.00'
  return Math.abs(number) >= 1 ? number.toFixed(2) : number.toFixed(4)
}

// ---------------------------------------------------------------- 尺寸上报

/** 面板以外必须不占视图区域，否则会挡住 DSH 界面的点击。 */
function reportSize() {
  const rect = document.body.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)
  if (width === lastSize.width && height === lastSize.height) return
  lastSize = { width, height }
  api.overlayResize(lastSize)
}

function afterLayoutChange() {
  requestAnimationFrame(() => {
    reportSize()
    requestAnimationFrame(reportSize)
  })
}

// ---------------------------------------------------------------- 折叠面板

function setExpanded(expanded) {
  $('panel').classList.toggle('hidden', !expanded)
  $('btnToggle').textContent = expanded ? '×' : '⋯'
  $('btnToggle').title = expanded ? '收起选项栏' : '展开选项栏'
  afterLayoutChange()
}

function isExpanded() {
  return !$('panel').classList.contains('hidden')
}

function bindAccordion() {
  for (const head of document.querySelectorAll('.acc-head')) {
    head.addEventListener('click', () => {
      head.closest('.acc').classList.toggle('open')
      afterLayoutChange()
    })
  }
}

// ---------------------------------------------------------------- 形态与主题

let lastSurface = ''

/** 服务未运行 → 全面控制台（铺满窗口、面板全开）；启动中/运行中 → 右上角悬浮条。 */
function applySurface() {
  const next = current && current.surface === 'console' ? 'console' : 'bar'
  document.body.dataset.surface = next
  if (next === 'console') {
    $('panel').classList.remove('hidden')
    for (const acc of document.querySelectorAll('.acc')) acc.classList.add('open')
  } else if (lastSurface === 'console') {
    // 从控制台回到悬浮条：收起面板，避免一出现就铺满屏幕
    setExpanded(false)
  }
  lastSurface = next
}

/** 客户端界面主题：只改 body 的 data-theme，颜色由 theme-tokens.css 决定。 */
function applyTheme() {
  document.body.dataset.theme = (current && current.config && current.config.theme) || 'dsh-white-blue'
}

function renderThemes() {
  const select = $('optTheme')
  if (!select) return
  const list = Array.isArray(current && current.themes) ? current.themes : []
  if (select.options.length !== list.length) {
    select.innerHTML = list
      .map((theme) => `<option value="${escapeHtml(theme.id)}">${escapeHtml(theme.label)}</option>`)
      .join('')
  }
  select.value = (current && current.config && current.config.theme) || 'dsh-white-blue'
}

// ---------------------------------------------------------------- 渲染

function renderBar() {
  const snapshot = current.server
  $('dot').className = `dot ${snapshot.state}`
  $('barState').textContent = stateLabels[snapshot.state] || snapshot.state
  $('barBalance').textContent = current.balance
    ? `${current.balance.currency || ''} ${fmtMoney(current.balance.totalBalance)}`.trim()
    : '--'

  const busy = snapshot.state === 'starting' || snapshot.state === 'stopping'
  const active = snapshot.state === 'running' || snapshot.state === 'external'
  $('btnQuickStart').disabled = active || busy
  $('btnQuickStop').disabled = !active || busy
  $('btnQuickRestart').disabled = busy
}

function renderServer() {
  const snapshot = current.server
  const bits = []
  if (snapshot.port) bits.push(`端口 ${snapshot.port}`)
  if (snapshot.pid) bits.push(`PID ${snapshot.pid}`)
  if (snapshot.startedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 1000))
    bits.push(`已运行 ${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`)
  }
  if (snapshot.cwd) bits.push(snapshot.cwd)
  $('serverMeta').textContent = bits.join('  ·  ') || '—'

  const busy = snapshot.state === 'starting' || snapshot.state === 'stopping'
  const active = snapshot.state === 'running' || snapshot.state === 'external'
  $('btnStart').disabled = active || busy
  $('btnStop').disabled = !active || busy
  $('btnRestart').disabled = busy
  $('btnBrowser').disabled = !active

  const hint = $('serverHint')
  if (snapshot.lastError) {
    hint.textContent = `最近错误：${snapshot.lastError}`
    hint.className = 'hint error'
  } else if (snapshot.state === 'external') {
    hint.textContent = '端口上已有 DSH 实例，客户端已接管（停止会结束该进程）。'
    hint.className = 'hint'
  } else if (snapshot.state === 'running') {
    hint.textContent = '服务由本客户端启动，界面就在本窗口内。'
    hint.className = 'hint'
  } else {
    hint.textContent = ''
    hint.className = 'hint'
  }
}

function renderProjects() {
  const host = $('projects')
  const { projects, activeProjectId } = current.config
  host.innerHTML = ''

  for (const project of projects) {
    const row = document.createElement('div')
    row.className = `project${project.id === activeProjectId ? ' active' : ''}`
    row.innerHTML = `
      <div class="radio" title="设为当前项目"></div>
      <div class="info">
        <div class="name">${escapeHtml(project.name)}</div>
        <div class="path">${escapeHtml(project.cwd)}</div>
      </div>
      <div class="port">:${project.port}</div>
      <div class="row-actions">
        <button class="btn tiny" data-act="edit">改</button>
        <button class="btn tiny danger" data-act="remove" ${projects.length <= 1 ? 'disabled' : ''}>删</button>
      </div>`
    row.querySelector('.radio').addEventListener('click', async () => {
      if (project.id === current.config.activeProjectId) return
      await api.setActiveProject(project.id)
    })
    row.querySelector('[data-act="edit"]').addEventListener('click', () => editProject(row, project))
    row.querySelector('[data-act="remove"]').addEventListener('click', () => api.removeProject(project.id))
    host.appendChild(row)
  }
}

function editProject(row, project) {
  row.innerHTML = `
    <div class="editor">
      <input data-field="name" placeholder="名称" value="${escapeHtml(project.name)}" />
      <input data-field="port" type="number" min="1" max="65535" placeholder="端口" value="${project.port}" />
      <div class="full">
        <input data-field="cwd" placeholder="工作目录" value="${escapeHtml(project.cwd)}" />
        <button class="btn tiny" data-act="browse">浏览</button>
      </div>
      <div class="full">
        <button class="btn tiny primary" data-act="save">保存</button>
        <button class="btn tiny" data-act="cancel">取消</button>
      </div>
    </div>`
  const input = (field) => row.querySelector(`[data-field="${field}"]`)
  input('name').focus()
  afterLayoutChange()

  row.querySelector('[data-act="browse"]').addEventListener('click', async () => {
    const picked = await api.pickDirectory()
    if (picked) input('cwd').value = picked
  })
  row.querySelector('[data-act="cancel"]').addEventListener('click', () => { renderProjects(); afterLayoutChange() })
  row.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const port = Number(input('port').value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) { input('port').focus(); return }
    await api.upsertProject({
      id: project.id,
      name: input('name').value.trim() || '未命名项目',
      cwd: input('cwd').value.trim(),
      port,
    })
  })
}

function renderPlugins() {
  const host = $('plugins')
  const list = current.plugins || []
  $('pluginCount').textContent = String(list.length)
  host.innerHTML = ''

  if (!list.some((plugin) => plugin.whale)) {
    const row = document.createElement('div')
    row.className = 'plugin'
    row.innerHTML = `
      <div class="info">
        <div class="name">dsh-whale-widget</div>
        <div class="sub">未安装 · 余额挂件</div>
      </div>
      <div class="row-actions"><button class="btn tiny primary" data-act="install">安装</button></div>`
    row.querySelector('[data-act="install"]').addEventListener('click', () => api.pluginRun({ mode: 'install', spec: WHALE_SPEC }))
    host.appendChild(row)
  }

  for (const plugin of list) {
    const row = document.createElement('div')
    row.className = 'plugin'
    row.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(plugin.name)}</div>
        <div class="sub">${plugin.version ? `v${escapeHtml(plugin.version)}` : '版本未解析'}${plugin.bundle ? ' · 界面层' : ''}</div>
      </div>
      ${plugin.bundle ? '<span class="tag">bundle</span>' : ''}
      <div class="row-actions">
        <button class="btn tiny" data-act="update">更新</button>
        <button class="btn tiny danger" data-act="remove">卸载</button>
      </div>`
    row.querySelector('[data-act="update"]').addEventListener('click', () => api.pluginRun({ mode: 'update', name: plugin.name }))
    row.querySelector('[data-act="remove"]').addEventListener('click', () => api.pluginRun({ mode: 'remove', name: plugin.name }))
    host.appendChild(row)
  }
  afterLayoutChange()
}

function renderSettings() {
  $('optOpenAtLogin').checked = Boolean(current.openAtLogin)
  $('optAutoStart').checked = Boolean(current.config.autoStartOnLaunch)
  $('optOpenUiOnStart').checked = Boolean(current.config.openUiOnStart)
  $('optAdoptExternal').checked = Boolean(current.config.adoptExternal)
  $('optStopOnQuit').checked = Boolean(current.config.stopServerOnQuit)

  const rows = [
    ['node', current.resolved.node, Boolean(current.resolved.node)],
    ['dsh', current.resolved.dsh, Boolean(current.resolved.dsh)],
    ['挂件资源', current.resolved.whaleAssets, Boolean(current.resolved.whaleAssets)],
    ['DSH_HOME', current.resolved.dshHome, true],
    ['服务地址', current.resolved.uiUrl, true],
  ]
  $('env').innerHTML = rows
    .map(([label, value, ok]) => `<dt>${escapeHtml(label)}</dt><dd class="${ok ? '' : 'bad'}">${escapeHtml(value || '未找到')}</dd>`)
    .join('')
}

function renderAll() {
  if (!current) return
  applyTheme()
  renderThemes()
  applySurface()
  renderBar()
  renderServer()
  renderProjects()
  renderPlugins()
  renderSettings()
  afterLayoutChange()
}

// ---------------------------------------------------------------- 日志

function logLineHtml(line) {
  return `<span class="ts">${escapeHtml(line.at)}</span> <span class="src-${escapeHtml(line.source)}">[${escapeHtml(line.source)}]</span> ${escapeHtml(line.text)}\n`
}

function renderLogs() {
  const host = $('logs')
  const lines = logFilter === 'all' ? logBuffer : logBuffer.filter((line) => line.source === logFilter)
  host.innerHTML = lines.map(logLineHtml).join('')
  host.scrollTop = host.scrollHeight
}

function appendLog(line) {
  logBuffer.push(line)
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.splice(0, logBuffer.length - MAX_LOG_LINES)
  if (logFilter !== 'all' && line.source !== logFilter) return
  const host = $('logs')
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 60
  host.insertAdjacentHTML('beforeend', logLineHtml(line))
  while (host.childNodes.length > MAX_LOG_LINES) host.removeChild(host.firstChild)
  if (atBottom) host.scrollTop = host.scrollHeight
}

// ---------------------------------------------------------------- 事件

function bind() {
  $('btnToggle').addEventListener('click', () => setExpanded(!isExpanded()))
  $('btnQuickStart').addEventListener('click', () => api.start())
  $('btnQuickStop').addEventListener('click', () => api.stop())
  $('btnQuickRestart').addEventListener('click', () => api.restart())

  $('btnStart').addEventListener('click', () => api.start())
  $('btnStop').addEventListener('click', () => api.stop())
  $('btnRestart').addEventListener('click', () => api.restart())
  $('btnBrowser').addEventListener('click', () => api.openInBrowser())

  $('btnAddProject').addEventListener('click', () => {
    const host = $('projects')
    const row = document.createElement('div')
    row.className = 'project'
    host.appendChild(row)
    editProject(row, { id: '', name: '新项目', cwd: current.project?.cwd || '', port: 3081 })
  })

  $('optOpenAtLogin').addEventListener('change', (e) => api.patchConfig({ openAtLogin: e.target.checked }))
  $('optAutoStart').addEventListener('change', (e) => api.patchConfig({ autoStartOnLaunch: e.target.checked }))
  $('optOpenUiOnStart').addEventListener('change', (e) => api.patchConfig({ openUiOnStart: e.target.checked }))
  $('optAdoptExternal').addEventListener('change', (e) => api.patchConfig({ adoptExternal: e.target.checked }))
  $('optStopOnQuit').addEventListener('change', (e) => api.patchConfig({ stopServerOnQuit: e.target.checked }))

  $('optTheme').addEventListener('change', (e) => {
    // 主进程会把主题同时写进客户端配置与 $DSH_HOME/.dsh-theme.json，
    // DSH 页面的注入脚本轮询到之后跟着切换
    document.body.dataset.theme = e.target.value
    api.patchConfig({ theme: e.target.value })
  })

  $('btnPluginInstallSpec').addEventListener('click', async () => {
    const spec = $('pluginSpec').value.trim()
    if (!spec) { $('pluginSpec').focus(); return }
    await api.pluginRun({ mode: 'install', spec })
    $('pluginSpec').value = ''
  })

  $('btnLogClear').addEventListener('click', async () => {
    await api.logsClear()
    logBuffer = []
    renderLogs()
  })
  $('btnLogFile').addEventListener('click', () => api.logsOpenFile())

  for (const chip of document.querySelectorAll('#logFilters .chip')) {
    chip.addEventListener('click', () => {
      for (const other of document.querySelectorAll('#logFilters .chip')) other.classList.remove('active')
      chip.classList.add('active')
      logFilter = chip.dataset.source
      renderLogs()
    })
  }

  $('btnHideWindow').addEventListener('click', () => api.hideWindow())
  $('btnQuit').addEventListener('click', () => api.quit())

  // 点击悬浮条空白处也可展开
  $('bar').addEventListener('dblclick', () => setExpanded(!isExpanded()))

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isExpanded()) setExpanded(false)
  })
}

// ---------------------------------------------------------------- 启动

async function main() {
  bind()
  bindAccordion()
  $('panel').querySelector('.acc[data-key="service"]').classList.add('open')

  const lines = await api.logsTail()
  logBuffer = Array.isArray(lines) ? lines.slice(-MAX_LOG_LINES) : []
  renderLogs()

  api.onLog((line) => appendLog(line))
  api.onBalance((value) => {
    if (!current) return
    current.balance = value
    renderBar()
  })
  api.onState((next) => {
    current = next
    renderAll()
  })
  api.onOverlayCommand((command) => {
    if (command === 'toggle') setExpanded(!isExpanded())
    else if (command === 'expand') setExpanded(true)
    else if (command === 'collapse') setExpanded(false)
  })

  current = await api.getState()
  renderAll()

  new ResizeObserver(reportSize).observe(document.body)
  reportSize()
  setTimeout(reportSize, 120)
  setTimeout(reportSize, 400)

  setInterval(() => { if (current) renderServer() }, 1000)
}

// 验证钩子：tools/verify.js 用它直接切形态/主题，不必真的去停服务
window.__dshControl = {
  setSurface(surface) {
    current = { ...(current || {}), surface }
    applySurface()
    return document.body.dataset.surface
  },
  setTheme(id) {
    current = { ...(current || {}), config: { ...((current && current.config) || {}), theme: id } }
    applyTheme()
    return document.body.dataset.theme
  },
  get surface() { return document.body.dataset.surface },
  get theme() { return document.body.dataset.theme },
}

main()
