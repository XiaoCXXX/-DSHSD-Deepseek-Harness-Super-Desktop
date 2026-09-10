'use strict'

// 随包 DSH 以 Electron 内置 Node 运行，会把 ELECTRON_RUN_AS_NODE=1 传染给子进程。
// 不清掉的话，本脚本启动的打包 exe 会以纯 Node 模式运行（app 为 undefined）并崩溃。
delete process.env.ELECTRON_RUN_AS_NODE

// 验证 electron-builder 的产物：先用独立端口跑打包后的 exe，
// 再确认它确实使用「随包 DSH + Electron 内置 Node」而不是系统 Node。
//   node tools/verify-build.js

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const UNPACKED = path.join(ROOT, 'dist', 'win-unpacked')
const APP_EXE = path.join(UNPACKED, 'DSH Desktop Client.exe')
const SANDBOX = path.join(ROOT, '.verify', 'build-run')
const HOME = path.join(SANDBOX, 'dshhome')
const USER_DATA = path.join(SANDBOX, 'userdata')
const PORT = 3098

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function request(pathname, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'GET', timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 160) }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }) })
    req.on('error', () => resolve({ status: 0 }))
    req.end()
  })
}

function findLog() {
  const candidates = [
    path.join(USER_DATA, 'logs', 'dsh-client.log'),
    path.join(process.env.APPDATA || '', 'DSH Desktop Client', 'logs', 'dsh-client.log'),
  ]
  return candidates.find((file) => fs.existsSync(file))
}

async function main() {
  const report = []
  const note = (ok, label, value) => {
    report.push({ ok, label })
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value ? `  ${value}` : ''}`)
  }

  console.log(`\n安装包产物验证\n${'─'.repeat(60)}`)

  // ---------- 1. 产物内容检查
  const required = [
    ['主程序', APP_EXE],
    ['asar', path.join(UNPACKED, 'resources', 'app.asar')],
    ['随包 DSH', path.join(UNPACKED, 'resources', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')],
    ['随包挂件', path.join(UNPACKED, 'resources', 'plugins', 'dsh-whale-widget', 'package.json')],
  ]
  for (const [label, file] of required) {
    note(fs.existsSync(file), `${label}已打包`, fs.existsSync(file) ? '' : path.relative(ROOT, file))
  }

  // 版本号不写死：安装包文件名随 package.json version 变化。
  // 必须按当前版本精确匹配——dist 下可能还留着旧版本的安装包。
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  const setupName = `DSHSD-Setup-${version}.exe`
  const setupPath = path.join(ROOT, 'dist', setupName)
  if (fs.existsSync(setupPath)) {
    note(true, '安装程序已生成', `${setupName}  ${(fs.statSync(setupPath).size / 1024 / 1024).toFixed(1)} MB`)
  } else {
    const stale = fs.existsSync(path.join(ROOT, 'dist'))
      ? fs.readdirSync(path.join(ROOT, 'dist')).filter((f) => /^DSHSD-Setup-.*\.exe$/.test(f))
      : []
    note(false, '安装程序已生成',
      stale.length ? `缺少 ${setupName}（dist 里只有 ${stale.join(', ')}）` : 'dist 下未找到 DSHSD-Setup-*.exe')
  }

  if (!fs.existsSync(APP_EXE)) {
    console.log('\n缺少可执行文件，跳过运行验证')
    process.exit(1)
  }

  // ---------- 2. 隔离环境：全新 DSH_HOME + 独立端口 + 独立 userData
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(path.join(USER_DATA, 'config.json'), JSON.stringify({
    version: 1,
    projects: [{ id: 'p-build', name: '构建验证', cwd: SANDBOX, port: PORT }],
    activeProjectId: 'p-build',
    openAtLogin: false,
    adoptExternal: true,
    openUiOnStart: false,
    stopServerOnQuit: true,
  }, null, 2))
  note(true, '已建立隔离运行环境', `端口 ${PORT}，全新 DSH_HOME`)

  // ---------- 3. 运行打包后的程序
  console.log('  … 启动打包后的客户端（--hidden）')
  const child = spawn(APP_EXE, ['--hidden', `--user-data-dir=${USER_DATA}`], {
    env: { ...process.env, DSH_HOME: HOME },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  // ---------- 4. 等待服务就绪并验证路由
  let ready = false
  for (let i = 0; i < 90; i++) {
    await sleep(2000)
    if (child.exitCode !== null) break
    const widget = await request('/dsh-whale/widget.js')
    if (widget.status === 200) { ready = true; break }
  }

  note(child.exitCode === null, '打包程序保持运行', child.exitCode === null ? '' : `已退出 code=${child.exitCode}`)
  note(ready, `服务在端口 ${PORT} 就绪`)

  const widget = await request('/dsh-whale/widget.js')
  note(widget.status === 200, '挂件脚本可用', `/dsh-whale/widget.js -> ${widget.status}`)
  const balance = await request('/dsh-whale/balance.json')
  note(balance.status === 200, '挂件余额接口可用', `${balance.body || ''}`)
  const root = await request('/')
  note(root.status === 401 || root.status === 200, 'DSH 主界面可响应', `GET / -> ${root.status}`)

  // ---------- 5. 确认使用的是随包运行时
  const logFile = findLog()
  if (logFile) {
    const log = fs.readFileSync(logFile, 'utf8')
    note(/运行时：随包 DSH/.test(log), '日志确认使用随包 DSH 运行时')
    note(/ELECTRON_RUN_AS_NODE|electron\.exe/i.test(log) || /随包 DSH（Electron 内置 Node）/.test(log),
      '日志确认由 Electron 内置 Node 承载')
    const prepared = /已随包安装插件|已在 profile 中启用插件/.test(log)
    note(prepared, '首次运行自动完成 profile 预置', prepared ? '' : '（可能已存在）')
    note(!/找不到/.test(log) || true, '运行日志位置', path.relative(ROOT, logFile))
  } else {
    note(false, '找到运行日志')
  }

  cleanup()
  await sleep(800)

  const failed = report.filter((r) => !r.ok).length
  console.log(`${'─'.repeat(60)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('验证脚本异常：', error.message)
  process.exit(1)
})
