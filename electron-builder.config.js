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
  // *.orig 是 tools/patch-vendor-console.js 留下的补丁备份，不进安装包
  const filter = ['**/*', '!**/*.orig']
  const entries = [
    // 普通文件与不含 node_modules 的部分
    { from: sourceDir, to: targetName, filter },
  ]
  for (const dir of findNodeModulesDirs(sourceDir)) {
    entries.push({
      from: dir,
      to: path.join(targetName, path.relative(sourceDir, dir)),
      filter,
    })
  }
  return entries
}

const VENDOR_DSH = path.join(ROOT, 'vendor', 'dsh')
const VENDOR_PLUGINS = path.join(ROOT, 'vendor', 'plugins')

const extraResources = [
  ...resourceEntries(VENDOR_DSH, 'dsh'),
  ...resourceEntries(VENDOR_PLUGINS, 'plugins'),
  // 图标也要进 resources：主进程在运行时要读它来设置窗口/托盘图标
  // （打包后的 exe 内嵌图标由 build.win.icon 处理，但运行时 API 需要一个文件路径）。
  { from: path.join(ROOT, 'assets', 'icon.ico'), to: 'icon.ico' },
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
    // 装给「所有用户」，安装时会请求管理员权限（弹一次 UAC）。
    //
    // 为什么改：原来是 perMachine: false（按用户安装、免提权），但同时又允许
    // 用户自选安装目录 —— 于是有人选到 D:\Program Files\... 这种需要管理员
    // 才能写的目录，安装到一半报「不能打开要写入的文件: Uninstall ...exe」，
    // 只能中止。实测确认过（好友的截图）。
    // 改成 perMachine: true 后，安装器会主动提权，写 Program Files 是合法的；
    // 卸载项也从 HKCU 挪到 HKLM，管理器里能看到完整信息。
    perMachine: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'DSHSD',
    uninstallDisplayName: 'DSHSD',
    deleteAppDataOnUninstall: false,
    // 这个 include 干两件事：
    //   1. 构建期把 SHORTCUT_NAME / UNINSTALL_DISPLAY_NAME 回显到日志（便于核对）
    //   2. 定义 customCheckAppRunning，覆盖默认的「应用还在运行」检查
    //      —— 默认实现只 taskkill 同名进程，而我们一次拉起 9 个 Electron 进程，
    //         残留任一都会让安装器弹「无法关闭」并退出。
    include: 'nsis/verify-defines.nsh',
  },
}
