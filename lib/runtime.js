'use strict'

// 运行时解析：优先使用随包分发的 DSH（无需系统 Node / npx），
// 找不到时回退到系统 node + 已安装的 dsh（开发期常见）。
//
// 打包形态下 DSH 由 Electron 自带的 Node 运行（ELECTRON_RUN_AS_NODE=1），
// 因此不再需要单独分发 node.exe。
//
// 注意 --expose-internals：DSH 的 HMR 服务需要 Node 内部模块。
// cordis-plugin-loader 有两条获取路径——带该标志时用 require()，
// 否则回落到原生插件 node-addon-require-builtin。后者是按系统 Node 的 ABI
// 编译的，在 Electron 下加载会失败，所以打包形态必须显式带上这个标志。

const fs = require('node:fs')
const path = require('node:path')

const DSH_ENTRY = path.join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

function isFile(target) {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

/** 随包分发的 DSH 根目录（其下含 node_modules）。 */
function bundledDshRoot() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'dsh') : undefined,
    path.join(path.dirname(process.execPath), 'resources', 'dsh'),
    path.join(__dirname, '..', 'vendor', 'dsh'), // 开发期
  ].filter(Boolean)

  for (const root of candidates) {
    if (isFile(path.join(root, DSH_ENTRY))) return root
  }
  return undefined
}

/**
 * 解析本次运行应使用的 node / dsh 组合。
 * 可用环境变量 DSH_CLIENT_RUNTIME=system|bundled 强制指定，便于对比排查。
 * @returns {{mode:string,nodeBin:string,nodeArgs:string[],dshBin:string,dshRoot?:string,env:Record<string,string>}}
 */
function resolveRuntime() {
  const forced = process.env.DSH_CLIENT_RUNTIME
  const bundled = forced === 'system' ? undefined : bundledDshRoot()

  if (bundled) {
    const isElectron = Boolean(process.versions.electron)
    return {
      mode: 'bundled',
      nodeBin: process.execPath, // 打包后即 electron.exe
      nodeArgs: ['--expose-internals'],
      dshBin: path.join(bundled, DSH_ENTRY),
      dshRoot: bundled,
      env: isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
    }
  }

  const { findNodeBin, findDshBin } = require('./dsh-locator')
  const nodeBin = findNodeBin()
  const dshBin = findDshBin()
  return {
    mode: 'system',
    nodeBin,
    nodeArgs: [],
    dshBin,
    env: {},
  }
}

/**
 * 随包分发的插件目录（其下直接是插件包本体）。
 *
 * 开发期的选择有讲究：仓库的 `plugins/` 是源码，`vendor/plugins/` 是
 * `npm run stage` 生成的副本。曾经踩过的坑：开发时改了 plugins/ 的源码、
 * 忘了跑 stage，客户端启动却从 vendor/ 复制到 profile —— 于是「改了代码、
 * 也重启了，界面上就是没变化」，而且三份文件长得一模一样，极难发现。
 *
 * 策略：
 *   - 打包后（resourcesPath 存在）→ 用安装目录里的随包资源
 *   - 开发期 → **两个都看，取内容更新的那份**（而不是固定优先级）。
 *     这样忘了跑 stage 也不会用上过期副本；只跑了 stage 的场景也照常工作。
 *
 * @param {string} name
 * @returns {string|undefined}
 */
function bundledPluginDir(name) {
  const packaged = [
    process.resourcesPath ? path.join(process.resourcesPath, 'plugins', name) : undefined,
    path.join(path.dirname(process.execPath), 'resources', 'plugins', name),
  ].filter(Boolean).find((candidate) => isDir(candidate) && isFile(path.join(candidate, 'package.json')))
  if (packaged) return packaged

  const devCandidates = [
    path.join(__dirname, '..', 'plugins', name),
    path.join(__dirname, '..', 'vendor', 'plugins', name),
  ].filter((candidate) => isDir(candidate) && isFile(path.join(candidate, 'package.json')))

  if (devCandidates.length <= 1) return devCandidates[0]

  // 多个候选：取「最近被改过」的那份。用一个稳定排序避免每次结果不同。
  return devCandidates
    .map((dir) => ({ dir, mtime: latestMtime(dir) }))
    .sort((a, b) => (b.mtime - a.mtime) || (a.dir < b.dir ? -1 : 1))[0]
    .dir
}

/** 目录下最新的文件修改时间（用于判断哪份副本更新）。 */
function latestMtime(dir) {
  let newest = 0
  const walk = (current) => {
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      try {
        const mtime = fs.statSync(full).mtimeMs
        if (mtime > newest) newest = mtime
      } catch { /* 读不到就跳过 */ }
    }
  }
  walk(dir)
  return newest
}

/** DSH profile 目录。 */
function profileDir(home) {
  return path.join(home, 'profiles', 'web')
}

/**
 * 解析一个包（例如 bundle 插件）的目录，顺序与 dsh-app-boot 的
 * resolveBundleDir 一致：dsh 安装位置优先，其次 profile 目录。
 * @returns {string|undefined}
 */
function resolvePackageDir(packageName, { dshRoot, profile } = {}) {
  const anchors = []
  if (dshRoot) anchors.push(path.join(dshRoot, 'node_modules'))
  if (profile) anchors.push(path.join(profile, 'node_modules'))
  for (const anchor of anchors) {
    const candidate = path.join(anchor, packageName)
    if (isFile(path.join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/** 读取包版本，失败返回 null。 */
function packageVersion(dir) {
  if (!dir) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null
  } catch {
    return null
  }
}

module.exports = {
  resolveRuntime,
  bundledDshRoot,
  bundledPluginDir,
  resolvePackageDir,
  packageVersion,
  profileDir,
  isFile,
  isDir,
}
