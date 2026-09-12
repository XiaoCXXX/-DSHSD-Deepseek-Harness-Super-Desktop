'use strict'

// 客户端文案字典（中 / 英）与取词函数。
//
// 主进程（托盘、菜单、对话框）与渲染进程（悬浮栏/控制台）共用这一份，
// 渲染进程通过 IPC 取回当前语言的词典，避免两处各写一套。
//
// 取值规则：从当前语言取；缺失则回落到 zh，再缺失则回落到 key 本身，
// 便于开发时一眼看出漏翻的条目。
//
// 占位符用 {name} 形式，由 format() 替换。

const DEFAULT_LANGUAGE = 'zh'
const LANGUAGES = [
  { id: 'zh', dsh: 'zh', label: '中文', htmlLang: 'zh-CN' },
  { id: 'en', dsh: 'en', label: 'English', htmlLang: 'en' },
]

const MESSAGES = {
  zh: {
    // —— 通用
    'app.title': 'DSH 客户端',
    'app.consoleTitle': 'DSH 客户端控制台',
    'app.consoleSub': '服务未运行 · 全部控制项已展开',
    'common.notFound': '未找到',
    'common.loading': '读取中',

    // —— 服务状态
    'state.stopped': '已停止',
    'state.starting': '启动中…',
    'state.running': '运行中',
    'state.external': '运行中 · 接管',
    'state.stopping': '停止中…',

    // —— 悬浮条
    'bar.start': '启动服务',
    'bar.stop': '停止服务',
    'bar.restart': '重启服务',
    'bar.dragHint': '按住拖动，移动悬浮栏位置（双击复位）',
    'bar.expand': '展开选项栏',
    'bar.collapse': '收起选项栏',

    // —— 分区标题
    'section.service': '服务',
    'section.projects': '项目',
    'section.plugins': '插件',
    'section.logs': '日志',
    'section.settings': '设置',

    // —— 服务面板
    'service.port': '端口 {port}',
    'service.uptime': '已运行 {minutes} 分 {seconds} 秒',
    'service.uptimeHours': '已运行 {hours} 小时 {minutes} 分',
    'service.start': '启动',
    'service.stop': '停止',
    'service.restart': '重启',
    'service.openInBrowser': '在浏览器打开',
    'service.hint.external': '端口上已有 DSH 实例，客户端已接管（停止会结束该进程）。',
    'service.hint.running': '服务由本客户端启动，界面就在本窗口内。',
    'service.hint.lastError': '最近错误：{message}',

    // —— 项目
    'projects.setActive': '设为当前项目',
    'projects.edit': '编辑',
    'projects.delete': '删除',
    'projects.add': '新建项目',
    'projects.untitled': '未命名项目',
    'projects.newName': '新项目',
    'projects.field.name': '名称',
    'projects.field.port': '端口',
    'projects.field.cwd': '工作目录',
    'projects.browse': '浏览…',
    'projects.save': '保存',
    'projects.cancel': '取消',

    // —— 插件
    'plugins.install': '安装',
    'plugins.update': '更新',
    'plugins.uninstall': '卸载',
    'plugins.notInstalled': '未安装 · 余额挂件',
    'plugins.versionUnknown': '版本未知',
    'plugins.uiLayer': '界面层',
    'plugins.specPlaceholder': '包名或 github:owner/repo',
    'plugins.hint': '依赖 pnpm 与 GitHub 访问；安装或更新后需重启服务才会生效。',

    // —— 日志
    'logs.all': '全部',
    'logs.server': '服务',
    'logs.client': '客户端',
    'logs.plugin': '插件',
    'logs.clear': '清空',
    'logs.openFile': '打开日志文件',

    // —— 设置
    'settings.openAtLogin': '开机自启',
    'settings.autoStart': '启动客户端时自动拉起服务',
    'settings.openUiOnStart': '启动服务后打开界面',
    'settings.adoptExternal': '自动接管已运行的实例',
    'settings.stopOnQuit': '退出客户端时停止服务',
    'settings.theme': '界面主题',
    'settings.themeHint': '主题会同时应用到本客户端与 DSH 界面。',
    'settings.autoSurface': '服务启停时自动切换界面',
    'settings.autoSurfaceHint': '关闭时由「切换界面」按钮手动控制；开启后随服务状态自动在 DSH 界面与控制台之间切换。',
    'surface.toConsole': '切换到客户端界面',
    'surface.toDsh': '返回 DSH 界面',
    'settings.language': '界面语言',
    'settings.languageHint': '同时切换本客户端与 DSH 界面的语言。',
    'settings.hideWindow': '隐藏窗口',
    'settings.quit': '退出客户端',

    // —— 主题名（与 lib/themes.js 的 id 对应）
    'theme.dsh-white-blue': 'DSH 原生白蓝',
    'theme.dsh-dark': 'DSH 原生暗色',
    'theme.ice': '冰蓝',
    'theme.ocean': '深海',
    'theme.midnight': '午夜',
    'theme.contrast': '高对比',

    // —— 环境信息
    'env.whaleAssets': '挂件资源',
    'env.uiUrl': '服务地址',

    // —— 托盘与对话框
    'tray.status': '状态：{state}',
    'tray.uptime': '已运行：{value}',
    'tray.showWindow': '显示窗口',
    'tray.toggleOverlay': '显示 / 隐藏悬浮栏',
    'tray.projects': '项目',
    'tray.quit': '退出',
    'dialog.startFailed': '启动失败',
    'dialog.pickDirectory': '选择工作目录',
    'dialog.unknownError': '未知错误',

    // —— 便携悬浮窗（快速提问）
    'quick.title': '快速提问',
    'quick.empty': '问点什么，回答会简短地显示在这里；完整回答在 DSH 界面里。',
    'quick.placeholder': '输入问题，Enter 发送 / Shift+Enter 换行',
    'quick.send': '发送',
    'quick.openDsh': '在 DSH 界面查看完整回答',
    'quick.hide': '关闭悬浮窗，回到主界面',
    'quick.thinking': '正在思考…',
    'quick.running': '正在回答…',
    'quick.summaryLabel': '简答',
    'quick.viewFull': '查看完整回答',
    'quick.failed': '这次没答上来',
    'quick.cancelled': '已取消',
    'quick.busy': '上一个问题还在回答中',
    'quick.emptyQuestion': '问题不能为空',
    'quick.notRunning': 'DSH 服务没在运行，先启动服务',
    'quick.noProject': '没有可用的项目',
    'quick.noCookie': '拿不到会话凭据，无法提问',
    'quick.httpError': '快速提问接口返回 {status}：{body}',
    'quick.netError': '连不上快速提问接口：{message}',
    'quick.closed': '连接被提前关闭',
    'surface.toBubble': '便携悬浮窗',
    'surface.leaveBubble': '关闭悬浮窗',
    'settings.quickAsk': '便携悬浮窗',
    'settings.quickSession': '快速提问落在哪个会话',
    'settings.quickSessionActive': '当前活跃会话（完整回答就在 DSH 界面里）',
    'settings.quickSessionDedicated': '专用会话（不打扰现有对话）',
    'settings.quickSummary': '简答怎么产生',
    'settings.quickSummaryModel': '让模型压成一句话',
    'settings.quickSummaryTruncate': '直接截断完整回答',

    // —— 客户端日志。只覆盖客户端自己产生的行；
    //    DSH 服务端 stdout/stderr 与 pnpm 的输出原样透传，不翻译。
    'log.themeSynced': '主题已同步到 DSH：{theme}',
    'log.themeSyncFailed': '主题同步失败：{message}',
    'log.languageSynced': '已将 DSH 界面语言切换为 {language}（{file}）',
    'log.languageSyncFailed': '同步 DSH 语言失败：{message}',
    'log.quickDone': '快速提问结束（{id}）：{status}',
    'log.quickDispatch': '快速提问派发：会话模式 {session}，简答方式 {summary}',
    'log.configNormalized': '配置已规范化并写回（补全或纠正了缺失/非法的字段）',
    'log.adopted': '检测到端口 {port} 上已有 DSH 实例，已接管',
    'log.autoStart': '服务未运行，按设置自动启动',
    'log.loadUi': '加载界面（{mode}）：{url}',
    'log.uiLoadFailed': '界面加载失败：{message}',
    'log.mintedCookie': '已用凭据库密钥签发会话 cookie（authority={authority}）',
    'log.cookieWriteFailed': '写入 cookie 失败：{message}',
    'log.anonymous': '无法获取启动令牌也无法签发 cookie，尝试匿名访问',
    'log.exec': '执行：{command}',
    'log.pluginFinished': '插件命令结束（code={code}）',
    'log.pluginSpawnFailed': '插件命令启动失败：{message}',
    'log.pnpmMissing': '未检测到 pnpm：安装/更新/卸载插件需要它（可执行 npm i -g pnpm 安装）。随安装包内置的挂件不受影响。',
    'log.runtimeMissing': '找不到可用的 DSH 运行时，无法执行插件命令',
    'log.envPrepFailed': '环境准备失败：{message}',
    'log.pluginSourceMissing': '随包的插件 {name} 未找到，对应的界面元素不会出现',
    'log.pluginNotInstalled': '插件 {name} 未能安装到 profile，对应的界面元素不会出现',
    'log.legacyPluginRemoved': '已移除被取代的旧插件：{names}',
    'log.legacyPluginRemoveFailed': '旧插件清理失败（{detail}），可能出现重复的挂件',
    'log.stoppedByClient': '已停止由本客户端启动的服务进程',
    'log.uncaught': '未捕获异常：{message}',
    'log.server.starting': '启动服务：端口 {port}，工作目录 {cwd}',
    'log.server.alreadyRunning': '端口 {port} 已有服务在运行（HTTP {status}），切换为接管模式',
    'log.server.noRuntime': '找不到可用的 JavaScript 运行时（node 或 Electron）',
    'log.server.noDsh': '找不到 dsh 的 bin.js（既没有随包分发的版本，系统也未安装 @deepseek-ai/dsh）',
    'log.server.bundled': '运行时：随包 DSH（Electron 内置 Node）',
    'log.server.system': '运行时：系统 node + 已安装的 dsh',
    'log.server.spawnFailed': '进程启动失败：{message}',
    'log.server.exited': '服务进程退出（code={code} signal={signal}）',
    'log.server.stopPid': '停止服务进程 PID {pid}',
    'log.server.stopExternalPid': '停止接管实例 PID {pid}',
    'log.server.noListener': '端口上已无监听进程',
    'log.server.startTimeout': '启动超时',
    'log.server.noToken': '未捕获到启动令牌',
    'log.provision.createdProfile': '已创建 web profile 清单',
    'log.provision.enabledPlugin': '已在 profile 中启用插件 {name}',
    'log.provision.installedPlugin': '已随包安装插件 {name} v{version}',
    'log.provision.upgradedPlugin': '已随包升级插件 {name}：v{from} → v{to}',
    'log.provision.refreshedPlugin': '已刷新插件 {name}（同版本但内容变了）',
  },

  en: {
    'app.title': 'DSH Client',
    'app.consoleTitle': 'DSH Client Console',
    'app.consoleSub': 'Service stopped · all controls expanded',
    'common.notFound': 'not found',
    'common.loading': 'Loading',

    'state.stopped': 'Stopped',
    'state.starting': 'Starting…',
    'state.running': 'Running',
    'state.external': 'Running · adopted',
    'state.stopping': 'Stopping…',

    'bar.start': 'Start service',
    'bar.stop': 'Stop service',
    'bar.restart': 'Restart service',
    'bar.expand': 'Expand panel',
    'bar.dragHint': 'Drag to move the panel (double-click to reset)',
    'bar.collapse': 'Collapse panel',

    'section.service': 'Service',
    'section.projects': 'Projects',
    'section.plugins': 'Plugins',
    'section.logs': 'Logs',
    'section.settings': 'Settings',

    'service.port': 'Port {port}',
    'service.uptime': 'Up {minutes}m {seconds}s',
    'service.uptimeHours': 'Up {hours}h {minutes}m',
    'service.start': 'Start',
    'service.stop': 'Stop',
    'service.restart': 'Restart',
    'service.openInBrowser': 'Open in browser',
    'service.hint.external': 'A DSH instance is already listening, and this client adopted it (Stop ends that process).',
    'service.hint.running': 'The service was started by this client; the UI is right in this window.',
    'service.hint.lastError': 'Last error: {message}',

    'projects.setActive': 'Make active',
    'projects.edit': 'Edit',
    'projects.delete': 'Delete',
    'projects.add': 'New project',
    'projects.untitled': 'Untitled project',
    'projects.newName': 'New project',
    'projects.field.name': 'Name',
    'projects.field.port': 'Port',
    'projects.field.cwd': 'Working directory',
    'projects.browse': 'Browse…',
    'projects.save': 'Save',
    'projects.cancel': 'Cancel',

    'plugins.install': 'Install',
    'plugins.update': 'Update',
    'plugins.uninstall': 'Uninstall',
    'plugins.notInstalled': 'Not installed · balance widget',
    'plugins.versionUnknown': 'version unknown',
    'plugins.uiLayer': 'UI layer',
    'plugins.specPlaceholder': 'package name or github:owner/repo',
    'plugins.hint': 'Requires pnpm and access to GitHub. Restart the service after installing or updating.',

    'logs.all': 'All',
    'logs.server': 'Server',
    'logs.client': 'Client',
    'logs.plugin': 'Plugin',
    'logs.clear': 'Clear',
    'logs.openFile': 'Open log file',

    'settings.openAtLogin': 'Launch at login',
    'settings.autoStart': 'Start the service when the client opens',
    'settings.openUiOnStart': 'Open the UI after starting the service',
    'settings.adoptExternal': 'Adopt an instance that is already running',
    'settings.stopOnQuit': 'Stop the service when quitting the client',
    'settings.theme': 'Theme',
    'settings.themeHint': 'The theme applies to both this client and the DSH UI.',
    'settings.autoSurface': 'Switch the view automatically with the service',
    'settings.autoSurfaceHint': 'Off: use the switch button to move between views. On: follow the service state automatically.',
    'surface.toConsole': 'Switch to client console',
    'surface.toDsh': 'Back to DSH',
    'settings.language': 'Language',
    'settings.languageHint': 'Switches the language of both this client and the DSH UI.',
    'settings.hideWindow': 'Hide window',
    'settings.quit': 'Quit client',

    'theme.dsh-white-blue': 'DSH Light Blue',
    'theme.dsh-dark': 'DSH Dark',
    'theme.ice': 'Ice',
    'theme.ocean': 'Ocean',
    'theme.midnight': 'Midnight',
    'theme.contrast': 'High contrast',

    'env.whaleAssets': 'Widget assets',
    'env.uiUrl': 'Service URL',

    'tray.status': 'Status: {state}',
    'tray.uptime': 'Running for: {value}',
    'tray.showWindow': 'Show window',
    'tray.toggleOverlay': 'Show / hide panel',
    'tray.projects': 'Projects',
    'tray.quit': 'Quit',
    'dialog.startFailed': 'Failed to start',
    'dialog.pickDirectory': 'Choose a working directory',
    'dialog.unknownError': 'unknown error',

    'quick.title': 'Quick ask',
    'quick.empty': 'Ask something — you get a short answer here, and the full one lives in the DSH UI.',
    'quick.placeholder': 'Type a question. Enter to send, Shift+Enter for a newline',
    'quick.send': 'Send',
    'quick.openDsh': 'View the full answer in the DSH UI',
    'quick.hide': 'Close the floating window and return to the main window',
    'quick.thinking': 'Thinking…',
    'quick.running': 'Answering…',
    'quick.summaryLabel': 'Short answer',
    'quick.viewFull': 'View full answer',
    'quick.failed': 'That one did not come back',
    'quick.cancelled': 'Cancelled',
    'quick.busy': 'The previous question is still being answered',
    'quick.emptyQuestion': 'The question cannot be empty',
    'quick.notRunning': 'DSH is not running — start the service first',
    'quick.noProject': 'No project available',
    'quick.noCookie': 'Could not obtain a session credential, so the question was not sent',
    'quick.httpError': 'The quick-ask endpoint returned {status}: {body}',
    'quick.netError': 'Could not reach the quick-ask endpoint: {message}',
    'quick.closed': 'The connection closed early',
    'surface.toBubble': 'Portable floating window',
    'surface.leaveBubble': 'Close the floating window',
    'settings.quickAsk': 'Portable floating window',
    'settings.quickSession': 'Which session quick ask uses',
    'settings.quickSessionActive': 'The active session (so the full answer is right there in the DSH UI)',
    'settings.quickSessionDedicated': 'A dedicated session (leaves existing conversations alone)',
    'settings.quickSummary': 'How the short answer is produced',
    'settings.quickSummaryModel': 'Let the model condense it to one sentence',
    'settings.quickSummaryTruncate': 'Truncate the full answer instead',

    'log.themeSynced': 'Theme synced to DSH: {theme}',
    'log.themeSyncFailed': 'Failed to sync theme: {message}',
    'log.languageSynced': 'DSH UI language switched to {language} ({file})',
    'log.languageSyncFailed': 'Failed to sync DSH language: {message}',
    'log.quickDone': 'Quick ask finished ({id}): {status}',
    'log.quickDispatch': 'Quick ask dispatched: session mode {session}, summary mode {summary}',
    'log.configNormalized': 'Config normalized and written back (missing or invalid fields filled in)',
    'log.adopted': 'Found an existing DSH instance on port {port}; adopted it',
    'log.autoStart': 'Service is not running; starting it automatically',
    'log.loadUi': 'Loading UI ({mode}): {url}',
    'log.uiLoadFailed': 'Failed to load UI: {message}',
    'log.mintedCookie': 'Minted a session cookie from the credential-store key (authority={authority})',
    'log.cookieWriteFailed': 'Failed to write cookie: {message}',
    'log.anonymous': 'No launch token and no cookie could be minted; trying anonymous access',
    'log.exec': 'Running: {command}',
    'log.pluginFinished': 'Plugin command finished (code={code})',
    'log.pluginSpawnFailed': 'Failed to start the plugin command: {message}',
    'log.pnpmMissing': 'pnpm was not found: installing, updating, or removing plugins needs it (npm i -g pnpm). The bundled widget is unaffected.',
    'log.runtimeMissing': 'No usable DSH runtime found; cannot run the plugin command',
    'log.envPrepFailed': 'Environment preparation failed: {message}',
    'log.pluginSourceMissing': 'Bundled plugin {name} was not found; its UI will not appear',
    'log.pluginNotInstalled': 'Plugin {name} could not be installed into the profile; its UI will not appear',
    'log.legacyPluginRemoved': 'Removed superseded plugin(s): {names}',
    'log.legacyPluginRemoveFailed': 'Could not clean up a superseded plugin ({detail}); duplicate widgets may appear',
    'log.stoppedByClient': 'Stopped the service process started by this client',
    'log.uncaught': 'Uncaught exception: {message}',
    'log.server.starting': 'Starting service: port {port}, working directory {cwd}',
    'log.server.alreadyRunning': 'Port {port} already serves a DSH instance (HTTP {status}); switching to adopted mode',
    'log.server.noRuntime': 'No usable JavaScript runtime found (node or Electron)',
    'log.server.noDsh': 'Cannot find the dsh bin.js (not bundled, and @deepseek-ai/dsh is not installed)',
    'log.server.bundled': 'Runtime: bundled DSH (Electron built-in Node)',
    'log.server.system': 'Runtime: system node + installed dsh',
    'log.server.spawnFailed': 'Failed to spawn the process: {message}',
    'log.server.exited': 'Service process exited (code={code} signal={signal})',
    'log.server.stopPid': 'Stopping service process PID {pid}',
    'log.server.stopExternalPid': 'Stopping adopted instance PID {pid}',
    'log.server.noListener': 'No process is listening on the port any more',
    'log.server.startTimeout': 'Startup timed out',
    'log.server.noToken': 'Launch token was not captured',
    'log.provision.createdProfile': 'Created the web profile manifest',
    'log.provision.enabledPlugin': 'Enabled plugin {name} in the profile',
    'log.provision.installedPlugin': 'Installed bundled plugin {name} v{version}',
    'log.provision.upgradedPlugin': 'Upgraded bundled plugin {name}: v{from} → v{to}',
    'log.provision.refreshedPlugin': 'Refreshed plugin {name} (same version, changed content)',
  },
}

/**
 * 归一化语言 id：只接受受支持的语言，其余回落到默认语言。
 * @param {string} value
 * @returns {'zh'|'en'}
 */
function normalizeLanguage(value) {
  const id = String(value || '').toLowerCase().split('-')[0]
  return LANGUAGES.some((language) => language.id === id) ? id : DEFAULT_LANGUAGE
}

/** 语言条目（含 DSH 侧取值与 html lang）。 */
function languageEntry(id) {
  const normalized = normalizeLanguage(id)
  return LANGUAGES.find((language) => language.id === normalized)
}

/**
 * 取词并替换占位符。
 * @param {'zh'|'en'} language
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
function t(language, key, params) {
  const id = normalizeLanguage(language)
  const template = MESSAGES[id]?.[key] ?? MESSAGES[DEFAULT_LANGUAGE][key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
}

/** 某一语言的完整词典（渲染进程通过 IPC 取用）。 */
function messagesFor(language) {
  return { ...MESSAGES[DEFAULT_LANGUAGE], ...(MESSAGES[normalizeLanguage(language)] || {}) }
}

module.exports = { MESSAGES, LANGUAGES, DEFAULT_LANGUAGE, normalizeLanguage, languageEntry, t, messagesFor }
