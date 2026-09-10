'use strict'

// 构建前的物料准备：把 DSH 本体与随包插件放到 vendor/ 下，
// 供 electron-builder 通过 extraResources 打进安装包。
//   node tools/stage-vendor.js
//
// 可通过环境变量覆盖：
//   DSH_VERSION   要打包的 @deepseek-ai/dsh 版本（默认 0.1.5-rc.1）
//   WHALE_SOURCE  鲸鱼插件的本地来源目录（默认先找本地副本，找不到就从 GitHub 拉取）

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const VENDOR_DSH = path.join(ROOT, 'vendor', 'dsh')
const VENDOR_PLUGINS = path.join(ROOT, 'vendor', 'plugins')
const DSH_VERSION = process.env.DSH_VERSION || '0.1.5-rc.1'
const WHALE_NAME = 'dsh-whale-widget'
/** 鲸鱼挂件的上游仓库（MIT 协议，允许再分发；构建时获取而非提交源码）。 */
const WHALE_REPO = process.env.WHALE_REPO || 'https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget'

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
  execFileSync(
    'npm',
    ['install', '--prefix', VENDOR_DSH, `@deepseek-ai/dsh@${DSH_VERSION}`, '--ignore-scripts', '--no-audit', '--no-fund'],
    { stdio: 'inherit', shell: true },
  )
}

function ensureWhale() {
  const target = path.join(VENDOR_PLUGINS, WHALE_NAME)
  if (fs.existsSync(path.join(target, 'package.json'))) {
    const version = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version
    log(`随包插件已就绪：${WHALE_NAME} v${version}`)
    return
  }

  const candidates = [
    process.env.WHALE_SOURCE,
    path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'web', 'node_modules', WHALE_NAME),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', WHALE_NAME),
  ].filter(Boolean)

  let source = candidates.find((dir) => fs.existsSync(path.join(dir, 'package.json')))

  if (!source) {
    // 本地没有副本（例如刚克隆仓库的新机器）就从句柄仓库拉取。
    // 该插件是 MIT 协议，允许再分发；这里选择在构建时获取而不是把源码提交进仓库。
    log(`本地无副本，从 GitHub 拉取 ${WHALE_REPO}`)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-whale-'))
    try {
      execFileSync('git', ['clone', '--depth', '1', WHALE_REPO, tmp], { stdio: 'inherit', shell: false })
      source = tmp
    } catch (error) {
      fs.rmSync(tmp, { recursive: true, force: true })
      throw new Error(
        `无法从 ${WHALE_REPO} 拉取插件（${error.message}）。` +
        `可改用 WHALE_SOURCE 指定本地源码目录，或直接放到 vendor/plugins/${WHALE_NAME}`,
      )
    }
    fs.mkdirSync(VENDOR_PLUGINS, { recursive: true })
    fs.cpSync(source, target, { recursive: true })
    fs.rmSync(tmp, { recursive: true, force: true })
    const pulled = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version
    log(`已从句柄仓库获取插件 ${WHALE_NAME} v${pulled}`)
    return
  }

  fs.mkdirSync(VENDOR_PLUGINS, { recursive: true })
  fs.cpSync(source, target, { recursive: true })
  const version = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version
  log(`已复制插件 ${WHALE_NAME} v${version}（来源：${source}）`)
}

try {
  ensureDsh()
  ensureWhale()
  log('物料准备完成')
} catch (error) {
  console.error(`[stage] 失败：${error.message}`)
  process.exit(1)
}
