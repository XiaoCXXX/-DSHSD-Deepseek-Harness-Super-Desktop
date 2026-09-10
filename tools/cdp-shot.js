'use strict'

// 通过 CDP 给运行中的客户端窗口截图（开发期自检用）。
//   node tools/cdp-shot.js <目标URL片段> <输出png> [宽] [高]

const fs = require('node:fs')

const [, , match, out, w, h] = process.argv

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const target = list.find((t) => t.type === 'page' && t.url.includes(match))
  if (!target) {
    console.error(`未找到匹配 "${match}" 的目标，现有：`)
    for (const t of list) console.error(`  ${t.type} ${t.url}`)
    process.exit(1)
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let seq = 0
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        ws.removeEventListener('message', onMessage)
        resolve(msg.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  if (w && h) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: Number(w),
      height: Number(h),
      deviceScaleFactor: 1,
      mobile: false,
    })
  }
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  fs.writeFileSync(out, Buffer.from(result.data, 'base64'))
  console.log(`已保存 ${out}（目标：${target.title}）`)
  ws.close()
}

main().catch((error) => {
  console.error('截图失败：', error.message)
  process.exit(1)
})
