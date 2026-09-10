'use strict'

// 随包 DSH 以 Electron 内置 Node 运行，会把 ELECTRON_RUN_AS_NODE=1 传染给子进程。
// 不清掉的话，本脚本启动的打包 exe 会以纯 Node 模式运行（app 为 undefined）并崩溃。
delete process.env.ELECTRON_RUN_AS_NODE

// 安装前预检：用**打包后的程序** + **本机真实的 DSH_HOME** 跑一次，
// 但使用隔离的用户数据目录，避免与正在运行的开发版客户端抢单实例锁。
//
// 全程 --hidden，不显示任何窗口；只读地接管已运行的服务，不会启动或停止任何东西。
//   node tools/preflight-install.js

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const os = require('node:os')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const APP_EXE = path.join(ROOT, 'dist', 'win-unpacked', 'DSH Desktop Client.exe')
const USER_DATA = path.join(ROOT, '.verify', 'preflight-userdata')
const REAL_DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PORT = 3080

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function request(pathname, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'GET', timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 120) }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }) })
    req.on('error', () => resolve({ status: 0 }))
    req.end()
  })
}

async function main() {
  const report = []
  const note = (ok, label, value) => {
    report.push(ok)
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value ? `  ${value}` : ''}`)
  }

  console.log(`\n安装前预检（打包版 + 真实 profile，隔离 userData）\n${'─'.repeat(62)}`)
  console.log(`  DSH_HOME : ${REAL_DSH_HOME}`)
  console.log(`  userData : ${path.relative(ROOT, USER_DATA)}（隔离，不碰你正在跑的客户端）`)
  console.log(`  目标端口 : ${PORT}（接管，不启动新服务）`)

  if (!fs.existsSync(APP_EXE)) {
    console.error('找不到打包产物，请先 npm run build')
    process.exit(1)
  }

  // 预检前的基线
  const profileBefore = path.join(REAL_DSH_HOME, 'profiles', 'web', 'package.json')
  const beforeText = fs.existsSync(profileBefore) ? fs.readFileSync(profileBefore, 'utf8') : null
  const credBefore = fs.statSync(path.join(REAL_DSH_HOME, '.credentials.yaml')).mtimeMs

  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })

  console.log('  … 启动打包后的客户端（--hidden）')
  const child = spawn(APP_EXE, ['--hidden', `--user-data-dir=${USER_DATA}`], {
    env: { ...process.env, DSH_HOME: REAL_DSH_HOME },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  await sleep(12000)

  note(child.exitCode === null, '打包程序保持运行（未因单实例锁退出）',
    child.exitCode === null ? '' : `已退出 code=${child.exitCode}`)

  const logFile = path.join(USER_DATA, 'logs', 'dsh-client.log')
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
  note(/已接管/.test(log), '自动接管了正在运行的服务')
  // 「运行时：随包 DSH」只在**启动**服务时打印；接管路径不启动服务，
  // 因此这里只断言随包运行时已就位（启动路径由 tools/verify-build.js 覆盖）。
  const bundledBin = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'dsh',
    'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  note(fs.existsSync(bundledBin), '随包 DSH 运行时已就位')
  note(/加载界面|minted-cookie/.test(log), '成功认证并加载界面')

  const balance = await request('/dsh-whale/balance.json')
  note(balance.status === 200, '你本机的余额接口可用（真实凭据）', balance.body)

  // 确认没有副作用：profile 与凭据文件未被改动
  const afterText = fs.existsSync(profileBefore) ? fs.readFileSync(profileBefore, 'utf8') : null
  note(afterText === beforeText, 'profile 清单未被修改')
  note(fs.statSync(path.join(REAL_DSH_HOME, '.credentials.yaml')).mtimeMs === credBefore, '凭据文件未被改动')

  const still3080 = await request('/')
  note(still3080.status > 0, '原先的服务仍在运行（预检没有影响它）', `GET / -> ${still3080.status}`)

  if (log) {
    console.log('\n  --- 打包版本次日志 ---')
    for (const line of log.split('\n').filter(Boolean).slice(-8)) console.log(`  ${line}`)
  }

  cleanup()
  await sleep(600)

  const failed = report.filter((ok) => !ok).length
  console.log(`${'─'.repeat(62)}\n${failed === 0 ? '预检全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('预检异常：', error.message)
  process.exit(1)
})
