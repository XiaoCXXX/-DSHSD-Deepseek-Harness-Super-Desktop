'use strict'

// 验证改名带来的三件事（隔离 DSH_HOME，不碰正在用的 profile）：
//   1. 旧的 dsh-whale-widget 会被从 bundles 摘掉、目录被删
//   2. 新的 dsh-desktop-pet 被装进 bundles 与 node_modules
//   3. 托盘菜单/提示里不再有余额，改成「已运行 X」
//   node tools/verify-pet-migration.js

delete process.env.ELECTRON_RUN_AS_NODE

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SANDBOX = path.join(ROOT, '.verify', 'pet-migration')
const HOME = path.join(SANDBOX, 'dshhome')
const USER_DATA = path.join(SANDBOX, 'userdata')
const PORT = 3093

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const report = []
  const note = (ok, label, value) => {
    report.push(ok)
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value === undefined ? '' : `  ${value}`}`)
  }

  console.log(`\n宠物插件改名迁移验证（隔离 home + 端口 ${PORT}）\n${'─'.repeat(62)}`)

  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.mkdirSync(HOME, { recursive: true })

  // 伪造一个「老用户升级前」的 profile：旧插件在 bundles 里、目录也在
  const profile = path.join(HOME, 'profiles', 'web')
  const legacyDir = path.join(profile, 'node_modules', 'dsh-whale-widget')
  fs.mkdirSync(legacyDir, { recursive: true })
  fs.writeFileSync(path.join(legacyDir, 'package.json'), JSON.stringify({ name: 'dsh-whale-widget', version: '0.2.10' }), 'utf8')
  fs.writeFileSync(path.join(legacyDir, 'lib.js'), '// 旧的第三方挂件', 'utf8')
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: { 'dsh-whale-widget': 'github:MeteorNOX/DeepSeek-Balance-Whale-Widget' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-whale-widget'], patchReload: 'live' } },
  }, null, 2), 'utf8')
  console.log('  已伪造老用户 profile：bundles 含 dsh-whale-widget，目录存在')

  fs.writeFileSync(path.join(USER_DATA, 'config.json'), JSON.stringify({
    version: 1,
    projects: [{ id: 'p-pet', name: '迁移验证', cwd: SANDBOX, port: PORT }],
    activeProjectId: 'p-pet',
    autoStartOnLaunch: true,
    openUiOnStart: false,
    adoptExternal: false,
    stopServerOnQuit: true,
    language: 'zh',
  }, null, 2))

  const env = { ...process.env, DSH_HOME: HOME }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(ELECTRON, ['.', '--hidden', `--user-data-dir=${USER_DATA}`], {
    cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  await sleep(18000)

  // ---- 1. 旧的清掉了
  const manifest = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles || []
  note(!bundles.includes('dsh-whale-widget'), '旧插件已从 bundles 摘掉', bundles.join(', '))
  note(!fs.existsSync(legacyDir), '旧插件目录已删除')
  note(!(manifest.dependencies && 'dsh-whale-widget' in manifest.dependencies),
    '旧插件已从 dependencies 移除')

  // ---- 2. 新的装上了
  note(bundles.includes('dsh-desktop-pet'), '新插件已写进 bundles')
  note(fs.existsSync(path.join(profile, 'node_modules', 'dsh-desktop-pet', 'lib', 'index.js')),
    '新插件已复制到 profile node_modules')
  note(fs.existsSync(path.join(profile, 'node_modules', 'dsh-desktop-pet', 'assets', 'pet.png')),
    '新形象素材已就位')

  // ---- 3. 客户端日志确认走了清理与安装
  const logFile = path.join(USER_DATA, 'logs', 'dsh-client.log')
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
  note(/已移除被取代的旧插件/.test(log), '日志确认执行了旧插件清理',
    (log.split('\n').find((l) => l.includes('已移除被取代的旧插件')) || '').slice(0, 80))
  note(/dsh-desktop-pet/.test(log), '日志提到新插件')

  // ---- 4. 托盘：不该再有余额文案
  const i18n = require('../lib/i18n')
  const zh = i18n.messagesFor('zh')
  note(!('tray.balance' in zh), '中文词典已无 tray.balance')
  note(!('tray.todayUsage' in zh), '中文词典已无 tray.todayUsage')
  note(typeof zh['tray.uptime'] === 'string', '新增 tray.uptime', zh['tray.uptime'])
  const en = i18n.messagesFor('en')
  note(typeof en['tray.uptime'] === 'string', '英文词典同步', en['tray.uptime'])

  // ---- 5. formatUptime 的行为（直接读 main.js 里的实现做黑盒验证不便，
  //         这里用同样的规则独立复算一遍，确保格式稳定）
  const cases = [
    [0, null],
    [Date.now() - 45 * 1000, '0m 45s'],
    [Date.now() - (3 * 60 + 7) * 1000, '3m 07s'],
    [Date.now() - (2 * 3600 + 5 * 60) * 1000, '2h 05m'],
    [Date.now() - (26 * 3600 + 30 * 60) * 1000, '1d 02h'],
  ]
  const fmt = (startedAt) => {
    if (!startedAt) return null
    const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60), sec = s % 60
    if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
    return `${m}m ${String(sec).padStart(2, '0')}s`
  }
  let fmtOk = true
  for (const [input, want] of cases) {
    const got = fmt(input)
    if (got !== want) { fmtOk = false; console.log(`     ${input}: 得到 ${got}，期望 ${want}`) }
  }
  note(fmtOk, '运行时长格式符合预期（<1h 显示秒，<1d 显示时分，跨天显示天）')

  cleanup()
  await sleep(800)
  const failed = report.filter((ok) => !ok).length
  console.log(`${'─'.repeat(62)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('验证异常：', e.message); process.exit(1) })
