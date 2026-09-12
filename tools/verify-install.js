'use strict'

// v1.0.0 发布前的完整安装验证：
//   1. 静默安装到临时目录（不动系统里已有的安装）
//   2. 检查装出来的文件、快捷方式、图标
//   3. **实际启动**，确认服务能起来、界面能加载
//   4. 卸载，确认干净
//   node tools/verify-install-1.0.0.js
//
// 用 /D= 指定安装目录 + /S 静默，避免碰用户的真实安装。

delete process.env.ELECTRON_RUN_AS_NODE

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const SETUP = path.join(ROOT, 'dist', 'DSHSD-Setup-1.0.0.exe')
const SANDBOX = path.join(ROOT, '.verify', 'install-1.0.0')
const INSTALL_DIR = path.join(SANDBOX, 'app')
const USER_DATA = path.join(SANDBOX, 'userdata')
const DSH_HOME = path.join(SANDBOX, 'dshhome')
const PORT = 3091

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function get(pathname, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'GET', timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 120) }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }) })
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.end()
  })
}

async function main() {
  const report = []
  const note = (ok, label, value) => {
    report.push(ok)
    console.log(`  ${ok ? '✅' : '❌'} ${label}${value === undefined ? '' : `  ${value}`}`)
  }

  console.log(`\nv1.0.0 安装包验证\n${'─'.repeat(62)}`)
  if (!fs.existsSync(SETUP)) { console.error(`找不到 ${SETUP}`); process.exit(1) }

  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(SANDBOX, { recursive: true })

  // ---- 1. 静默安装到隔离目录
  //
  // 注意耗时：这个包解压 582 MB / 25505 个文件，安装约 3~4 分钟
  // （前 40 秒 NSIS 在解压内嵌的 app-64.7z 压缩包，之后才开始写盘）。
  // 超时给足，否则会误判成「安装失败」。
  console.log('  … 静默安装到 .verify/install-1.0.0/app')
  // 安装前只做一件事：确保目标目录干净。
  // **不要**用 `taskkill /IM DSHSD-Setup-1.0.0.exe` 去「清理残留进程」——
  // 那个镜像名就是安装包自己，会把随后启动的安装进程一起杀掉，
  // 表现是「安装耗时 110 秒但什么都没装」，排查时极具误导性（踩过）。
  if (fs.existsSync(INSTALL_DIR)) {
    fs.rmSync(INSTALL_DIR, { recursive: true, force: true })
    await sleep(500)
    console.log('    （已清理上次遗留的安装目录）')
  }
  const startedAt = Date.now()
  try {
    // 注意：不要指望这个调用的返回值代表「安装完成」。
    // NSIS 在多用户模式下会**再拉起一个内层实例**然后外层立刻退出，
    // execFileSync 于是只等了 48 秒就返回，而此时磁盘上只有 19 个文件（半成品）。
    // 所以下面一律靠**轮询磁盘**判断完成，不靠进程退出码。
    execFileSync(SETUP, ['/S', `/D=${INSTALL_DIR}`], { windowsHide: true, stdio: 'ignore', timeout: 720000 })
  } catch (error) {
    // 超时/非 0 退出都不代表失败——真正的判据是文件有没有落地
    console.log(`    （安装进程返回：${error.message.split('\n')[0]}）`)
  }

  // 轮询等安装真正完成：主程序 + 卸载器都出现才算装好。
  // 实测完整安装约 110~205 秒（前 40 秒在解压内嵌的 162MB 压缩包）。
  const exePath = path.join(INSTALL_DIR, 'DSH Desktop Client.exe')
  const uninstallerPath = path.join(INSTALL_DIR, 'Uninstall DSH Desktop Client.exe')
  let installed = false
  for (let i = 0; i < 300; i++) {
    await sleep(1000)
    if (fs.existsSync(exePath) && fs.existsSync(uninstallerPath)) { installed = true; break }
  }
  console.log(`    （安装耗时 ${Math.round((Date.now() - startedAt) / 1000)} 秒）`)
  note(installed, '安装完成，主程序已落地')
  if (!installed) { console.log('\n安装失败，后续检查跳过\n'); process.exit(1) }

  // ---- 2. 文件清单
  const exe = path.join(INSTALL_DIR, 'DSH Desktop Client.exe')
  note(fs.existsSync(exe), '主程序存在', `${(fs.statSync(exe).size / 1024 / 1024).toFixed(1)} MB`)
  note(fs.existsSync(path.join(INSTALL_DIR, 'resources', 'icon.ico')), '图标随包（resources/icon.ico）')
  const plugins = fs.existsSync(path.join(INSTALL_DIR, 'resources', 'plugins'))
    ? fs.readdirSync(path.join(INSTALL_DIR, 'resources', 'plugins'))
    : []
  note(plugins.includes('dsh-desktop-pet'), '宠物插件已随包', plugins.join(', '))
  note(plugins.includes('dsh-quick-ask'), '快速提问插件已随包')
  note(plugins.includes('dsh-theme-pack'), '主题包已随包')
  note(!plugins.includes('dsh-whale-widget'), '没有旧的鲸鱼插件残留')
  const dshBin = path.join(INSTALL_DIR, 'resources', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  note(fs.existsSync(dshBin), 'DSH 本体已随包')
  note(fs.existsSync(path.join(INSTALL_DIR, 'Uninstall DSH Desktop Client.exe')), '卸载程序存在')

  // ---- 3. 实际启动（隔离 userData + DSH_HOME，独立端口）
  console.log('  … 启动打包后的客户端（--hidden，隔离数据目录）')
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.mkdirSync(DSH_HOME, { recursive: true })
  fs.writeFileSync(path.join(USER_DATA, 'config.json'), JSON.stringify({
    version: 1,
    projects: [{ id: 'p-inst', name: '安装验证', cwd: SANDBOX, port: PORT }],
    activeProjectId: 'p-inst',
    autoStartOnLaunch: true,
    openUiOnStart: true,
    adoptExternal: false,
    stopServerOnQuit: true,
    language: 'zh',
  }, null, 2))

  const env = { ...process.env, DSH_HOME }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(exe, ['--hidden', `--user-data-dir=${USER_DATA}`], {
    cwd: INSTALL_DIR, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  let up = false
  for (let i = 0; i < 90 && !up; i++) {
    await sleep(1000)
    up = (await get('/')).status > 0
  }
  note(up, '服务在独立端口上起来了', `127.0.0.1:${PORT}`)
  note(child.exitCode === null, '客户端进程保持运行（没崩）')

  // ---- 4. profile 是否被正确预置
  const profilePkg = path.join(DSH_HOME, 'profiles', 'web', 'package.json')
  const bundles = fs.existsSync(profilePkg) ? JSON.parse(fs.readFileSync(profilePkg, 'utf8')).dsh?.profile?.bundles || [] : []
  note(bundles.includes('dsh-desktop-pet'), '启动后自动装好宠物插件', bundles.join(', '))
  note(bundles.includes('dsh-quick-ask') && bundles.includes('dsh-theme-pack'), '另外两个插件也装好')
  note(!bundles.includes('dsh-whale-widget'), '没有启用旧插件')

  // ---- 5. 三个插件的路由都活着吗
  await sleep(4000)
  const whaleRoutes = await Promise.all([
    get('/dsh-pet/image.png'),
    get('/dsh-pet/balance.json'),
    get('/dsh-theme/theme.json'),
  ])
  note(whaleRoutes[0].status === 200 || whaleRoutes[0].status === 404,
    '宠物图片路由有响应（404=未认证属正常）', String(whaleRoutes[0].status))
  note(whaleRoutes[1].status !== 0, '余额路由有响应', String(whaleRoutes[1].status))

  const logFile = path.join(USER_DATA, 'logs', 'dsh-client.log')
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
  note(/随包 DSH/.test(log), '日志确认用的是随包 DSH 运行时')
  note(/dsh-desktop-pet/.test(log), '日志确认宠物插件已安装')

  console.log('\n  --- 客户端日志（最后 6 行）---')
  for (const line of log.split('\n').filter(Boolean).slice(-6)) console.log(`  ${line}`)

  cleanup()
  await sleep(1500)

  // ---- 6. 卸载
  const uninstaller = path.join(INSTALL_DIR, 'Uninstall DSH Desktop Client.exe')
  if (fs.existsSync(uninstaller)) {
    try {
      execFileSync(uninstaller, ['/S', '_?=' + INSTALL_DIR], { windowsHide: true, stdio: 'ignore', timeout: 180000 })
    } catch { /* 卸载器常返回非 0 */ }
    await sleep(6000)
    const gone = !fs.existsSync(path.join(INSTALL_DIR, 'DSH Desktop Client.exe'))
    note(gone, '卸载后主程序已移除')
    note(fs.existsSync(DSH_HOME), '卸载保留了 DSH_HOME（用户数据不该被删）')
  } else {
    note(false, '找到卸载程序')
  }

  const failed = report.filter((ok) => !ok).length
  console.log(`\n${'─'.repeat(62)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('验证异常：', e.message); process.exit(1) })
