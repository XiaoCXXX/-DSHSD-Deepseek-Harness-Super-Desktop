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
    // 手动选定的形态（'bar' | 'console' | '' = 尚未选择，按服务状态推导）
    surface: '',
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

  patch(next) {
    Object.assign(this.data, next)
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
