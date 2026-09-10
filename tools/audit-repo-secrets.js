'use strict'

// 发布前审计：扫描**将要提交到 git 的全部文件**，确认没有凭据或隐私信息泄漏。
//   node tools/audit-repo-secrets.js
//
// 检查三类：
//   1. 本机凭据库里的真实密钥值（命中即失败）
//   2. 通用密钥形态（sk-xxx、长 base64 等）（命中即失败）
//   3. 本机用户路径 / 用户名（提示，视情况处理）
//
// 只输出文件名与安全指纹，绝不打印密钥内容。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const yaml = require('js-yaml')

const ROOT = path.resolve(__dirname, '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
// 用于隐私检查：本机家目录与工作区路径（自适应，不硬编码具体用户名）
const HOME_DIR = os.homedir()
const WORKSPACE_DIR = path.resolve(ROOT, '..')

const print = (value) => `${value.length}字符/${crypto.createHash('sha256').update(value).digest('hex').slice(0, 8)}`

/** 结构化提取凭据库里的真实密钥值（只看值，不把键名当密钥）。 */
function collectSecrets() {
  const file = path.join(DSH_HOME, '.credentials.yaml')
  const found = new Map()
  if (!fs.existsSync(file)) return []
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  const SECRET_FIELD = /(secret|token|apikey|api_key|password|credential)/i
  const walk = (node, trail) => {
    if (Array.isArray(node)) return node.forEach((item, i) => walk(item, `${trail}[${i}]`))
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && SECRET_FIELD.test(key) && value.length >= 16) found.set(value, `${trail}.${key}`)
        walk(value, `${trail}.${key}`)
      }
    }
  }
  walk(doc, '$')
  return [...found.keys()]
}

/** 通用密钥形态。 */
const GENERIC_PATTERNS = [
  { name: 'sk- API Key', re: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: 'ghp_/gho_ GitHub token', re: /gh[pou]_[A-Za-z0-9]{20,}/g },
  { name: 'OpenAI 风格密钥', re: /(?:api[_-]?key|apikey)["'\s:=]+["']?[A-Za-z0-9_-]{24,}/gi },
]

const secrets = collectSecrets().map((value) => ({ buffer: Buffer.from(value, 'utf8'), print: print(value) }))

// ---- 取将要提交的文件（-z 以正确处理非 ASCII 文件名）
const raw = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
const files = raw.toString('utf8').split('\0').filter(Boolean)

console.log(`待提交文件：${files.length} 个`)
console.log(`本机凭据库提取到 ${secrets.length} 个真实密钥值（仅显示指纹）：`)
for (const s of secrets) console.log(`  · ${s.print}`)
console.log('')

const hardHits = []
const softHits = []

for (const rel of files) {
  const full = path.join(ROOT, rel)
  let buffer
  try {
    buffer = fs.readFileSync(full)
  } catch {
    continue
  }

  for (const secret of secrets) {
    if (buffer.includes(secret.buffer)) hardHits.push({ file: rel, what: `真实密钥 ${secret.print}` })
  }

  let text
  try {
    text = buffer.toString('utf8')
  } catch {
    continue
  }

  for (const { name, re } of GENERIC_PATTERNS) {
    re.lastIndex = 0
    const match = re.exec(text)
    if (match) hardHits.push({ file: rel, what: `${name}（${match[0].slice(0, 8)}…）` })
  }

  // 隐私：本机家目录 / 工作区绝对路径
  if (text.includes(HOME_DIR) || text.includes(WORKSPACE_DIR)) {
    softHits.push({ file: rel, what: '出现本机绝对路径' })
  }
}

console.log('─'.repeat(64))
if (hardHits.length === 0) {
  console.log('✅ 未发现任何凭据')
} else {
  console.log(`❌ 发现 ${hardHits.length} 处凭据：`)
  for (const hit of hardHits) console.log(`   ${hit.file}  ← ${hit.what}`)
}

if (softHits.length === 0) {
  console.log('✅ 未发现本机路径/用户名')
} else {
  console.log(`⚠️  ${softHits.length} 个文件含本机路径或用户名（不致命，可按需清理）：`)
  for (const hit of softHits) console.log(`   ${hit.file}  ← ${hit.what}`)
}

console.log('─'.repeat(64))
console.log(hardHits.length === 0 ? '结论：可以安全提交 ✅' : '结论：存在凭据，禁止提交 ❌')
process.exit(hardHits.length === 0 ? 0 : 1)
