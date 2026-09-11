'use strict'

// 配置规范化的单元测试：不需要启动 Electron。
//   node tools/verify-config.js
//
// 覆盖点：
//   1. 非法/缺失字段被补成默认值
//   2. **用户的合法选择不被覆盖**（显式 active 就是 active）
//   3. normalize() 把规范化结果写回文件，且只在真的变了才写
//   4. 坏文件/缺文件都能起来

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { Config, defaults } = require('../lib/config')

const report = []
const note = (ok, label, value) => {
  report.push(ok)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${value === undefined ? '' : `  ${value}`}`)
}

const ROOT = path.join(os.tmpdir(), `dsh-config-verify-${Date.now()}`)
fs.mkdirSync(ROOT, { recursive: true })

function write(name, content) {
  const dir = path.join(ROOT, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), content, 'utf8')
  return dir
}

function readBack(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))
}

console.log(`\n配置规范化单元测试\n${'─'.repeat(58)}`)

// ---- 1. 空目录：用默认值，并落一份文件
{
  const dir = path.join(ROOT, 'empty')
  fs.mkdirSync(dir, { recursive: true })
  const config = new Config(dir)
  const result = config.normalize()
  note(result.changed === true, '缺文件时会写一份', JSON.stringify(result))
  const disk = readBack(dir)
  note(disk.quickAsk.session === 'dedicated', '默认 quickAsk.session = dedicated', disk.quickAsk.session)
  note(disk.quickAsk.summary === 'model', '默认 quickAsk.summary = model', disk.quickAsk.summary)
  note(disk.version === defaults().version, '默认 version 正确', String(disk.version))
  note(Array.isArray(disk.projects) && disk.projects.length === 1, '默认项目已补全')
}

// ---- 2. 显式 active 必须被保留（用户的选择不能被吃掉）
{
  const dir = write('explicit-active', JSON.stringify({
    version: 1,
    quickAsk: { session: 'active', summary: 'truncate' },
  }))
  const config = new Config(dir)
  note(config.all().quickAsk.session === 'active', '显式 active 被保留', config.all().quickAsk.session)
  note(config.all().quickAsk.summary === 'truncate', '显式 truncate 被保留', config.all().quickAsk.summary)
  const result = config.normalize()
  note(readBack(dir).quickAsk.session === 'active', '写回后仍是 active（没被改成默认）')
  // 其余字段会被补全，所以这次确实应该写
  note(result.changed === true, '补全了其它缺失字段 → 写回', JSON.stringify(result))
}

// ---- 3. 非法值被纠正
{
  const dir = write('invalid', JSON.stringify({
    version: 1,
    quickAsk: { session: 'nonsense', summary: 42 },
  }))
  const config = new Config(dir)
  note(config.all().quickAsk.session === 'dedicated', '非法 session → 默认 dedicated', config.all().quickAsk.session)
  note(config.all().quickAsk.summary === 'model', '非法 summary → 默认 model', config.all().quickAsk.summary)
  config.normalize()
  note(readBack(dir).quickAsk.session === 'dedicated', '纠正结果已写回文件')
}

// ---- 4. 缺字段 / 缺整个 quickAsk
{
  const dir = write('partial', JSON.stringify({
    version: 1,
    quickAsk: { summary: 'truncate' },
  }))
  const config = new Config(dir)
  note(config.all().quickAsk.session === 'dedicated', '缺 session → 补默认')
  note(config.all().quickAsk.summary === 'truncate', '已有的 summary 保留', config.all().quickAsk.summary)

  const dir2 = write('none', JSON.stringify({ version: 1 }))
  const config2 = new Config(dir2)
  note(config2.all().quickAsk.session === 'dedicated', '整个 quickAsk 缺失 → 补全')
}

// ---- 5. 幂等：第二次 normalize 不该再写
{
  const dir = write('idempotent', JSON.stringify({
    version: 1,
    projects: [{ id: 'p', name: 'x', cwd: ROOT, port: 3080 }],
    activeProjectId: 'p',
    quickAsk: { session: 'active', summary: 'model' },
  }))
  const config = new Config(dir)
  const first = config.normalize()
  const second = config.normalize()
  note(second.changed === false, '第二次 normalize 不再写盘', JSON.stringify(second))
  note(readBack(dir).quickAsk.session === 'active', '两次之后 active 仍然保留')
  void first
}

// ---- 6. 坏文件不崩
{
  const dir = write('broken', '{ this is not json')
  const config = new Config(dir)
  note(config.all().quickAsk.session === 'dedicated', '坏 JSON → 回落默认值且不抛错')
  const result = config.normalize()
  note(result.changed === true, '坏文件会被重写成规范化内容', JSON.stringify(result))
  note(readBack(dir).quickAsk.session === 'dedicated', '重写后的文件可用')
}

// ---- 7. patch 的浅合并：只改 quickAsk.session 不该抹掉 summary
{
  const dir = path.join(ROOT, 'patch')
  fs.mkdirSync(dir, { recursive: true })
  const config = new Config(dir)
  config.patch({ quickAsk: { session: 'active' } })
  note(config.all().quickAsk.summary === 'model', 'patch 只改 session，summary 仍在', config.all().quickAsk.summary)
  note(readBack(dir).quickAsk.summary === 'model', '写回文件后 summary 也在')
}

fs.rmSync(ROOT, { recursive: true, force: true })

const failed = report.filter((ok) => !ok).length
console.log(`${'─'.repeat(58)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
process.exit(failed === 0 ? 0 : 1)
