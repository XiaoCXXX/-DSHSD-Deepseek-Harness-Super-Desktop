'use strict'

// 首次运行时的环境准备：确保 DSH web profile 存在，并已启用随包附带的插件。
//
// 这里刻意不依赖 pnpm —— 插件包已经随安装包分发在 DSH 的 node_modules 里
// （resolveBundleDir 的安装锚点优先，能找到它），
// 因此只需要把插件名写进 profile 清单的 dsh.profile.bundles 即可生效。

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

// 与 dsh-app-boot 的 initProfile 模板保持一致
const PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

const PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** 读纯文本（读 .dsh-content-hash 这种非 JSON 的小文件）。 */
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return undefined
  }
}

/**
 * 比较版本号（形如 1.2.3 / 0.2.10-rc.1）。
 * @returns {number} a > b 返回 1，a < b 返回 -1，相等返回 0
 */
function compareVersions(a, b) {
  const parts = (value) => String(value || '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] || 0) - (y[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/**
 * 算一个目录的内容指纹（所有文件的相对路径 + **内容哈希**）。
 *
 * 用途：判断「随包插件」与「profile 里那份」是不是同一份内容。
 * 只用版本号不够——开发时改了插件代码但忘了升 version，就会永远不更新。
 *
 * 为什么不能把 mtime 算进去：`fs.cpSync` 写出来的是新文件，mtime 是**复制那一刻**，
 * 和源文件的 mtime 永远不同 → 每次都判定「内容变了」→ 每次都重装（试过，确实这样）。
 * 所以只按内容算。插件目录不大（几十 KB ~ 1 MB），代价可接受；
 * 太大就退化成「路径+大小」，至少能抓住绝大多数改动。
 *
 * @param {string} dir
 * @returns {string|null}
 */
function directoryHash(dir) {
  try {
    const parts = []
    let totalBytes = 0
    const MAX_HASH_BYTES = 8 * 1024 * 1024
    const walk = (current, prefix) => {
      const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
      for (const entry of entries) {
        // 指纹文件自身不参与，否则永远算不一致
        if (entry.name === '.dsh-content-hash') continue
        const full = path.join(current, entry.name)
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) { walk(full, rel); continue }
        const stat = fs.statSync(full)
        totalBytes += stat.size
        if (totalBytes > MAX_HASH_BYTES) {
          // 太大：退化成「路径 + 大小」，不再读内容
          parts.push(`${rel}:${stat.size}`)
          continue
        }
        const digest = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
        parts.push(`${rel}:${digest}`)
      }
    }
    walk(dir, '')
    return crypto.createHash('sha256').update(parts.join('\n')).digest('hex')
  } catch {
    return null
  }
}

/**
 * 确保 profile 就绪。
 * @param {object} options
 * @param {string} options.dir - profile 目录
 * @param {string[]} options.plugins - 需要确保启用的插件包名
 * @param {(message:string)=>void} [options.log] - 日志回调
 * @returns {{dir:string,changed:boolean,bundles:string[],created:boolean}}
 */
function ensureProfile({ dir, plugins = [], log = () => {} }) {
  const created = !fs.existsSync(path.join(dir, 'package.json'))
  fs.mkdirSync(dir, { recursive: true })

  const manifestPath = path.join(dir, 'package.json')
  let manifest = readJson(manifestPath)
  if (!manifest || typeof manifest !== 'object') {
    manifest = {
      name: `dsh-profile-${path.basename(dir)}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...BASE_BUNDLES], patchReload: 'live' } },
    }
    log('log.provision.createdProfile')
  }

  // 这两个文件与 dsh 自带模板一致；缺失时补齐，已存在则不动
  const patchPath = path.join(dir, 'cordis.patch.yml')
  if (!fs.existsSync(patchPath)) fs.writeFileSync(patchPath, PATCH_TEMPLATE, 'utf8')
  const workspacePath = path.join(dir, 'pnpm-workspace.yaml')
  if (!fs.existsSync(workspacePath)) fs.writeFileSync(workspacePath, PNPM_WORKSPACE, 'utf8')

  manifest.dependencies = manifest.dependencies && typeof manifest.dependencies === 'object'
    ? manifest.dependencies
    : {}
  manifest.dsh = manifest.dsh && typeof manifest.dsh === 'object' ? manifest.dsh : {}
  manifest.dsh.profile = manifest.dsh.profile && typeof manifest.dsh.profile === 'object'
    ? manifest.dsh.profile
    : {}
  if (manifest.dsh.profile.patchReload === undefined) manifest.dsh.profile.patchReload = 'live'

  const bundles = Array.isArray(manifest.dsh.profile.bundles) && manifest.dsh.profile.bundles.length > 0
    ? [...manifest.dsh.profile.bundles]
    : [...BASE_BUNDLES]

  let changed = created
  for (const entry of plugins) {
    const name = typeof entry === 'string' ? entry : entry.name
    const sourceDir = typeof entry === 'string' ? undefined : entry.sourceDir

    // 插件必须能从 profile 目录解析到：bundle 是以 ES module 从 profile 位置 import 的，
    // 只放进 DSH 安装锚点并不够，因此复制一份到 profile 的 node_modules。
    //
    // 覆盖策略：缺失时安装；已存在则**只在随包版本更新时**才覆盖。
    // 这样安装包升级能把新版插件带给老用户，又不会把用户手动装过的更新版本降级。
    if (sourceDir && fs.existsSync(sourceDir)) {
      const target = path.join(dir, 'node_modules', name)
      const sourcePkg = readJson(path.join(sourceDir, 'package.json'))
      const installedPkg = readJson(path.join(target, 'package.json'))
      const bundledVersion = sourcePkg?.version
      const installedVersion = installedPkg?.version
      const missing = installedVersion === undefined
      const isUpgrade = !missing && Boolean(bundledVersion) &&
        compareVersions(bundledVersion, installedVersion) > 0

      // 「同版本但内容不同」也要覆盖。
      //
      // 原来只比版本号：开发时改了插件代码却忘了升 version，客户端就永远不会
      // 把新代码复制进 profile——表现是「重启了也没变化」，排查时极易误判成
      // 「代码没生效」或「重启不彻底」。用一个内容指纹兜住这种情况。
      const bundledHash = directoryHash(sourceDir)
      // 指纹文件是**纯 hex 文本**，不能用 readJson 读（JSON.parse 会抛错并返回 undefined，
      // 结果每次都被判成「内容变了」→ 每次重装）。
      const installedHash = missing ? null : readText(path.join(target, '.dsh-content-hash'))
      const contentChanged = !missing && bundledHash !== null &&
        installedHash !== bundledHash

      if (missing || isUpgrade || contentChanged) {
        fs.rmSync(target, { recursive: true, force: true })
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.cpSync(sourceDir, target, { recursive: true })
        // 记下这次复制的内容指纹，下次用来判断是否需要再覆盖
        if (bundledHash) {
          fs.writeFileSync(path.join(target, '.dsh-content-hash'), bundledHash, 'utf8')
        }
        changed = true
        if (missing) {
          log('log.provision.installedPlugin', { name, version: bundledVersion || '' })
        } else if (isUpgrade) {
          log('log.provision.upgradedPlugin', { name, from: installedVersion, to: bundledVersion })
        } else {
          log('log.provision.refreshedPlugin', { name, version: bundledVersion || '' })
        }
      }
    }

    if (!bundles.includes(name)) {
      bundles.push(name)
      changed = true
      log('log.provision.enabledPlugin', { name })
    }
  }

  manifest.dsh.profile.bundles = bundles
  if (changed) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return { dir, changed, bundles, created }
}

/**
 * 读取 profile 中已启用的插件（排除随 DSH 内置的 bundle）。
 * @returns {string[]}
 */
function enabledPlugins(dir) {
  const manifest = readJson(path.join(dir, 'package.json'))
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return []
  return bundles.filter((name) => !BASE_BUNDLES.includes(name))
}

module.exports = { ensureProfile, enabledPlugins, BASE_BUNDLES }
