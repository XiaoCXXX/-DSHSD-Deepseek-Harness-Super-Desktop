'use strict'

// 从 DSH 凭据库读取 cookie 签名密钥，自行签发浏览器会话 cookie。
//
// 这样客户端即使面对一个「不是自己启动的」dsh web 实例，也能直接接管，
// 无需用户去终端里翻 ?token=... 的启动 URL。
//
// 协议（见 @deepseek-ai/dsh-client-connection）：
//   cookie 名 = "dsh-auth-" + base64url(sha256(authority))
//   cookie 值 = "v1." + base64url(JSON({version,authority,issuedAt,expiresAt}))
//                     + "." + base64url(HMAC-SHA256(secret, <中间的 base64url 串>))
//   密钥 = $DSH_HOME/.credentials.yaml 中 client-connection/browser-session 记录的 payload.secret

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SECRET_BYTES = 32
const COOKIE_PREFIX = 'dsh-auth-'
const COOKIE_PAYLOAD_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value) {
  if (typeof value !== 'string') return undefined
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function credentialsFile() {
  return path.join(dshHome(), '.credentials.yaml')
}

/** 规范化 authority，与服务端 `new URL('http://' + host).host` 保持一致。 */
function authorityFor(host, port) {
  try {
    return new URL(`http://${host}:${port}`).host
  } catch {
    return undefined
  }
}

/** 读取 32 字节签名密钥；找不到就返回 undefined（调用方降级处理）。 */
function readSecret() {
  let yaml
  try {
    yaml = require('js-yaml')
  } catch {
    return undefined
  }
  let doc
  try {
    doc = yaml.load(fs.readFileSync(credentialsFile(), 'utf8'))
  } catch {
    return undefined
  }
  const records = doc && typeof doc === 'object' ? doc.records : undefined
  if (!records || typeof records !== 'object') return undefined

  const found = []
  for (const [key, record] of Object.entries(records)) {
    if (!record || typeof record !== 'object') continue
    const raw = record?.payload?.secret ?? record?.secret
    const bytes = decodeBase64Url(raw)
    if (!bytes || bytes.byteLength !== SECRET_BYTES) continue
    found.push({ key, bytes, preferred: String(key).includes('browser-session') })
  }
  const chosen = found.find((entry) => entry.preferred) || found[0]
  return chosen?.bytes
}

/**
 * 签发一个可用的浏览器会话 cookie。
 * @returns {{name:string,value:string,expiresAt:number,authority:string}|undefined}
 */
function mintSessionCookie(host, port, maxAgeDays = 30) {
  const secret = readSecret()
  if (!secret) return undefined
  const authority = authorityFor(host, port)
  if (!authority) return undefined

  const now = Date.now()
  const expiresAt = now + maxAgeDays * 24 * 60 * 60 * 1000
  const payload = {
    version: COOKIE_PAYLOAD_VERSION,
    authority,
    issuedAt: now,
    expiresAt,
  }
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signature = crypto.createHmac('sha256', secret).update(body).digest()
  const name = COOKIE_PREFIX + encodeBase64Url(crypto.createHash('sha256').update(authority).digest())
  const value = `v1.${body}.${encodeBase64Url(signature)}`
  return { name, value, expiresAt, authority }
}

module.exports = { mintSessionCookie, authorityFor, dshHome, credentialsFile }
