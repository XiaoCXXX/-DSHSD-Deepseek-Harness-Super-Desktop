'use strict'

// 构建前的物料准备：把 DSH 本体与随包插件放到 vendor/ 下，
// 供 electron-builder 通过 extraResources 打进安装包。
//   node tools/stage-vendor.js
//
// 随包插件全部来自仓库的 plugins/ 目录（本仓库自己的代码），
// 不再从 GitHub 拉取任何第三方插件。
//
// 可通过环境变量覆盖：
//   DSH_VERSION   要打包的 @deepseek-ai/dsh 版本（默认 0.2.0-rc.2）
//
// 注意：上游目前**从未发布过正式版**（没有无后缀的 X.Y.Z），npm 的 latest
// 标签本身就是一个 rc，所以这里钉的就是 latest 指向的那个版本。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { patchDshRoot } = require('./patch-vendor-console')

const ROOT = path.resolve(__dirname, '..')
const VENDOR_DSH = path.join(ROOT, 'vendor', 'dsh')
const VENDOR_PLUGINS = path.join(ROOT, 'vendor', 'plugins')
const DSH_VERSION = process.env.DSH_VERSION || '0.2.0-rc.2'
/**
 * 已被取代的插件名：它们的源码已经不在仓库里，但老版本构建可能把它们留在 vendor/。
 * 留着会被打进安装包并重新启用，用户机器上就会出现两个挂件。
 */
const LEGACY_PLUGIN_NAMES = ['dsh-whale-widget']

const log = (message) => console.log(`[stage] ${message}`)

/**
 * 用「先改名、再删除」替换 vendor/dsh。
 *
 * 为什么不是直接 `rmSync(vendor/dsh)`：客户端跑起来后会锁住这个目录里的文件，
 * 直接递归删除会在删到一半时抛 EPERM —— 结果留下**一棵半删的树**，
 * 既不能启动也没法当作参照，比不升级糟糕得多（这个坑已经踩过一次）。
 *
 * 改名是原子的：客户端即使在运行，改名通常也能成功，而且无论后续删除成不成功，
 * 都不会留下半删的活树。删不掉就留着，下次构建再清。
 */
function replaceDshTree() {
  const outgoing = `${VENDOR_DSH}.outgoing`
  fs.rmSync(outgoing, { recursive: true, force: true })
  try {
    fs.renameSync(VENDOR_DSH, outgoing)
  } catch (error) {
    throw new Error(
      `无法替换 vendor/dsh（${error.code || error.message}）。\n`
      + '  最常见的原因是客户端正在运行、锁着这个目录。\n'
      + '  请先从托盘退出客户端（右键托盘图标 → 退出客户端），再重新运行 npm run stage。',
    )
  }
  try {
    fs.rmSync(outgoing, { recursive: true, force: true })
  } catch {
    log('旧内核暂时删不掉（客户端可能仍在运行），已改名为 vendor/dsh.outgoing，下次构建会自动清理')
  }
}

/** 读 vendor 里实际装着的 @deepseek-ai/dsh 版本；没装或读不出来返回 undefined。 */
function installedDshVersion() {
  try {
    const manifest = path.join(VENDOR_DSH, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).version
  } catch {
    return undefined
  }
}

function ensureDsh() {
  const entry = path.join(VENDOR_DSH, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const installed = installedDshVersion()

  // 版本一致才算「已就绪」。
  // 以前这里只判断 bin.js 存不存在，于是 DSH_VERSION 一旦装过就再也改不动了——
  // 改版本号跑 stage 会直接跳过，静默打出一个旧内核的安装包。
  if (installed !== undefined && installed === DSH_VERSION && fs.existsSync(entry)) {
    log(`随包 DSH 已就绪：@deepseek-ai/dsh@${installed}`)
    return
  }

  // 目录存在但版本读不出来 = 半删或损坏的树，也必须整份换掉，
  // 否则 npm 只会往上补文件，旧版本的残骸会一直留在里面。
  if (fs.existsSync(VENDOR_DSH)) {
    // 必须整份换掉：直接覆盖安装的话，旧版本特有的子包会留在
    // vendor/dsh/node_modules 里，新旧混装比不升级更难查。
    log(installed === undefined
      ? 'vendor/dsh 存在但读不出内核版本（半删或损坏），替换它'
      : `随包 DSH 版本不符（现有 ${installed} → 目标 ${DSH_VERSION}），替换 vendor/dsh`)
    replaceDshTree()
  } else {
    log(`安装 @deepseek-ai/dsh@${DSH_VERSION} → vendor/dsh（首次较慢）`)
  }

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

  const after = installedDshVersion()
  if (after !== DSH_VERSION) {
    throw new Error(`安装后版本仍为 ${after ?? '(读不到)'}，期望 ${DSH_VERSION}`)
  }
  log(`已安装 @deepseek-ai/dsh@${after}`)
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
