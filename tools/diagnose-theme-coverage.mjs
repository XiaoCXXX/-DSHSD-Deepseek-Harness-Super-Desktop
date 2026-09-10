// 诊断：DSH Web 界面实际用到哪些 --dsw-* 颜色变量、主题包覆盖了哪些、缺口在哪。
// 并单独分析「输入框 / 打字框」用的是哪些令牌。
//   node tools/diagnose-theme-coverage.mjs
//
// 依赖随包 DSH 的源码（vendor/dsh）与主题包源码（同级目录 dsh-theme-pack，可用 DSH_THEME_PACK 覆盖）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_PACKAGES = path.join(ROOT, 'vendor', 'dsh', 'node_modules', '@deepseek-ai')
// 主题包默认取同级目录；可用 DSH_THEME_PACK 覆盖
const THEME_PACK = process.env.DSH_THEME_PACK || path.join(ROOT, '..', 'dsh-theme-pack')

// 字体、圆角、间距等非配色令牌不参与配色主题覆盖，排除掉
const NON_COLOR = /^--dsw-(font|corner|space|radius|size|duration|z-|motion)/
const COLORISH = /(bg|fill|border|label|text|surface|mask|elevation|brand|state|scroll|separator|overlay|shadow|stroke|link|markdown)/i

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

const used = new Map()
const inputTokens = new Map()
let scanned = 0

for (const pkg of fs.readdirSync(DSH_PACKAGES)) {
  if (!/^dsh-(client|web)/.test(pkg)) continue
  walk(path.join(DSH_PACKAGES, pkg), (file) => {
    if (!/\.(js|mjs|css)$/.test(file)) return
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      return
    }
    scanned++
    for (const match of text.matchAll(/--dsw-[A-Za-z0-9_-]+/g)) {
      const token = match[0]
      if (!used.has(token)) used.set(token, new Set())
      used.get(token).add(pkg)
    }

    // 输入框 / 打字框：把 textarea、contenteditable、composer、placeholder 附近的令牌抓出来
    const inputPattern = /textarea|contenteditable|composer|prompt-input|input-box/gi
    for (const hit of text.matchAll(inputPattern)) {
      const from = Math.max(0, hit.index - 600)
      const window = text.slice(from, hit.index + 600)
      for (const token of window.matchAll(/--dsw-[A-Za-z0-9_-]+/g)) {
        if (!inputTokens.has(token[0])) inputTokens.set(token[0], new Set())
        inputTokens.get(token[0]).add(pkg)
      }
    }
  })
}

const mapText = fs.readFileSync(path.join(THEME_PACK, 'lib', 'token-map.js'), 'utf8')
const declared = new Set([...mapText.matchAll(/--dsw-[A-Za-z0-9_-]+/g)].map((m) => m[0]))

const colorUsed = [...used.keys()].filter((t) => !NON_COLOR.test(t) && COLORISH.test(t))
const gaps = colorUsed.filter((t) => !declared.has(t)).sort()

console.log(`扫描 ${scanned} 个文件`)
console.log(`DSH 界面使用 ${used.size} 个 --dsw-* 变量，其中配色类 ${colorUsed.length} 个`)
console.log(`主题包声明覆盖 ${declared.size} 个`)
console.log(`\n配色缺口（界面在用、主题包未覆盖）：${gaps.length} 个`)
for (const token of gaps) {
  console.log(`  ${token.padEnd(50)} ← ${[...used.get(token)].slice(0, 3).join(', ')}`)
}

console.log(`\n${'─'.repeat(64)}`)
console.log('输入框 / 打字框相关令牌分析')
const inputList = [...inputTokens.keys()].sort()
const inputGaps = inputList.filter((t) => !declared.has(t))
console.log(`附近出现的令牌共 ${inputList.length} 个，其中主题包未覆盖 ${inputGaps.length} 个：`)
for (const token of inputList) {
  const covered = declared.has(token) ? '✅ 已覆盖' : '❌ 未覆盖'
  console.log(`  ${covered}  ${token.padEnd(48)} ← ${[...inputTokens.get(token)].slice(0, 2).join(', ')}`)
}
