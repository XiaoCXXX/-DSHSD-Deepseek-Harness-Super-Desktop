'use strict'

// 打包形态端到端验证（不需要真的构建安装包）：
//   1) 全新 DSH_HOME（模拟干净机器）
//   2) 用 ensureProfile 预置 profile 并启用随包挂件
//   3) 以 Electron 内置 Node + --expose-internals 运行随包 DSH
//   4) 验证服务起来、挂件路由可用
//   node tools/verify-packaged.js

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const DSH_BIN = path.join(ROOT, 'vendor', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const HOME = path.join(ROOT, '.packtest', 'clean-home')
const PORT = 3096

const { ensureProfile, enabledPlugins } = require('../lib/provision')
const { resolveRuntime, resolvePackageDir, bundledPluginDir, profileDir } = require('../lib/runtime')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function request(pathname, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'GET', timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 200) }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: '超时' }) })
    req.on('error', (e) => resolve({ status: 0, error: e.message }))
    req.end()
  })
}

async function main() {
  const report = []
  const note = (ok, label, value) => {
    report.push({ ok, label })
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value ? `  ${value}` : ''}`)
  }

  console.log(`\n打包形态端到端验证\n${'─'.repeat(60)}`)

  // 全新技术上干净的家目录
  fs.rmSync(HOME, { recursive: true, force: true })
  fs.mkdirSync(HOME, { recursive: true })
  process.env.DSH_HOME = HOME
  note(true, '已创建全新 DSH_HOME', HOME)

  note(fs.existsSync(DSH_BIN), '随包 DSH 存在', path.relative(ROOT, DSH_BIN))

  // 预置 profile
  const dir = profileDir(HOME)
  const before = fs.existsSync(path.join(dir, 'package.json'))
  note(!before, '初始状态：profile 不存在')

  const result = ensureProfile({
    dir,
    plugins: [{ name: 'dsh-whale-widget', sourceDir: bundledPluginDir('dsh-whale-widget') }],
    log: (m) => console.log(`     · ${m}`),
  })
  note(fs.existsSync(path.join(dir, 'package.json')), 'profile 清单已生成')
  note(result.bundles.includes('dsh-whale-widget'), '挂件已写入 bundles', result.bundles.join(', '))
  note(enabledPlugins(dir).includes('dsh-whale-widget'), 'enabledPlugins 读取正确')
  note(fs.existsSync(path.join(dir, 'cordis.patch.yml')), 'cordis.patch.yml 已生成')
  note(fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')), 'pnpm-workspace.yaml 已生成')

  const pluginDir = resolvePackageDir('dsh-whale-widget', { dshRoot: path.join(ROOT, 'vendor', 'dsh'), profile: dir })
  note(Boolean(pluginDir), '挂件可从随包锚点解析', pluginDir ? 'vendor 锚点' : '未找到')

  // 以 Electron 内置 Node 启动随包 DSH
  const env = {
    ...process.env,
    DSH_HOME: HOME,
    ELECTRON_RUN_AS_NODE: '1',
  }
  delete env.DSH_CLIENT_RUNTIME

  console.log('  … 启动随包 DSH（Electron 内置 Node）')
  const child = spawn(ELECTRON, ['--expose-internals', DSH_BIN, 'web', '--port', String(PORT), '--no-open'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const output = []
  child.stdout.on('data', (d) => output.push(String(d)))
  child.stderr.on('data', (d) => output.push(String(d)))

  const cleanup = () => {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  // 等服务真正就绪：以 stdout 里的启动令牌为准（端口会先监听、路由后挂载）
  let root = { status: 0 }
  let sawToken = false
  for (let i = 0; i < 120; i++) {
    await sleep(1000)
    if (child.exitCode !== null) break
    if (!sawToken && /\?token=/.test(output.join(''))) {
      sawToken = true
      console.log('  … 已捕获启动令牌，开始探测路由')
    }
    if (!sawToken) continue
    root = await request('/')
    if (root.status === 401 || root.status === 200) break
  }

  if (!sawToken) {
    console.log('\n--- 未捕获到启动令牌，进程输出尾部 ---')
    console.log(output.join('').split('\n').slice(-25).join('\n'))
  }

  note(sawToken, '已捕获启动令牌（表明 web 已就绪）')
  note(child.exitCode === null, '服务进程保持存活', child.exitCode === null ? '' : `已退出 code=${child.exitCode}`)
  note(root.status === 401 || root.status === 200, '服务已监听并可响应', `GET / -> ${root.status}`)

  const widget = await request('/dsh-whale/widget.js')
  note(widget.status === 200, '挂件脚本路由可用', `/dsh-whale/widget.js -> ${widget.status}`)

  const balance = await request('/dsh-whale/balance.json')
  note(balance.status === 200, '挂件余额路由可用', `/dsh-whale/balance.json -> ${balance.status} ${balance.body || ''}`)

  const image = await request('/dsh-whale/image.png')
  note(image.status === 200, '挂件图片路由可用', `/dsh-whale/image.png -> ${image.status}`)

  if (child.exitCode !== null) {
    console.log('\n--- 进程输出 ---')
    console.log(output.join('').split('\n').slice(-20).join('\n'))
  }

  cleanup()
  await sleep(500)

  const failed = report.filter((r) => !r.ok).length
  console.log(`${'─'.repeat(60)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('验证脚本异常：', error.message)
  process.exit(1)
})
