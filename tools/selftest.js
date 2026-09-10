'use strict'

// 自检脚本：不依赖 Electron，验证客户端依赖的关键能力。
//   node tools/selftest.js [端口]

const http = require('node:http')
const { findNodeBin, findDshBin, findWhaleAssets } = require('../lib/dsh-locator')
const { mintSessionCookie } = require('../lib/auth-cookie')

const port = Number(process.argv[2] || 3080)

function request(path, cookie) {
  return new Promise((resolve) => {
    const headers = cookie ? { Cookie: `${cookie.name}=${cookie.value}` } : {}
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', timeout: 4000, headers },
      (res) => {
        res.resume()
        resolve({ status: res.statusCode })
      },
    )
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: '超时' }) })
    req.on('error', (e) => resolve({ status: 0, error: e.message }))
    req.end()
  })
}

;(async () => {
  const results = []
  const ok = (label, value) => results.push([true, label, value])
  const bad = (label, value) => results.push([false, label, value])

  const node = findNodeBin()
  node ? ok('node 可执行文件', node) : bad('node 可执行文件', '未找到')

  const dsh = findDshBin()
  dsh ? ok('dsh bin.js', dsh) : bad('dsh bin.js', '未找到')

  const assets = findWhaleAssets()
  assets ? ok('鲸鱼挂件资源', assets) : bad('鲸鱼挂件资源', '未找到')

  const cookie = mintSessionCookie('127.0.0.1', port)
  cookie
    ? ok('签发会话 cookie', `${cookie.name}（authority=${cookie.authority}）`)
    : bad('签发会话 cookie', '读不到签名密钥')

  const anon = await request('/')
  anon.status === 401 || anon.status === 200
    ? ok(`端口 ${port} 服务可达`, `匿名 GET / -> ${anon.status}`)
    : bad(`端口 ${port} 服务可达`, anon.error || `status=${anon.status}`)

  if (cookie) {
    const authed = await request('/', cookie)
    authed.status === 200
      ? ok('用签发 cookie 认证', `GET / -> 200`)
      : bad('用签发 cookie 认证', `GET / -> ${authed.status}${authed.error ? ` (${authed.error})` : ''}`)
  }

  console.log(`\nDSH 客户端自检（端口 ${port}）\n${'─'.repeat(52)}`)
  for (const [passed, label, value] of results) {
    console.log(`${passed ? '  ✅' : '  ❌'} ${label.padEnd(18, '　')} ${value}`)
  }
  const failed = results.filter(([passed]) => !passed).length
  console.log(`${'─'.repeat(52)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
})()
