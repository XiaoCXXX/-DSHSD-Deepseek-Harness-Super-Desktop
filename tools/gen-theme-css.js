'use strict'

// 生成 renderer/theme-tokens.css。
//   node tools/gen-theme-css.js            写入文件
//   node tools/gen-theme-css.js --check    只校验文件是否与数据源一致（退出码 1 表示过期）
//
// 主题数据在 lib/themes.js，客户端与 DSH 侧主题包共用同一套角色色板，避免两处跑偏。

const fs = require('node:fs')
const path = require('node:path')
const { themeTokensCss } = require('../lib/themes')

const OUT = path.join(__dirname, '..', 'renderer', 'theme-tokens.css')
const css = themeTokensCss()
const check = process.argv.includes('--check')

if (check) {
  let current = ''
  try {
    current = fs.readFileSync(OUT, 'utf8')
  } catch {
    console.error('theme-tokens.css 不存在，需要运行 node tools/gen-theme-css.js')
    process.exit(1)
  }
  if (current.replaceAll('\r\n', '\n') !== css) {
    console.error('theme-tokens.css 与 lib/themes.js 不一致，请重新生成')
    process.exit(1)
  }
  console.log('theme-tokens.css 与主题数据一致')
  process.exit(0)
}

fs.writeFileSync(OUT, css, 'utf8')
console.log(`已写入 ${OUT}（${css.length} 字节，${css.split('\n').length} 行）`)
