'use strict'

// 检查「仓库源码 / vendor 副本 / profile 实装」三份是否一致，以及进程是不是
// 在改动之后启动的。
//
//   node tools/check-sync.js
//
// 为什么需要这个：改完插件代码却「界面上没变化」时，最可能的原因不是逻辑错，
// 而是**你改的那份没被加载**。这个项目里同时存在三份插件：
//   plugins/        ← 源码（改的是这里）
//   vendor/plugins/ ← npm run stage 的副本（曾经是客户端实际读取的位置）
//   profile/        ← DSH 启动时加载的那份
// 排查时先跑这个，能省掉大量「以为代码没生效」的弯路。

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
/**
 * 要比对的文件：**不能只比 lib/index.js**。
 * dsh-theme-pack 的核心逻辑在 lib/applier.browser.js（注入到页面的那段脚本），
 * 主题「切不回原生」的修复就改在那里；只比 index.js 会漏报不一致。
 */
const FILES = [path.join('lib', 'index.js'), path.join('lib', 'applier.browser.js')]
const PLUGINS = ['dsh-desktop-pet', 'dsh-quick-ask', 'dsh-theme-pack']
const PROFILE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'web')

const hashFile = (file) => {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12) }
  catch { return null }
}
const mtime = (file) => {
  try { return fs.statSync(file).mtime.toISOString().slice(11, 19) }
  catch { return null }
}

/** 把一个插件目录下所有关心的文件合起来算一个总指纹（缺失的文件记作 '-'）。 */
function treeHash(root) {
  const parts = FILES.map((rel) => `${rel}:${hashFile(path.join(root, rel)) || '-'}`)
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 12)
}
function treeMtime(root) {
  const times = FILES.map((rel) => fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.mtimeMs || 0)
  const newest = Math.max(...times)
  return newest ? new Date(newest).toISOString().slice(11, 19) : null
}

console.log(`\n插件三份一致性检查\n${'─'.repeat(62)}`)

let problems = 0
for (const name of PLUGINS) {
  const repoDir = path.join(ROOT, 'plugins', name)
  const vendorDir = path.join(ROOT, 'vendor', 'plugins', name)
  const profileDir = path.join(PROFILE, 'node_modules', name)

  const h = { repo: treeHash(repoDir), vendor: treeHash(vendorDir), profile: treeHash(profileDir) }
  const t = { repo: treeMtime(repoDir), vendor: treeMtime(vendorDir), profile: treeMtime(profileDir) }
  const same = h.repo && h.repo === h.vendor && h.repo === h.profile

  const flag = same ? '✅' : '❌'
  console.log(`\n${flag} ${name}`)
  console.log(`   仓库   ${h.repo || '(无)'}  ${t.repo || ''}`)
  console.log(`   vendor ${h.vendor || '(无)'}  ${t.vendor || ''}`)
  console.log(`   profile${h.profile || '(无)'}  ${t.profile || ''}`)

  if (!same) {
    problems += 1
    if (h.repo !== h.profile) console.log('   → 修：node .verify/push-plugin.js（或重启客户端）')
    if (h.repo !== h.vendor) console.log('   → 修：npm run stage')
  }
}

// 进程启动时间：DSH 是启动时把插件读进内存的，改完必须重启才生效
console.log(`\n${'─'.repeat(62)}`)
console.log('提示：插件在 DSH **启动时**载入内存，改完必须重启服务才生效。')
console.log('      客户端设置 → 日志里能看到「已随包安装/刷新插件」的行。')
console.log(problems === 0 ? '\n三份一致 ✅' : `\n${problems} 个插件不一致 ❌\n`)

process.exit(problems === 0 ? 0 : 1)
