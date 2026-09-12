'use strict'

// 构建前的物料准备：把 DSH 本体与随包插件放到 vendor/ 下，
// 供 electron-builder 通过 extraResources 打进安装包。
//   node tools/stage-vendor.js
//
// 随包插件全部来自仓库的 plugins/ 目录（本仓库自己的代码），
// 不再从 GitHub 拉取任何第三方插件。
//
// 可通过环境变量覆盖：
//   DSH_VERSION   要打包的 @deepseek-ai/dsh 版本（默认 0.1.5-rc.1）

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { patchDshRoot } = require('./patch-vendor-console')

const ROOT = path.resolve(__dirname, '..')
const VENDOR_DSH = path.join(ROOT, 'vendor', 'dsh')
const VENDOR_PLUGINS = path.join(ROOT, 'vendor', 'plugins')
const DSH_VERSION = process.env.DSH_VERSION || '0.1.5-rc.1'
/**
 * 已被取代的插件名：它们的源码已经不在仓库里，但老版本构建可能把它们留在 vendor/。
 * 留着会被打进安装包并重新启用，用户机器上就会出现两个挂件。
 */
const LEGACY_PLUGIN_NAMES = ['dsh-whale-widget']

const log = (message) => console.log(`[stage] ${message}`)

function ensureDsh() {
  const entry = path.join(VENDOR_DSH, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (fs.existsSync(entry)) {
    log(`随包 DSH 已就绪：${path.relative(ROOT, entry)}`)
    return
  }
  log(`安装 @deepseek-ai/dsh@${DSH_VERSION} → vendor/dsh（首次较慢）`)
  fs.mkdirSync(VENDOR_DSH, { recursive: true })
  fs.writeFileSync(
    path.join(VENDOR_DSH, 'package.json'),
    JSON.stringify({ name: 'dsh-bundled-runtime', version: '1.0.0', private: true }, null, 2),
  )
  const args = ['install', '--prefix', VENDOR_DSH, `@deepseek-ai/dsh@${DSH_VERSION}`, '--ignore-scripts', '--no-audit', '--no-fund']
  // 优先直接用 node 跑 npm-cli.js：走 `npm` 会经由 npm.cmd → cmd.exe，
  // 在没有控制台的宿主里每个 cmd.exe 都会新建一个可见的控制台窗口。
  const npmCli = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => fs.existsSync(candidate))
  if (npmCli) execFileSync(process.execPath, [npmCli, ...args], { stdio: 'inherit' })
  else execFileSync('npm', args, { stdio: 'inherit', shell: true })
}

/**
 * 删掉 vendor/plugins 下已被取代的插件。
 *
 * 原来这里有一整段 `ensureWhale()`：找不到 `vendor/plugins/dsh-whale-widget` 就
 * **从 GitHub 把它拉回来**。小鲸鱼改名成 dsh-desktop-pet 之后，那段逻辑变成了
 * 纯粹的危害——每次构建都会把已被取代的插件重新下载进 vendor，进而打进安装包，
 * 用户机器上就会出现两个挂件。所以整段删除，换成这条防御性清理：
 * vendor 里如果还留着旧目录（例如从老版本切过来），就地删掉。
 */
function removeLegacyVendored() {
  for (const name of LEGACY_PLUGIN_NAMES) {
    const target = path.join(VENDOR_PLUGINS, name)
    if (!fs.existsSync(target)) continue
    fs.rmSync(target, { recursive: true, force: true })
    log(`已移除被取代的随包插件：${name}`)
  }
}

/**
 * 随仓库自带的插件（不是第三方，源码就在 plugins/ 下）。
 * 这类插件每次构建都整份覆盖——它是我们自己的代码，不存在「用户装过更新版」的问题。
 */
function ensureOwnPlugins() {
  const sourceRoot = path.join(ROOT, 'plugins')
  if (!fs.existsSync(sourceRoot)) return
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const from = path.join(sourceRoot, entry.name)
    const to = path.join(VENDOR_PLUGINS, entry.name)
    fs.mkdirSync(VENDOR_PLUGINS, { recursive: true })
    fs.rmSync(to, { recursive: true, force: true })
    fs.cpSync(from, to, { recursive: true })
    const version = JSON.parse(fs.readFileSync(path.join(to, 'package.json'), 'utf8')).version
    log(`已复制自带插件 ${entry.name} v${version}`)
  }
}

try {
  ensureDsh()
  // 桌面客户端的 DSH 跑在 Electron（无控制台的 GUI 进程）里，不补这个标志的话
  // 每条 shell 命令都会弹出一个可见的控制台窗口。
  patchDshRoot(VENDOR_DSH, log)
  removeLegacyVendored()
  ensureOwnPlugins()
  log('物料准备完成')
} catch (error) {
  console.error(`[stage] 失败：${error.message}`)
  process.exit(1)
}
