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
      // 逐字段规范化：老配置可能没有 quickAsk、只有其中一个字段，或者字段值非法。
      //
      // 只纠正**非法值**，不覆盖用户的合法选择——用户显式选了 'active' 就该是 'active'。
      // 之前写成「不是 dedicated 就回落到默认」，那会把显式的 active 也一起吃掉。
      const quick = parsed.quickAsk && typeof parsed.quickAsk === 'object' ? parsed.quickAsk : {}
      merged.quickAsk = {
        session: quick.session === 'active' || quick.session === 'dedicated'
          ? quick.session
          : base.quickAsk.session,
        summary: quick.summary === 'model' || quick.summary === 'truncate'
          ? quick.summary
          : base.quickAsk.summary,
      }
      return merged
    } catch {
      return base
    }
  }

  /**
   * 把规范化后的结果写回文件（仅在真的有变化时）。
   *
   * 为什么需要：_load() 的规范化只作用于内存，文件里可能一直留着旧值——
   * 表现就是「设置界面显示的和实际行为不一致」，而且下次启动还得再规范化一遍。
   *
   * 比对方式是把磁盘上那份**重新解析**后与内存值做 JSON 比较，
   * 这样能忽略缩进/换行这类格式差异，只在语义真的不同时才写。
   *
   * @returns {{changed:boolean, reason?:'missing'|'normalized'}}
   */
  normalize() {
    let disk
    try {
      disk = fs.readFileSync(this.file, 'utf8')
    } catch {
      // 文件不存在：直接落一份规范化的
      return { changed: this.save(), reason: 'missing' }
    }
    let parsedDisk
    try {
      parsedDisk = JSON.parse(disk)
    } catch {
      parsedDisk = null
    }
    if (parsedDisk !== null && JSON.stringify(parsedDisk) === JSON.stringify(this.data)) {
      return { changed: false }
    }
    return { changed: this.save(), reason: 'normalized' }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
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
