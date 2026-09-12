'use strict'

// 悬浮选项栏 / 全窗口控制台 的渲染逻辑。
//
// 整体包在 IIFE 里：传统 <script> 的顶层声明会落进全局作用域，
// 与 i18n.js 等脚本的同名声明冲突会直接变成语法错误。

;(function () {

const api = window.dshClient
const { t, applyStatic, setMessages } = window.__dshI18n
const $ = (id) => document.getElementById(id)

const WHALE_SPEC = 'github:MeteorNOX/DeepSeek-Balance-Whale-Widget'

let current = null
let logBuffer = []
let logFilter = 'all'
let lastSize = { width: 0, height: 0 }
let lastLanguage = ''
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

function formatUptime(startedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const totalMinutes = Math.floor(seconds / 60)
  if (totalMinutes >= 60) {
    return t('service.uptimeHours', { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 })
  }
  return t('service.uptime', { minutes: totalMinutes, seconds: String(seconds % 60).padStart(2, '0') })
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

const COLLAPSE_MS = 180

/**
 * 展开/收起主面板。
 * 收起时先播放淡出动画，动画结束再 display:none——
 * 否则视图会立刻缩到悬浮条大小，看不出过渡。
 */
function setExpanded(expanded) {
  const panel = $('panel')
  clearTimeout(setExpanded._timer)

  if (expanded) {
    panel.classList.remove('hidden')
    // 强制一次重排，保证从「隐藏」到「可见」之间真的产生过渡
    void panel.offsetHeight
    panel.classList.remove('panel-leaving')
    $('btnToggle').textContent = '×'
    $('btnToggle').title = t('bar.collapse')
  } else {
    panel.classList.add('panel-leaving')
    setExpanded._timer = setTimeout(() => {
      panel.classList.add('hidden')
      panel.classList.remove('panel-leaving')
      afterLayoutChange()
    }, COLLAPSE_MS)
    $('btnToggle').textContent = '⋯'
    $('btnToggle').title = t('bar.expand')
  }
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
  const raw = (current && current.surface) || 'bar'
  // 悬浮窗是**另一个窗口**，主窗口在它打开时照常显示；这里按悬浮条渲染即可
  const next = raw === 'console' ? 'console' : 'bar'
  // 悬浮窗开着时，主界面要能把它关掉
  const inBubble = raw === 'bubble'
  const back = $('btnLeaveBubble')
  if (back) back.hidden = !inBubble
  const changed = next !== lastSurface
  document.body.dataset.surface = next
  if (next === 'console') {
    const panel = $('panel')
    clearTimeout(setExpanded._timer)
    panel.classList.remove('hidden', 'panel-leaving')
    for (const acc of document.querySelectorAll('.acc')) acc.classList.add('open')
  } else if (lastSurface === 'console') {
    // 从控制台回到悬浮条：收起面板，避免一出现就铺满屏幕
    clearTimeout(setExpanded._timer)
    $('panel').classList.add('hidden')
    $('panel').classList.remove('panel-leaving')
  }
  if (changed && lastSurface !== '') {
    document.body.classList.add('surface-anim')
    setTimeout(() => document.body.classList.remove('surface-anim'), 260)
  }
  lastSurface = next
}

/** 客户端界面主题：只改 body 的 data-theme，颜色由 theme-tokens.css 决定。 */
function applyTheme(animate = false) {
  const next = (current && current.config && current.config.theme) || 'dsh-white-blue'
  const changed = document.body.dataset.theme !== next
  if (changed && animate) {
    // 只在切换的那一刻打开颜色过渡，避免平时悬停/重绘也被拖慢
    document.body.classList.add('theme-anim')
    clearTimeout(applyTheme._timer)
    applyTheme._timer = setTimeout(() => document.body.classList.remove('theme-anim'), 340)
  }
  document.body.dataset.theme = next
}

function renderThemes() {
  const select = $('optTheme')
  if (!select) return
  const list = Array.isArray(current && current.themes) ? current.themes : []
  const signature = list.map((theme) => theme.id).join(',')
  if (select.dataset.signature !== signature) {
    select.innerHTML = list
      // 主题名走词典（词典缺失时回落到主题自带的 label）
      .map((theme) => `<option value="${escapeHtml(theme.id)}">${escapeHtml(t(`theme.${theme.id}`) === `theme.${theme.id}` ? theme.label : t(`theme.${theme.id}`))}</option>`)
      .join('')
    select.dataset.signature = signature
  }
  select.value = (current && current.config && current.config.theme) || 'dsh-white-blue'
}

function renderLanguages() {
  const select = $('optLanguage')
  if (!select) return
  const list = Array.isArray(current && current.languages) ? current.languages : []
  const signature = list.map((language) => language.id).join(',')
  if (select.dataset.signature !== signature) {
    select.innerHTML = list
      .map((language) => `<option value="${escapeHtml(language.id)}">${escapeHtml(language.label)}</option>`)
      .join('')
    select.dataset.signature = signature
  }
  select.value = (current && current.language) || 'zh'
}

// ---------------------------------------------------------------- 渲染

function renderBar() {
  const snapshot = current.server
  $('dot').className = `dot ${snapshot.state}`
  $('barState').textContent = t(`state.${snapshot.state}`)
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
  if (snapshot.port) bits.push(t('service.port', { port: snapshot.port }))
  if (snapshot.pid) bits.push(`PID ${snapshot.pid}`)
  if (snapshot.startedAt) bits.push(formatUptime(snapshot.startedAt))
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
    hint.textContent = t('service.hint.lastError', { message: snapshot.lastError })
    hint.className = 'hint error'
  } else if (snapshot.state === 'external') {
    hint.textContent = t('service.hint.external')
    hint.className = 'hint'
  } else if (snapshot.state === 'running') {
    hint.textContent = t('service.hint.running')
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
      <div class="radio" title="${escapeHtml(t('projects.setActive'))}"></div>
      <div class="info">
        <div class="name">${escapeHtml(project.name)}</div>
        <div class="path">${escapeHtml(project.cwd)}</div>
      </div>
      <div class="port">:${project.port}</div>
      <div class="row-actions">
        <button class="btn tiny" data-act="edit">${escapeHtml(t('projects.edit'))}</button>
        <button class="btn tiny danger" data-act="remove" ${projects.length <= 1 ? 'disabled' : ''}>${escapeHtml(t('projects.delete'))}</button>
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
      <input data-field="name" placeholder="${escapeHtml(t('projects.field.name'))}" value="${escapeHtml(project.name)}" />
      <input data-field="port" type="number" min="1" max="65535" placeholder="${escapeHtml(t('projects.field.port'))}" value="${project.port}" />
      <div class="full">
        <input data-field="cwd" placeholder="${escapeHtml(t('projects.field.cwd'))}" value="${escapeHtml(project.cwd)}" />
        <button class="btn tiny" data-act="browse">${escapeHtml(t('projects.browse'))}</button>
      </div>
      <div class="full">
        <button class="btn tiny primary" data-act="save">${escapeHtml(t('projects.save'))}</button>
        <button class="btn tiny" data-act="cancel">${escapeHtml(t('projects.cancel'))}</button>
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
      name: input('name').value.trim() || t('projects.untitled'),
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
        <div class="sub">${escapeHtml(t('plugins.notInstalled'))}</div>
      </div>
      <div class="row-actions"><button class="btn tiny primary" data-act="install">${escapeHtml(t('plugins.install'))}</button></div>`
    row.querySelector('[data-act="install"]').addEventListener('click', () => api.pluginRun({ mode: 'install', spec: WHALE_SPEC }))
    host.appendChild(row)
  }

  for (const plugin of list) {
    const row = document.createElement('div')
    row.className = 'plugin'
    const versionText = plugin.version ? `v${escapeHtml(plugin.version)}` : escapeHtml(t('plugins.versionUnknown'))
    const layerText = plugin.bundle ? ` · ${escapeHtml(t('plugins.uiLayer'))}` : ''
    row.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(plugin.name)}</div>
        <div class="sub">${versionText}${layerText}</div>
      </div>
      ${plugin.bundle ? '<span class="tag">bundle</span>' : ''}
      <div class="row-actions">
        <button class="btn tiny" data-act="update">${escapeHtml(t('plugins.update'))}</button>
        <button class="btn tiny danger" data-act="remove">${escapeHtml(t('plugins.uninstall'))}</button>
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
  $('optAutoSurface').checked = Boolean(current.config.autoSurface)

  const rows = [
    ['node', current.resolved.node, Boolean(current.resolved.node)],
    ['dsh', current.resolved.dsh, Boolean(current.resolved.dsh)],
    [t('env.whaleAssets'), current.resolved.whaleAssets, Boolean(current.resolved.whaleAssets)],
    ['DSH_HOME', current.resolved.dshHome, true],
    [t('env.uiUrl'), current.resolved.uiUrl, true],
  ]
  $('env').innerHTML = rows
    .map(([label, value, ok]) => `<dt>${escapeHtml(label)}</dt><dd class="${ok ? '' : 'bad'}">${escapeHtml(value || t('common.notFound'))}</dd>`)
    .join('')
}

function renderQuickAsk() {
  const quick = (current && current.config && current.config.quickAsk) || {}
  const language = (current && current.language) || 'zh'

  const session = $('optQuickSession')
  if (session) {
    // 选项文案跟语言走，换语言要重建
    if (session.dataset.lang !== language) {
      session.innerHTML = [
        `<option value="active">${escapeHtml(t('settings.quickSessionActive'))}</option>`,
        `<option value="dedicated">${escapeHtml(t('settings.quickSessionDedicated'))}</option>`,
      ].join('')
      session.dataset.lang = language
    }
    session.value = quick.session === 'dedicated' ? 'dedicated' : 'active'
  }

  const summary = $('optQuickSummary')
  if (summary) {
    if (summary.dataset.lang !== language) {
      summary.innerHTML = [
        `<option value="model">${escapeHtml(t('settings.quickSummaryModel'))}</option>`,
        `<option value="truncate">${escapeHtml(t('settings.quickSummaryTruncate'))}</option>`,
      ].join('')
      summary.dataset.lang = language
    }
    summary.value = quick.summary === 'truncate' ? 'truncate' : 'model'
  }
}

function renderAll({ animateTheme = false } = {}) {
  if (!current) return
  applyTheme(animateTheme)
  renderThemes()
  renderLanguages()
  renderQuickAsk()
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

// ---------------------------------------------------------------- 语言

/** 语言变化时重新取词典并整屏重绘（静态文案 + 动态文案）。 */
async function refreshLanguage() {
  const payload = await api.i18nMessages()
  setMessages(payload.language, payload.messages)
  lastLanguage = payload.language
  applyStatic()
  $('btnToggle').title = isExpanded() ? t('bar.collapse') : t('bar.expand')
  renderAll()
  renderLogs()
}

// ---------------------------------------------------------------- 拖动

/**
 * 悬浮栏拖动。
 *
 * 背景：悬浮栏不是独立窗口，而是主窗口里的一个**子视图**（WebContentsView），
 * 位置由主进程按「右上角」算出来。所以「拖动」= 不断上报新的左上角坐标，
 * 主进程 setBounds 之后再回报。视图本身只覆盖面板那一小块，
 * 鼠标一旦移出面板就收不到 mousemove 了 —— 所以这里用
 * **指针捕获**（setPointerCapture）把事件留在面板上，这是关键。
 *
 * 坐标换算：面板左上角在窗口里的位置 = 拖动开始时的位置 + 鼠标位移。
 * 我们不知道面板当前在窗口的哪个坐标，但**位移**是准的，
 * 所以用「起点用未知量表示、每次上报相对位移」的方式交给主进程去夹边界。
 */
let overlayPos = null   // 面板左上角在**窗口**里的坐标，由主进程随 state 推送

function bindDrag() {
  const handle = $('dragHandle')
  if (!handle) return

  let dragging = false
  let startX = 0
  let startY = 0
  let baseX = 0
  let baseY = 0

  handle.addEventListener('pointerdown', (event) => {
    // 只在悬浮条形态下拖动；控制台铺满窗口，没有「位置」可言
    if (document.body.dataset.surface === 'console') return
    if (event.button !== 0) return
    if (!overlayPos) return          // 主进程还没给出基准坐标，先不动
    dragging = true
    startX = event.clientX
    startY = event.clientY
    baseX = overlayPos.x
    baseY = overlayPos.y
    // 指针捕获：视图只覆盖面板这一小块，不捕获的话鼠标一移出面板就丢事件
    handle.setPointerCapture(event.pointerId)
    document.body.classList.add('dragging')
    event.preventDefault()
  })

  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return   // 节流，避免高频 IPC
    api.overlayMove({ x: baseX + dx, y: baseY + dy })
  })

  const end = (event) => {
    if (!dragging) return
    dragging = false
    try { handle.releasePointerCapture(event.pointerId) } catch { /* 已释放 */ }
    document.body.classList.remove('dragging')
    // 收尾时用精确位移再报一次（pointermove 里是节流的）
    api.overlayMove({ x: baseX + (event.clientX - startX), y: baseY + (event.clientY - startY) })
  }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)

  // 双击把手 = 回到默认位置（右上角）
  handle.addEventListener('dblclick', () => api.overlayResetPos())
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

  // 界面形态手动切换：悬浮条里是图标、控制台里是带文字的按钮，行为一致
  $('btnSurfaceBar').addEventListener('click', () => api.setSurface('toggle'))
  $('btnSurfaceConsole').addEventListener('click', () => api.setSurface('toggle'))
  $('btnBubble').addEventListener('click', () => api.setSurface('bubble'))
  $('btnLeaveBubble').addEventListener('click', () => api.setSurface('bar'))
  $('optAutoSurface').addEventListener('change', (e) => api.patchConfig({ autoSurface: e.target.checked }))

  $('optQuickSession').addEventListener('change', (e) => {
    api.patchConfig({ quickAsk: { session: e.target.value } })
  })
  $('optQuickSummary').addEventListener('change', (e) => {
    api.patchConfig({ quickAsk: { summary: e.target.value } })
  })

  $('btnAddProject').addEventListener('click', () => {
    const host = $('projects')
    const row = document.createElement('div')
    row.className = 'project'
    host.appendChild(row)
    editProject(row, { id: '', name: t('projects.newName'), cwd: current.project?.cwd || '', port: 3081 })
  })

  $('optOpenAtLogin').addEventListener('change', (e) => api.patchConfig({ openAtLogin: e.target.checked }))
  $('optAutoStart').addEventListener('change', (e) => api.patchConfig({ autoStartOnLaunch: e.target.checked }))
  $('optOpenUiOnStart').addEventListener('change', (e) => api.patchConfig({ openUiOnStart: e.target.checked }))
  $('optAdoptExternal').addEventListener('change', (e) => api.patchConfig({ adoptExternal: e.target.checked }))
  $('optStopOnQuit').addEventListener('change', (e) => api.patchConfig({ stopServerOnQuit: e.target.checked }))

  $('optTheme').addEventListener('change', (e) => {
    // 先本地切（带动画），再由主进程同步给 DSH 侧的注入脚本
    if (current) current.config = { ...current.config, theme: e.target.value }
    applyTheme(true)
    api.patchConfig({ theme: e.target.value })
  })

  $('optLanguage').addEventListener('change', (e) => {
    api.patchConfig({ language: e.target.value })
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
  bindDrag()
  bindAccordion()
  $('panel').querySelector('.acc[data-key="service"]').classList.add('open')

  const payload = await api.i18nMessages()
  setMessages(payload.language, payload.messages)
  lastLanguage = payload.language
  applyStatic()

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
    const languageChanged = Boolean(next.language) && next.language !== lastLanguage
    const themeChanged = Boolean(next.config) && current && next.config.theme !== current.config.theme
    current = next
    // 面板的窗口坐标随状态更新——拖动时以它为基准
    if (next.overlayPos) overlayPos = next.overlayPos
    if (languageChanged) {
      // 语言变了：先换词典再整屏重绘（refreshLanguage 内部会 renderAll）
      refreshLanguage()
      return
    }
    renderAll({ animateTheme: themeChanged })
  })
  api.onOverlayCommand((command) => {
    if (command === 'toggle') setExpanded(!isExpanded())
    else if (command === 'expand') setExpanded(true)
    else if (command === 'collapse') setExpanded(false)
  })

  current = await api.getState()
  if (current.overlayPos) overlayPos = current.overlayPos
  renderAll()

  new ResizeObserver(reportSize).observe(document.body)
  reportSize()
  setTimeout(reportSize, 120)
  setTimeout(reportSize, 400)

  setInterval(() => { if (current) renderServer() }, 1000)
}

// 验证钩子：tools/verify.js 用它直接切形态/主题/语言，不必真的去停服务
window.__dshControl = {
  setSurface(surface) {
    current = { ...(current || {}), surface }
    applySurface()
    return document.body.dataset.surface
  },
  setTheme(id) {
    current = { ...(current || {}), config: { ...((current && current.config) || {}), theme: id } }
    applyTheme(true)
    return document.body.dataset.theme
  },
  async setLanguage(id) {
    await api.patchConfig({ language: id })
    return lastLanguage
  },
  get surface() { return document.body.dataset.surface },
  get theme() { return document.body.dataset.theme },
  get language() { return lastLanguage },
}

main()

})()
