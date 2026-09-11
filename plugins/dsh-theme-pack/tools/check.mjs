// dsh-theme-pack 契约自检：不需要 DSH 运行时，用一个 stub 的 ctx.webServer
// 把宿主半跑起来，验证三件事：
//   1. 主题数据与 buildVars 展开（native 主题不覆盖任何令牌）
//   2. 路由注册 + GET/PUT /dsh-theme/theme.json 的行为与校验
//   3. tapIndex 是否把应用脚本注入 index HTML
//
//   node tools/check.mjs

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-theme-check-'))
process.env.DSH_HOME = TMP_HOME

const { THEMES, DEFAULT_THEME_ID, getTheme } = await import('../lib/themes.js')
const { buildVars, ROLE_TO_TOKENS } = await import('../lib/token-map.js')
const plugin = await import('../lib/index.js')

let failed = 0
const note = (ok, label, extra = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
}

console.log(`DSH_HOME(stub) = ${TMP_HOME}\n`)
console.log('— 主题数据 —')
note(plugin.name === 'dsh-theme-pack', 'plugin name', plugin.name)
note(Array.isArray(plugin.inject) && plugin.inject.includes('webServer'), 'inject 声明 webServer', JSON.stringify(plugin.inject))
note(typeof plugin.apply === 'function', 'apply 是函数')
note(THEMES.length === 6, '主题数量', String(THEMES.length))
note(getTheme('nope-does-not-exist').id === DEFAULT_THEME_ID, '未知 id 回落默认', DEFAULT_THEME_ID)

const nativeWhite = buildVars(getTheme('dsh-white-blue'))
note(Object.keys(nativeWhite).length === 0, 'dsh-white-blue 不覆盖令牌（原生白蓝）', `${Object.keys(nativeWhite).length} 个`)
const ice = buildVars(getTheme('ice'))
note(Object.keys(ice).length > 40, 'ice 覆盖令牌数量充足', `${Object.keys(ice).length} 个`)
note(ice['--dsw-alias-bg-base'] === '#F7FBFF', 'ice pageBg 映射到 --dsw-alias-bg-base', ice['--dsw-alias-bg-base'])
note(ice['--dsw-alias-brand-primary'] === '#0E7FD8', 'ice brand 映射到 --dsw-alias-brand-primary', ice['--dsw-alias-brand-primary'])
note(ice['--dsw-specific-sidebar-fill'] === '#F1F8FD', '侧栏非别名令牌也覆盖', ice['--dsw-specific-sidebar-fill'])
const unknownVars = Object.keys(ice).filter((k) => !k.startsWith('--dsw-'))
note(unknownVars.length === 0, '所有覆盖都是 --dsw-* 变量', unknownVars.join(','))

console.log('\n— 路由与注入（stub ctx）—')
const routes = new Map()
let tap = null
let disposed = 0
const ctx = {
  webServer: {
    register(spec) {
      routes.set(spec.path, spec)
      return () => { disposed++ }
    },
    tapIndex(fn) {
      tap = fn
      return () => { disposed++ }
    },
  },
  effect(fn) { fn() },
}
plugin.apply(ctx)
note(routes.has('/dsh-theme/theme.json'), '注册了 theme.json 路由')
note(routes.has('/dsh-theme/theme.js'), '注册了 theme.js 路由')
note(routes.get('/dsh-theme/theme.json').kind === 'exact', '路由 kind 为 exact')
note(typeof tap === 'function', 'tapIndex 已注册')

function fakeRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers },
    end(chunk) { if (chunk !== undefined) this.body += String(chunk) },
  }
}
const getThemeJson = async () => {
  const res = fakeRes()
  routes.get('/dsh-theme/theme.json').handler({ method: 'GET' }, res)
  return { res, json: JSON.parse(res.body) }
}
const putThemeJson = async (body) => {
  const res = fakeRes()
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'PUT'
  await routes.get('/dsh-theme/theme.json').handler(req, res)
  await new Promise((r) => setTimeout(r, 30))
  return { res, json: JSON.parse(res.body) }
}

let out = await getThemeJson()
note(out.res.code === 200, 'GET 返回 200', String(out.res.code))
note(out.json.theme === DEFAULT_THEME_ID, '默认主题是原生白蓝', out.json.theme)
note(out.json.colorScheme === 'light' && out.json.native === true, '默认主题钉在 light 基底', `${out.json.colorScheme}/native=${out.json.native}`)
note(Array.isArray(out.json.themes) && out.json.themes.length === 6, '载荷带主题清单', `${out.json.themes.length} 项`)
note(out.res.headers['Cache-Control'] === 'no-store', 'Cache-Control: no-store')

out = await putThemeJson({ theme: 'ocean' })
note(out.res.code === 200, 'PUT 合法主题返回 200', String(out.res.code))
note(out.json.theme === 'ocean' && out.json.colorScheme === 'dark', 'PUT 后主题切换为 ocean/dark', `${out.json.theme}/${out.json.colorScheme}`)
note(out.json.vars['--dsw-alias-bg-base'] === '#0B2233', 'PUT 载荷带回新主题令牌', out.json.vars['--dsw-alias-bg-base'])

const stateFile = path.join(TMP_HOME, '.dsh-theme.json')
note(fs.existsSync(stateFile), '状态文件已写入 $DSH_HOME/.dsh-theme.json')
note(JSON.parse(fs.readFileSync(stateFile, 'utf8')).theme === 'ocean', '状态文件内容正确')

out = await putThemeJson({ theme: 'not-a-theme' })
note(out.res.code === 400, 'PUT 非法主题返回 400', String(out.res.code))
note(Array.isArray(out.json.known) && out.json.known.length === 6, '400 载荷列出合法 id')

const jsRes = fakeRes()
routes.get('/dsh-theme/theme.js').handler({ method: 'GET' }, jsRes)
note(jsRes.code === 200, 'theme.js 返回 200')
note(jsRes.headers['Content-Type'].startsWith('application/javascript'), 'theme.js Content-Type', jsRes.headers['Content-Type'])
note(jsRes.body.includes('__dshThemePack'), 'theme.js 是应用脚本本体', `${jsRes.body.length} 字节`)

const html = '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>'
const injected = tap(html)
note(injected.includes('<script defer src="/dsh-theme/theme.js"></script>'), 'index 注入 <script defer>')
note(injected.indexOf('</body>') > injected.indexOf('theme.js'), '脚本插在 </body> 之前')
note(tap(injected) === injected, '重复注入是幂等的')

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}\n`)
fs.rmSync(TMP_HOME, { recursive: true, force: true })
process.exit(failed === 0 ? 0 : 1)
