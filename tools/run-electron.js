'use strict'

// 以「正常 Electron 应用」方式启动一个脚本。
//   node tools/run-electron.js tools/make-icon.js
//
// 为什么需要它：随包 DSH 是以 Electron 内置 Node 运行的（ELECTRON_RUN_AS_NODE=1），
// 该变量会被 DSH 传给所有子进程。若不清掉，electron.exe 会以纯 Node 模式执行，
// require('electron').app 为 undefined，脚本直接崩溃。

const path = require('node:path')
const { spawn } = require('node:child_process')

const electronBin = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe')
const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('用法：node tools/run-electron.js <脚本路径> [参数...]')
  process.exit(2)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronBin, args, { stdio: 'inherit', env, windowsHide: false })
child.on('error', (error) => {
  console.error(`启动失败：${error.message}`)
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 1))
