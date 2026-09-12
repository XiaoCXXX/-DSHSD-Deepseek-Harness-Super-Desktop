'use strict'

// 悬浮选项栏 / 占位页与主进程之间的安全桥（contextIsolation 打开，无 nodeIntegration）。

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshClient', {
  getState: () => ipcRenderer.invoke('state:get'),
  i18nMessages: () => ipcRenderer.invoke('i18n:messages'),

  quit: () => ipcRenderer.invoke('app:quit'),
  hideWindow: () => ipcRenderer.invoke('app:hideWindow'),
  /** 悬浮窗的 ✕：收悬浮窗、回主界面（不等于隐藏主窗口）。 */
  closeBubble: () => ipcRenderer.invoke('bubble:close'),

  start: () => ipcRenderer.invoke('server:start'),
  stop: () => ipcRenderer.invoke('server:stop'),
  restart: () => ipcRenderer.invoke('server:restart'),
  openInBrowser: () => ipcRenderer.invoke('server:openBrowser'),

  patchConfig: (patch) => ipcRenderer.invoke('config:patch', patch),
  setActiveProject: (id) => ipcRenderer.invoke('project:setActive', id),
  setSurface: (value) => ipcRenderer.invoke('surface:set', value),
  upsertProject: (project) => ipcRenderer.invoke('project:upsert', project),
  removeProject: (id) => ipcRenderer.invoke('project:remove', id),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),

  logsTail: () => ipcRenderer.invoke('logs:tail'),
  logsClear: () => ipcRenderer.invoke('logs:clear'),
  logsOpenFile: () => ipcRenderer.invoke('logs:openFile'),

  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginRun: (payload) => ipcRenderer.invoke('plugin:run', payload),

  refreshBalance: () => ipcRenderer.invoke('balance:refresh'),

  /** 便携悬浮窗：快速提问。返回 { requestId }，回答通过 onQuickEvent 流式回来。 */
  quickAsk: (payload) => ipcRenderer.invoke('quick:ask', payload),
  quickCancel: () => ipcRenderer.invoke('quick:cancel'),
  quickHistory: () => ipcRenderer.invoke('quick:history'),
  quickOpenInDsh: (turnId) => ipcRenderer.invoke('quick:openInDsh', turnId),

  /** 上报悬浮栏自身的内容尺寸，主进程据此精确设置视图区域。 */
  overlayResize: (size) => ipcRenderer.invoke('overlay:resize', size),
  /** 悬浮栏拖动结束后记住位置；resetOverlayPos 放回右上角默认位。 */
  overlayMove: (pos) => ipcRenderer.invoke('overlay:move', pos),
  overlayResetPos: () => ipcRenderer.invoke('overlay:resetPos'),

  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state)),
  onLog: (callback) => ipcRenderer.on('log', (_event, line) => callback(line)),
  onBalance: (callback) => ipcRenderer.on('balance', (_event, value) => callback(value)),
  onOverlayCommand: (callback) => ipcRenderer.on('overlay:command', (_event, command) => callback(command)),
  onQuickEvent: (callback) => ipcRenderer.on('quick:event', (_event, event) => callback(event)),
})
