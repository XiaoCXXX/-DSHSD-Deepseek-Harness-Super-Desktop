'use strict'

// 给 DSH 的 Windows 子进程创建路径补上 CREATE_NO_WINDOW。
//   node tools/patch-vendor-console.js [dshRoot...]
//
// 为什么需要：
//   DSH 宿主在桌面客户端里是 Electron（GUI 子系统，**自身没有控制台**）。它在 Windows 上
//   通过 Job 通道创建子进程，最终由 dsh-win32-process 直接 FFI 调 CreateProcessW/
//   CreateProcessAsUserW，而 creationFlags 只传了 0 / 4(CREATE_SUSPENDED) /
//   1028(SUSPENDED|UNICODE_ENV)，**没有 CREATE_NO_WINDOW(0x08000000)**。
//   无控制台的父进程 + 不带该标志 ⇒ 每个控制台子进程都会新建一个可见的控制台窗口，
//   也就是开发时满屏乱闪的 powershell / cmd。
//
//   同一个包里 Node 的 spawn 路径写的是 `windowsHide: platform === "win32"`
//   （dsh-subprocess-local/lib/runner-launch-*.js），说明隐藏窗口本来就是预期行为，
//   只是 FFI 这条路径漏了。这里只补齐这个标志，不改任何其它语义：
//   stdio 仍然走 STARTUPINFO 里显式传的句柄（dwFlags=STARTF_USESTDHANDLES），
//   不依赖控制台，所以隐藏控制台不影响任何输入输出。
//
// 幂等：文件里已有 PATCH_MARKER 就跳过。首次修改前会留一份 .orig 备份。

const fs = require('node:fs')
const path = require('node:path')

const PATCH_MARKER = 'DSH_PATCH_CREATE_NO_WINDOW'
const PACKAGE = path.join('node_modules', '@deepseek-ai', 'dsh-win32-process', 'lib', 'index.js')

const DECLARATION = `/**
 * ${PATCH_MARKER}: 无控制台的宿主（Electron 桌面客户端）创建控制台子进程时，
 * 不指定该标志会让每个子进程新建一个可见的控制台窗口。stdio 走显式句柄，不受影响。
 */
const CREATE_NO_WINDOW = 0x08000000;
`

/** 三处 CreateProcess 调用点：原 creationFlags → 打上补丁后的写法。 */
const REWRITES = [
  {
    label: 'spawnPipedProcess (CreateProcessAsUserW, flags=0)',
    from: ', buildCommandLine(options.command, options.args), 0, startupInfo, processInfo)',
    to: `, buildCommandLine(options.command, options.args), CREATE_NO_WINDOW, startupInfo, processInfo)`,
  },
  {
    label: 'spawnJobProcess inherited (flags=4 CREATE_SUSPENDED)',
    from: 'createRestrictedProcess(api, options, commandLine, 4, startupInfo, processInfo)',
    to: 'createRestrictedProcess(api, options, commandLine, CREATE_NO_WINDOW | 4, startupInfo, processInfo)',
  },
  {
    label: 'spawnJobProcess carrier (CreateProcessW, flags=1028)',
    from: 'commandLine, null, null, 1, 1028, environment, options.cwd, startupInfo, processInfo)',
    to: 'commandLine, null, null, 1, CREATE_NO_WINDOW | 1028, environment, options.cwd, startupInfo, processInfo)',
  },
]

function patchFile(file, log) {
  if (!fs.existsSync(file)) {
    log(`  跳过（不存在）：${file}`)
    return 'missing'
  }
  const original = fs.readFileSync(file, 'utf8')

  if (original.includes(PATCH_MARKER)) {
    log(`  已打过补丁，跳过`)
    return 'already'
  }

  let text = original
  for (const rule of REWRITES) {
    const hits = text.split(rule.from).length - 1
    if (hits !== 1) {
      throw new Error(`补丁锚点失配（${rule.label}）：期望命中 1 次，实际 ${hits} 次。` +
        `DSH 版本可能变了，请重新核对 dsh-win32-process/lib/index.js 再改这里。`)
    }
    text = text.replace(rule.from, rule.to)
  }

  const anchor = 'function createRestrictedProcess('
  const at = text.indexOf(anchor)
  if (at < 0) throw new Error('找不到 createRestrictedProcess，无法插入常量声明')
  text = text.slice(0, at) + DECLARATION + text.slice(at)

  const backup = `${file}.orig`
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original)
  fs.writeFileSync(file, text)
  log(`  已打补丁（备份：${path.basename(backup)}）`)
  return 'patched'
}

function patchRoot(root, log) {
  const file = path.join(root, PACKAGE)
  log(`${root}`)
  return patchFile(file, log)
}

/** 供 stage-vendor.js 调用：给一个 DSH 根目录打补丁，返回 'patched' | 'already' | 'missing'。 */
function patchDshRoot(root, log = () => {}) {
  return patchRoot(root, log)
}

function main() {
  const roots = process.argv.slice(2)
  if (roots.length === 0) {
    console.error('用法：node tools/patch-vendor-console.js <dshRoot> [更多 dshRoot...]')
    console.error('  dshRoot 是包含 node_modules/@deepseek-ai/ 的目录（如 vendor/dsh 或 %USERPROFILE%\\.dsh\\profiles）')
    process.exit(2)
  }
  const log = (message) => console.log(message)
  const results = roots.map((root) => patchRoot(path.resolve(root), log))
  const failed = results.filter((r) => r === 'missing').length
  console.log(failed === 0 ? '\n完成。' : `\n${failed} 个目标缺少 dsh-win32-process。`)
}

if (require.main === module) main()

module.exports = { patchDshRoot, PATCH_MARKER }
