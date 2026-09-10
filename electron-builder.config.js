'use strict'

// electron-builder 配置。
//
// 为什么用 JS 配置而不是 package.json 的 build 字段：
// electron-builder 的过滤器（app-builder-lib/out/util/filter.js）会**无条件排除**
// 相对路径等于或以 `/node_modules` 结尾的目录，导致 extraResources 里
// 整棵 node_modules 都不会被复制。
//
// 绕开方式：把 from 指向 node_modules **内部**，此时相对路径是各个包名，
// 不再是 node_modules 本身。因此这里在构建时枚举出所有 node_modules 目录，
// 为每一层各生成一条 extraResources 条目。

const fs = require('node:fs')
const path = require('node:path')

const ROOT = __dirname

/** 找出 root 下所有名为 node_modules 的目录（含嵌套的，每层各自成条目）。 */
function findNodeModulesDirs(root) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      if (entry.name === 'node_modules') found.push(full)
      // 继续深入：node_modules 内部还可能有嵌套的 node_modules
      walk(full)
    }
  }
  walk(root)
  return found
}

/** 为一个物料目录生成 extraResources 条目（含其内部各层 node_modules）。 */
function resourceEntries(sourceDir, targetName) {
  if (!fs.existsSync(sourceDir)) return []
  const entries = [
    // 普通文件与不含 node_modules 的部分
    { from: sourceDir, to: targetName, filter: ['**/*'] },
  ]
  for (const dir of findNodeModulesDirs(sourceDir)) {
    entries.push({
      from: dir,
      to: path.join(targetName, path.relative(sourceDir, dir)),
      filter: ['**/*'],
    })
  }
  return entries
}

const VENDOR_DSH = path.join(ROOT, 'vendor', 'dsh')
const VENDOR_PLUGINS = path.join(ROOT, 'vendor', 'plugins')

const extraResources = [
  ...resourceEntries(VENDOR_DSH, 'dsh'),
  ...resourceEntries(VENDOR_PLUGINS, 'plugins'),
]

console.log(`[electron-builder] extraResources 条目数：${extraResources.length}`)
for (const entry of extraResources) {
  console.log(`  · ${path.relative(ROOT, entry.from)} → resources/${entry.to}`)
}

module.exports = {
  appId: 'com.dsh.desktopclient',
  productName: 'DSH Desktop Client',
  directories: {
    output: 'dist',
    buildResources: 'assets',
  },
  files: [
    'main.js',
    'preload.js',
    'lib/**/*',
    'renderer/**/*',
    'package.json',
  ],
  extraResources,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
    artifactName: 'DSHSD-Setup-${version}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'DSHSD',
    uninstallDisplayName: 'DSHSD',
    deleteAppDataOnUninstall: false,
    // 构建期把这两个名字回显到日志，便于核对（NSIS 头部是压缩的，二进制里搜不到）
    include: 'nsis/verify-defines.nsh',
  },
}
