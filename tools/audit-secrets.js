'use strict'

// 密钥泄漏审计：把本机凭据库里的**真正的密钥值**取出来，
// 在打包产物与打包输入里逐字节搜索，确认没有任何凭据被打进去。
//   node tools/audit-secrets.js
//
// 只输出文件名、长度和哈希前缀等安全指纹，绝不打印密钥内容。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const yaml = require('js-yaml')

const ROOT = path.resolve(__dirname, '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

/** 安全指纹：长度 + sha256 前 8 位，足以核对身份又不泄漏内容。 */
function fingerprint(value) {
  return `${value.length}字符/${crypto.createHash('sha256').update(value).digest('hex').slice(0, 8)}`
}

/**
 * 结构化提取真正的密钥值：只看「值」，不把字段名/键名当成密钥。
 * 覆盖 secret/token/key/password 等字段，外加 sk- 形态的 API Key。
 */
function collectSecrets() {
  const file = path.join(DSH_HOME, '.credentials.yaml')
  const found = new Map() // value -> 来源说明
  if (!fs.existsSync(file)) return { file, secrets: [] }

  const text = fs.readFileSync(file, 'utf8')
  const doc = yaml.load(text)

  const SECRET_FIELD = /(secret|token|apikey|api_key|password|passwd|credential)/i
  const walk = (node, trail) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${trail}[${index}]`))
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && SECRET_FIELD.test(key) && value.length >= 16) {
          found.set(value, `${trail}.${key}（字段值）`)
        }
        walk(value, `${trail}.${key}`)
      }
    }
  }
  walk(doc, '$')

  // 补漏：文中任何 sk- 开头的 API Key
  for (const match of text.matchAll(/sk-[A-Za-z0-9_-]{16,}/g)) {
    if (!found.has(match[0])) found.set(match[0], 'sk- 形态的 Key')
  }

  return { file, secrets: [...found.entries()].map(([value, origin]) => ({ value, origin })) }
}

const FORBIDDEN_NAMES = [
  /^\.credentials/i,
  /credentials\.ya?ml$/i,
  /^\.dshw-usage\.json$/i,
  /^\.anonymous-user-id$/i,
  /^settings\.ya?ml$/i,
  /^config\.json$/i,
]

function walk(dir, onFile) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, onFile)
    else if (entry.isFile()) onFile(full)
  }
}

function auditTree(label, dir, secretBuffers) {
  const result = { label, dir, files: 0, bytes: 0, hits: [], forbidden: [] }
  if (!fs.existsSync(dir)) {
    result.missing = true
    return result
  }

  walk(dir, (file) => {
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      return
    }
    result.files += 1
    result.bytes += stat.size

    const relative = path.relative(dir, file)
    if (FORBIDDEN_NAMES.some((pattern) => pattern.test(path.basename(file)))) {
      result.forbidden.push(relative)
    }

    let buffer
    try {
      buffer = fs.readFileSync(file)
    } catch {
      return
    }
    for (const secret of secretBuffers) {
      if (buffer.includes(secret.buffer)) {
        result.hits.push({ file: relative, print: secret.print })
      }
    }
  })

  return result
}

function report(result) {
  const rel = path.relative(ROOT, result.dir) || '.'
  console.log(`\n▸ ${result.label}  (${rel})`)
  if (result.missing) {
    console.log('  ⚠️  目录不存在，跳过')
    return 0
  }
  console.log(`  扫描 ${result.files.toLocaleString()} 个文件 / ${(result.bytes / 1024 / 1024).toFixed(0)} MB`)

  let failures = 0
  if (result.forbidden.length > 0) {
    failures += result.forbidden.length
    console.log(`  ❌ 发现 ${result.forbidden.length} 个敏感文件：`)
    for (const file of result.forbidden.slice(0, 20)) console.log(`       ${file}`)
  } else {
    console.log('  ✅ 无凭据 / 账本 / 设置类文件')
  }

  if (result.hits.length > 0) {
    failures += result.hits.length
    console.log(`  ❌ ${result.hits.length} 处命中真实密钥内容：`)
    for (const hit of result.hits.slice(0, 20)) console.log(`       ${hit.file}  ← ${hit.print}`)
  } else {
    console.log('  ✅ 未命中任何真实密钥内容')
  }
  return failures
}

console.log('密钥泄漏审计')
console.log('═'.repeat(66))

const { file, secrets } = collectSecrets()
console.log(`凭据库：${file}`)
console.log(`提取到 ${secrets.length} 个真实密钥值（仅显示安全指纹）：`)
for (const secret of secrets) {
  console.log(`  · ${fingerprint(secret.value)}  来源：${secret.origin}`)
}

const secretBuffers = secrets.map((secret) => ({
  buffer: Buffer.from(secret.value, 'utf8'),
  print: fingerprint(secret.value),
}))

let failures = 0
failures += report(auditTree('打包产物（安装程序的实际来源）', path.join(ROOT, 'dist', 'win-unpacked'), secretBuffers))
failures += report(auditTree('打包输入：随包 DSH', path.join(ROOT, 'vendor', 'dsh'), secretBuffers))
failures += report(auditTree('打包输入：随包插件', path.join(ROOT, 'vendor', 'plugins'), secretBuffers))

// 命令行传入的额外目录（例如从安装包解出来的内容）
for (const extra of process.argv.slice(2)) {
  failures += report(auditTree(`额外扫描：${path.basename(extra)}`, path.resolve(ROOT, extra), secretBuffers))
}

console.log(`\n${'═'.repeat(66)}`)
console.log(failures === 0 ? '结论：安装包内不含任何本机凭据 ✅' : `结论：发现 ${failures} 处问题 ❌`)
process.exit(failures === 0 ? 0 : 1)
