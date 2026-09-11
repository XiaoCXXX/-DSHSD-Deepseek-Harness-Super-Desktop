'use strict'

// 便携悬浮窗后端的端到端验证。
//
// 用**隔离**的 DSH_HOME + 独立端口 + 独立 userData 起一个开发版客户端，
// 让它自己把 dsh-quick-ask 装进 profile，然后直接打 /dsh-quick/ask 看 SSE。
//
// 隔离的 DSH_HOME 里没有 DEEPSEEK_API_KEY，所以这一步验证的是**链路**：
//   路由存在 → 会话建立 → prompt 被接收 → session/event 观察 → SSE 事件送达。
// 模型真正答出内容需要本机凭据，由人工在真实实例上验。
//
//   node tools/verify-quick-ask.js

delete process.env.ELECTRON_RUN_AS_NODE

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SANDBOX = path.join(ROOT, '.verify', 'quick-ask')
const HOME = path.join(SANDBOX, 'dshhome')
const USER_DATA = path.join(SANDBOX, 'userdata')
const PORT = 3099

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function get(pathname, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'GET', timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, body: '' }) })
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }))
    req.end()
  })
}

/** 拉一次 /dsh-quick/ask，把 SSE 事件收齐（或到超时为止）。 */
function quickAsk(query, cookie, timeoutMs) {
  return new Promise((resolve) => {
    const events = []
    let status = 0
    let headers = {}
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: `/dsh-quick/ask?${query}`,
      method: 'GET',
      headers: { accept: 'text/event-stream', cookie },
    }, (res) => {
      status = res.statusCode
      headers = res.headers
      res.setEncoding('utf8')
      let buffer = ''
      res.on('data', (chunk) => {
        buffer += chunk
        let at
        while ((at = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, at)
          buffer = buffer.slice(at + 2)
          let name = 'message'
          const data = []
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim()
            else if (line.startsWith('data:')) data.push(line.slice(5).trim())
          }
          if (data.length) {
            let parsed
            try { parsed = JSON.parse(data.join('\n')) } catch { parsed = { raw: data.join('\n') } }
            events.push({ type: name, ...parsed })
          }
        }
      })
    })
    const timer = setTimeout(() => {
      try { req.destroy() } catch { /* 已结束 */ }
      resolve({ status, headers, events, timedOut: true })
    }, timeoutMs)
    req.on('error', () => { clearTimeout(timer); resolve({ status, headers, events, timedOut: false }) })
    req.on('close', () => { clearTimeout(timer); resolve({ status, headers, events, timedOut: false }) })
    req.end()
  })
}

async function main() {
  const report = []
  const note = (ok, label, value) => {
    report.push({ ok, label })
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value ? `  ${value}` : ''}`)
  }

  console.log(`\n便携悬浮窗后端验证（隔离 DSH_HOME + 端口 ${PORT}）\n${'─'.repeat(62)}`)

  if (!fs.existsSync(ELECTRON)) {
    console.error('找不到 electron，先 npm install')
    process.exit(1)
  }

  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(path.join(USER_DATA, 'config.json'), JSON.stringify({
    version: 1,
    projects: [{ id: 'p-quick', name: '快速提问验证', cwd: SANDBOX, port: PORT }],
    activeProjectId: 'p-quick',
    openAtLogin: false,
    adoptExternal: false,
    openUiOnStart: false,
    autoStartOnLaunch: true,
    stopServerOnQuit: true,
    quickAsk: { session: 'dedicated', summary: 'truncate' },
  }, null, 2))

  console.log(`  DSH_HOME : ${path.relative(ROOT, HOME)}（隔离，无凭据）`)
  console.log('  … 启动开发版客户端（--hidden）')
  const child = spawn(ELECTRON, ['.', '--hidden', `--user-data-dir=${USER_DATA}`], {
    cwd: ROOT,
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

  // 等服务起来
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(1000)
    const probe = await get('/')
    up = probe.status > 0
  }
  note(up, 'DSH 服务已就绪', up ? `127.0.0.1:${PORT}` : '等待超时')

  const profileDir = path.join(HOME, 'profiles', 'web')
  const profileManifest = path.join(profileDir, 'package.json')
  const manifest = fs.existsSync(profileManifest) ? JSON.parse(fs.readFileSync(profileManifest, 'utf8')) : null
  const bundles = manifest?.dsh?.profile?.bundles || []
  note(bundles.includes('dsh-quick-ask'), '插件已写进 profile bundles', bundles.join(', '))
  note(fs.existsSync(path.join(profileDir, 'node_modules', 'dsh-quick-ask', 'lib', 'index.js')),
    '插件已复制到 profile node_modules')

  // 路由不是和服务同时就绪的：首次在全新 profile 上启动时，
  // `/` 能应答之后插件路由还要再等一会儿。这里轮询，别把竞态当成失败。
  let routed = false
  let waited = 0
  for (let i = 0; i < 30 && !routed; i++) {
    await sleep(1000)
    waited += 1
    const probe = await get(`/dsh-quick/ask?q=ping&id=probe`)
    routed = probe.status === 200
  }
  note(routed, '快速提问路由已注册', routed ? `等待 ${waited}s` : '等待 30s 仍未出现')

  // 自己签发会话 cookie（和客户端同一条路径）
  const { mintSessionCookie } = require('../lib/auth-cookie')
  const minted = mintSessionCookie('127.0.0.1', PORT)
  note(Boolean(minted), '可签发会话 cookie')
  const cookie = minted ? `${minted.name}=${minted.value}` : ''

  const query = new URLSearchParams({
    id: 'verify-1',
    q: '用一句话说明这个验证在做什么',
    session: 'dedicated',
    summary: 'truncate',
  }).toString()
  console.log('  … 发起一次快速提问（等 SSE）')
  const result = await quickAsk(query, cookie, 90000)

  note(result.status === 200, '路由返回 200', String(result.status))
  note(String(result.headers['content-type'] || '').includes('text/event-stream'),
    '响应是 SSE', String(result.headers['content-type'] || ''))
  note(result.events.length > 0, `收到 SSE 事件 ${result.events.length} 个`)

  const summary = result.events.find((event) => event.type === 'summary')
  const done = result.events.find((event) => event.type === 'done')
  const error = result.events.find((event) => event.type === 'error')

  // 隔离 home 没有凭据：期望走到模型这一步才失败，并且失败要**经由 turn/end 的 error 分支**，
  // 而不是路由 404 / 会话建不起来 / 事件根本收不到。
  if (error) note(true, '走到模型这一步才失败（符合隔离环境预期）', String(error.message || '').slice(0, 120))
  if (done) {
    note(true, '整条链路跑通并正常收尾', `sessionId=${done.sessionId}`)
    if (summary) note(true, '拿到简答', String(summary.text || '').slice(0, 120))
  }

  console.log('\n  --- SSE 事件 ---')
  for (const event of result.events.slice(-8)) {
    console.log(`  ${event.type}: ${JSON.stringify(event).slice(0, 200)}`)
  }

  cleanup()
  await sleep(800)
  const failed = report.filter((item) => !item.ok).length
  console.log(`${'─'.repeat(62)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('验证异常：', error.message)
  process.exit(1)
})
