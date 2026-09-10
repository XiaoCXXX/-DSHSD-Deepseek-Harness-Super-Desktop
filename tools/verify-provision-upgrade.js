'use strict'

// 验证 profile 预置的插件覆盖策略（升级行为的关键）：
//   1. 全新 profile      → 安装随包插件
//   2. 版本相同再跑一次  → 不重复安装（无谓写入）
//   3. 已装版本更旧      → 随包版本覆盖过去（安装包升级能带上新插件）
//   4. 已装版本更新      → 不降级（保留用户手动更新的成果）
//   node tools/verify-provision-upgrade.js

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..')
const SOURCE = path.join(ROOT, 'vendor', 'plugins', 'dsh-whale-widget')
const NAME = 'dsh-whale-widget'

const { ensureProfile } = require('../lib/provision')

const report = []
const note = (ok, label, value = '') => {
  report.push(ok)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${value ? `  ${value}` : ''}`)
}

const readVersion = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', NAME, 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

function writeVersion(dir, version) {
  const file = path.join(dir, 'node_modules', NAME, 'package.json')
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.version = version
  fs.writeFileSync(file, JSON.stringify(json, null, 2))
}

const bundledVersion = JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8')).version

console.log(`\n插件覆盖策略验证（随包版本 v${bundledVersion}）\n${'─'.repeat(60)}`)

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-provision-'))
const profileDir = path.join(workDir, 'profiles', 'web')
const logs = []
const run = () => ensureProfile({ dir: profileDir, plugins: [{ name: NAME, sourceDir: SOURCE }], log: (m) => logs.push(m) })

try {
  // 1. 全新 profile
  const first = run()
  note(first.created === true, '全新 profile 被创建')
  note(readVersion(profileDir) === bundledVersion, '插件已安装且版本正确', readVersion(profileDir))
  note(first.bundles.includes(NAME), '插件已写入 bundles', first.bundles.join(', '))
  note(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), 'cordis.patch.yml 已生成')
  note(fs.existsSync(path.join(profileDir, 'pnpm-workspace.yaml')), 'pnpm-workspace.yaml 已生成')

  // 2. 版本相同 → 不重复安装
  logs.length = 0
  const second = run()
  note(second.changed === false, '版本相同时不写入（幂等）')
  note(!logs.some((m) => m.includes('已随包')), '未重复安装插件', logs.join(' / ') || '(无日志)')

  // 3. 已装版本更旧 → 应升级
  writeVersion(profileDir, '0.0.1')
  logs.length = 0
  const third = run()
  note(readVersion(profileDir) === bundledVersion, '旧版本被随包版本覆盖', `0.0.1 → ${readVersion(profileDir)}`)
  note(third.changed === true, '标记为已变更')
  note(logs.some((m) => m.includes('已随包升级')), '日志说明了是升级', logs.find((m) => m.includes('已随包')) || '')

  // 4. 已装版本更新 → 不应降级
  writeVersion(profileDir, '99.0.0')
  logs.length = 0
  const fourth = run()
  note(readVersion(profileDir) === '99.0.0', '更新的已装版本未被降级', `仍为 ${readVersion(profileDir)}`)
  note(!logs.some((m) => m.includes('已随包')), '未做任何覆盖', logs.join(' / ') || '(无日志)')

  // 5. profile 清单在多次运行后仍然正确
  const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
  note(manifest.dsh.profile.bundles.filter((b) => b === NAME).length === 1, 'bundles 中没有重复项')
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}

const failed = report.filter((ok) => !ok).length
console.log(`${'─'.repeat(60)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
process.exit(failed === 0 ? 0 : 1)
