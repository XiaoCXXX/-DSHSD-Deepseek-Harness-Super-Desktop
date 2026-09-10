// 诊断客户端主题：找出「control.css 在用、但只定义在默认块、未被逐主题覆盖」的变量。
// 这类变量在切换主题时不会变，正是「某个区域颜色不变」的典型原因。
//   node tools/diagnose-client-theme.mjs

import fs from 'node:fs'
import path from 'node:path'

const RENDERER = 'D:/Testing Arena/dsh-client/renderer'
const cssText = fs.readFileSync(path.join(RENDERER, 'theme-tokens.css'), 'utf8')
const controlCss = fs.readFileSync(path.join(RENDERER, 'control.css'), 'utf8')

// ---- 1. 解析 theme-tokens.css：默认块 + 每主题块
const themeBlocks = [...cssText.matchAll(/\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g)].map((m) => ({
  id: m[1],
  vars: new Set([...m[2].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((v) => v[1])),
}))

// 默认块：`body { ... }` 里那一坨（所有主题之前）
const defaultBlockMatch = /body\s*\{([^}]*)\}/.exec(cssText)
const defaultVars = new Set(
  defaultBlockMatch ? [...defaultBlockMatch[1].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((v) => v[1]) : [],
)

console.log(`主题块：${themeBlocks.length} 个`)
for (const block of themeBlocks) console.log(`  ${block.id.padEnd(16)} ${block.vars.size} 个变量`)
console.log(`默认块（body）：${defaultVars.size} 个变量`)

// ---- 2. 哪些变量没有出现在【每一个】主题块里
const everOverridden = new Set()
for (const block of themeBlocks) for (const v of block.vars) everOverridden.add(v)

const partial = [...everOverridden].filter((v) => themeBlocks.some((b) => !b.vars.has(v)))
console.log(`\n未在全部主题块中出现的变量：${partial.length} 个`)
for (const v of partial) {
  const missing = themeBlocks.filter((b) => !b.vars.has(v)).map((b) => b.id)
  console.log(`  ${v.padEnd(28)} 缺失于: ${missing.join(', ')}`)
}

// ---- 3. control.css 用到、但从未被任何主题块覆盖的变量（切换主题时不会变）
const usedByControl = new Set([...controlCss.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]))
const neverOverridden = [...usedByControl].filter((v) => !everOverridden.has(v)).sort()

console.log(`\ncontrol.css 使用 ${usedByControl.size} 个变量`)
console.log(`其中从未被主题块覆盖（切主题不会变）：${neverOverridden.length} 个`)
for (const v of neverOverridden) {
  const where = [...controlCss.matchAll(new RegExp(`([^{}]*)\\{[^}]*var\\(${v}\\)`, 'g'))]
    .map((m) => m[1].trim().split('\n').pop().trim())
    .slice(0, 3)
  console.log(`  ❌ ${v.padEnd(26)} ← ${where.join(' | ')}`)
}
