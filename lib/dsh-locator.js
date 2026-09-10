'use strict'

// 定位运行 DSH 所需的 node 可执行文件与 dsh 的 bin.js。
// 注意：Electron 的 process.execPath 是 electron.exe 而不是 node，
// 因此必须显式找到系统 node。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function exists(file) {
  try {
    return !!file && fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/** 在 PATH 中查找可执行文件。 */
function which(command) {
  try {
    const out = execFileSync('where', [command], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const line of out.split(/\r?\n/)) {
      const candidate = line.trim()
      if (candidate && exists(candidate)) return candidate
    }
  } catch {
    /* 未找到 */
  }
  return undefined
}

function findNodeBin(override) {
  if (exists(override)) return override

  const candidates = [
    which('node'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
    path.join(process.env.APPDATA || '', 'nvm', 'current', 'node.exe'),
  ]
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  // nvm-windows: %APPDATA%\nvm\vX.Y.Z\node.exe —— 取版本号最大的一个
  try {
    const nvmRoot = path.join(process.env.APPDATA || '', 'nvm')
    const versions = fs
      .readdirSync(nvmRoot)
      .filter((name) => /^v\d/.test(name))
      .map((name) => ({ name, file: path.join(nvmRoot, name, 'node.exe') }))
      .filter((entry) => exists(entry.file))
      .sort((a, b) => mtime(b.file) - mtime(a.file))
    if (versions.length > 0) return versions[0].file
  } catch {
    /* ignore */
  }
  return undefined
}

/** 收集所有可能的 dsh bin.js，优先返回最近使用过的那个。 */
function findDshBin(override) {
  if (exists(override)) return override

  const candidates = []

  // 1) npx 缓存：%LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules\@deepseek-ai\dsh\lib\bin.js
  const npxRoots = [
    path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx'),
    path.join(process.env.APPDATA || '', 'npm-cache', '_npx'),
  ]
  for (const root of npxRoots) {
    try {
      for (const entry of fs.readdirSync(root)) {
        const file = path.join(root, entry, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        if (exists(file)) candidates.push(file)
      }
    } catch {
      /* ignore */
    }
  }

  // 2) 全局 npm 安装
  for (const root of [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node_modules'),
  ]) {
    const file = path.join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (exists(file)) candidates.push(file)
  }

  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => mtime(b) - mtime(a))
  return candidates[0]
}

/** 定位小鲸鱼挂件的资源目录（用于托盘与窗口图标）。 */
function findWhaleAssets() {
  const roots = []
  const dshBin = findDshBin()
  if (dshBin) {
    // <...>/node_modules/@deepseek-ai/dsh/lib/bin.js -> <...>/node_modules
    const modulesDir = path.resolve(path.dirname(dshBin), '..', '..', '..')
    roots.push(path.join(modulesDir, 'dsh-whale-widget', 'assets'))
  }
  const profileModules = path.join(
    process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    'profiles',
    'web',
    'node_modules',
    'dsh-whale-widget',
    'assets',
  )
  roots.push(profileModules)
  for (const root of roots) {
    if (exists(path.join(root, 'DSniang1.png'))) return root
  }
  return undefined
}

module.exports = { findNodeBin, findDshBin, findWhaleAssets, which, exists }
