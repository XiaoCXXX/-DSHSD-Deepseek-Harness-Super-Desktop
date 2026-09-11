'use strict'

// 客户端配置持久化：多项目（端口 + 工作目录）、开机自启等。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

function defaults() {
  return {
    version: 1,
    projects: [
      {
        id: 'p-default',
        name: '默认项目',
        cwd: os.homedir(),
        port: 3080,
      },
    ],
    activeProjectId: 'p-default',
    openAtLogin: false,
    adoptExternal: true,
    openUiOnStart: true,
    autoStartOnLaunch: true,
    stopServerOnQuit: false,
    dshBinPath: '',
    nodeBinPath: '',
    theme: 'dsh-white-blue',
    // 空字符串表示「跟随系统语言」，由主进程按 app.getLocale() 解析
    language: '',
    // 是否随服务启停自动切换界面形态；关闭时由用户用按钮手动控制
    autoSurface: false,
    // 手动选定的形态（'bar' | 'console' | 'bubble' | '' = 尚未选择，按服务状态推导）
    // 'bubble'（便携悬浮窗）只能手动选：它和「有没有跑服务」无关，自动推导不出来
    surface: '',
    // 便携悬浮窗模式：快速提问落在哪个会话，以及简答怎么产生
    quickAsk: {
      // 'dedicated' 用专用会话（默认：悬浮窗的提问不混进正在聊的那段对话）；
      // 'active' 复用当前活跃会话，好处是完整回答天然就在 DSH 界面里
      session: 'dedicated',
      // 'model' 让模型把完整回答压成一句话；'truncate' 直接截断（模型失败时也会退到这条）
      summary: 'model',
    },
  }
}

class Config {
  constructor(dir) {
    this.file = path.join(dir, 'config.json')
    this.data = this._load()
  }

  _load() {
    const base = defaults()
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (!parsed || typeof parsed !== 'object') return base
      const merged = { ...base, ...parsed }
      if (!Array.isArray(merged.projects) || merged.projects.length === 0) {
        merged.projects = base.projects
      }
      merged.projects = merged.projects
        .filter((p) => p && typeof p === 'object')
        .map((p) => ({
          id: String(p.id || crypto.randomUUID()),
          name: String(p.name || '未命名项目'),
          cwd: String(p.cwd || os.homedir()),
          port: Number.isInteger(p.port) ? p.port : 3080,
        }))
      if (!merged.projects.some((p) => p.id === merged.activeProjectId)) {
        merged.activeProjectId = merged.projects[0].id
      }
      // 逐字段合并：老配置文件里没有 quickAsk，或只有其中一个字段
      const quick = parsed.quickAsk && typeof parsed.quickAsk === 'object' ? parsed.quickAsk : {}
      merged.quickAsk = {
        session: quick.session === 'dedicated' ? 'dedicated' : base.quickAsk.session,
        summary: quick.summary === 'truncate' ? 'truncate' : base.quickAsk.summary,
      }
      return merged
    } catch {
      return base
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
      return true
    } catch {
      return false
    }
  }

  all() {
    return this.data
  }

  /**
   * 打补丁。普通对象做一层浅合并——否则 `patch({ quickAsk: { session } })`
   * 会把 quickAsk 里的其它字段（summary）整块抹掉。
   * @param {Record<string, unknown>} next
   */
  patch(next) {
    for (const [key, value] of Object.entries(next || {})) {
      const existing = this.data[key]
      const mergeable = existing && value
        && typeof existing === 'object' && typeof value === 'object'
        && !Array.isArray(existing) && !Array.isArray(value)
      if (mergeable) Object.assign(existing, value)
      else this.data[key] = value
    }
    this.save()
    return this.data
  }

  activeProject() {
    const list = this.data.projects
    return list.find((p) => p.id === this.data.activeProjectId) || list[0] || null
  }

  setActive(id) {
    if (!this.data.projects.some((p) => p.id === id)) return this.activeProject()
    this.data.activeProjectId = id
    this.save()
    return this.activeProject()
  }

  upsertProject(project) {
    const list = this.data.projects
    const port = Number.isInteger(project.port) ? project.port : 3080
    const cwd = String(project.cwd || os.homedir())
    const name = String(project.name || '未命名项目')
    if (project.id) {
      const existing = list.find((p) => p.id === project.id)
      if (existing) {
        Object.assign(existing, { name, cwd, port })
        this.save()
        return existing
      }
    }
    const created = { id: crypto.randomUUID(), name, cwd, port }
    list.push(created)
    this.save()
    return created
  }

  removeProject(id) {
    const list = this.data.projects
    if (list.length <= 1) return false
    const at = list.findIndex((p) => p.id === id)
    if (at === -1) return false
    list.splice(at, 1)
    if (this.data.activeProjectId === id) this.data.activeProjectId = list[0].id
    this.save()
    return true
  }

  /** 端口是否已被其它项目占用（用于提示冲突）。 */
  portOwner(port, exceptId) {
    return this.data.projects.find((p) => p.port === port && p.id !== exceptId) || null
  }
}

module.exports = { Config, defaults }
