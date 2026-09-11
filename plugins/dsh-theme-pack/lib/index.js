// dsh-theme-pack 宿主半：注册 /dsh-theme/* 路由，并把应用脚本注入 DSH Web 页面。
//
// 机制照抄本项目已验证可用的 dsh-whale-widget：
//   - 依赖注入 webServer 服务
//   - ctx.webServer.register({ kind: 'exact', path, handler })  注册路由
//   - ctx.webServer.tapIndex(html => html)                       往 index 注入 <script>
//
// 主题状态存在 $DSH_HOME/.dsh-theme.json，客户端（Electron）用 PUT 切换，
// 浏览器应用脚本用 GET 读取。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { THEMES, DEFAULT_THEME_ID, getTheme } from './themes.js'
import { buildVars } from './token-map.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const STATE_FILE = path.join(DSH_HOME, '.dsh-theme.json')
const APPLIER_FILE = path.join(PACKAGE_ROOT, 'lib', 'applier.browser.js')

/** 稳定 Cordis 插件名。 */
const name = 'dsh-theme-pack'
/** 需要 webServer 提供路由与 index 注入能力。 */
const inject = ['webServer']

function readThemeId() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (parsed && typeof parsed.theme === 'string' && THEMES.some((t) => t.id === parsed.theme)) {
      return parsed.theme
    }
  } catch {
    /* 文件不存在或损坏都回落到默认主题 */
  }
  return DEFAULT_THEME_ID
}

function writeThemeId(id) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ theme: id, updatedAt: new Date().toISOString() }, null, 2),
    'utf8',
  )
}

/** 当前主题的完整载荷：给应用脚本和客户端共用。 */
function payload() {
  const active = getTheme(readThemeId())
  return {
    ok: true,
    theme: active.id,
    label: active.label,
    colorScheme: active.colorScheme,
    native: Boolean(active.native),
    vars: buildVars(active),
    themes: THEMES.map((t) => ({
      id: t.id,
      label: t.label,
      labelEn: t.labelEn,
      colorScheme: t.colorScheme,
      native: Boolean(t.native),
    })),
  }
}

function sendJson(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 普通插件体：注册路由 + 注入脚本，全部用 ctx.effect 兜底释放。 */
function apply(ctx) {
  const disposers = []

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-theme/theme.json',
      handler: (req, res) => {
        if (req.method === 'PUT' || req.method === 'POST') {
          readBody(req)
            .then((raw) => {
              let body = {}
              try {
                body = JSON.parse(raw || '{}')
              } catch {
                return sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
              }
              const id = String((body && body.theme) || '')
              if (!THEMES.some((t) => t.id === id)) {
                return sendJson(res, 400, {
                  ok: false,
                  error: 'unknown theme: ' + id,
                  known: THEMES.map((t) => t.id),
                })
              }
              try {
                writeThemeId(id)
              } catch (err) {
                return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
              }
              sendJson(res, 200, payload())
            })
            .catch((err) => sendJson(res, 500, { ok: false, error: String((err && err.message) || err) }))
          return
        }
        sendJson(res, 200, payload())
      },
    }),
  )

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-theme/theme.js',
      handler: (req, res) => {
        let source = ''
        try {
          source = fs.readFileSync(APPLIER_FILE, 'utf8')
        } catch (err) {
          source = '/* dsh-theme-pack applier unavailable: ' + String((err && err.message) || err) + ' */'
        }
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(source)
      },
    }),
  )

  disposers.push(
    ctx.webServer.tapIndex((html) => {
      if (html.indexOf('/dsh-theme/theme.js') !== -1) return html
      const tag = '<script defer src="/dsh-theme/theme.js"></script>'
      if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
      return html + tag
    }),
  )

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* 释放失败不影响宿主 */
      }
    }
  })
}

export { name, inject, apply }
