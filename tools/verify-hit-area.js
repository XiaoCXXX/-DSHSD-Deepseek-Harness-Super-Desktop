'use strict'

// 量化「命中测试用 610×610 拉伸」造成的误判范围。
//   node .verify/verify-hit-area.js
//
// 背景：命中测试原来把素材 drawImage 到 610×610 正方形再按 610 做坐标映射。
// 新素材是 911×1024（非正方形），拉伸后命中区域整体错位——点宠物身上
// 某些位置会被判成「点在透明区」，表现就是点击没反应。

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const mod = await import(`file:///${path.join(ROOT, 'plugins', 'dsh-desktop-pet', 'lib', 'index.js').replace(/\\/g, '/')}`)
  const handlers = {}
  mod.apply({
    webServer: { register: (r) => { handlers[r.path] = r.handler; return () => {} }, tapIndex: () => () => {} },
    credentials: { resolve: async () => undefined },
    on: () => () => {}, effect: (fn) => fn(), logger: { warn() {}, info() {} }, get: () => undefined,
  })
  let imageBytes = null
  handlers['/dsh-pet/image.png']({}, { writeHead() {}, end(b) { imageBytes = Buffer.isBuffer(b) ? b : Buffer.from(String(b)) } })

  const work = path.join(ROOT, '.verify', 'hit-area')
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'pet.png'), imageBytes)

  fs.writeFileSync(path.join(work, 'index.html'), `<!DOCTYPE html><html><body><script>
window.__run = function () {
  return new Promise(function (resolve) {
    var img = new Image()
    img.onload = function () {
      var W = img.naturalWidth, H = img.naturalHeight
      // 素材真实的 alpha 图
      var real = document.createElement('canvas')
      real.width = W; real.height = H
      var rc = real.getContext('2d')
      rc.drawImage(img, 0, 0)
      var realPx = rc.getImageData(0, 0, W, H).data
      var realAt = function (x, y) { return realPx[(y * W + x) * 4 + 3] }

      // 旧实现：拉伸到 610×610
      var oldC = document.createElement('canvas')
      oldC.width = 610; oldC.height = 610
      var oc = oldC.getContext('2d')
      oc.drawImage(img, 0, 0, 610, 610)
      var oldPx = oc.getImageData(0, 0, 610, 610).data
      var oldAt = function (x, y) { return oldPx[(y * 610 + x) * 4 + 3] }

      // 在素材上均匀采样，比较「真实是否不透明」与「旧实现是否判定为命中」
      var total = 0, realOpaque = 0, oldSaidHit = 0, falseNegative = 0, falsePositive = 0
      for (var y = 0; y < H; y += 4) {
        for (var x = 0; x < W; x += 4) {
          var isOpaque = realAt(x, y) > 10
          // 旧实现的映射：显示坐标 → 610 空间（这里显示区就等于素材，因为 img 铺满容器）
          var ox = Math.floor(x / W * 610)
          var oy = Math.floor(y / H * 610)
          if (ox < 0 || oy < 0 || ox >= 610 || oy >= 610) continue
          var saidHit = oldAt(ox, oy) > 10
          total++
          if (isOpaque) realOpaque++
          if (saidHit) oldSaidHit++
          if (isOpaque && !saidHit) falseNegative++   // 点在宠物上却判为没点中（最致命）
          if (!isOpaque && saidHit) falsePositive++   // 点在空白却判为点中
        }
      }
      resolve({ W: W, H: H, total: total, realOpaque: realOpaque, oldSaidHit: oldSaidHit, falseNegative: falseNegative, falsePositive: falsePositive })
    }
    img.src = 'pet.png'
  })
}
</script></body></html>`, 'utf8')

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const port = 9283
  const child = spawn(ELECTRON, [
    `--user-data-dir=${path.join(work, 'ud')}`, `--remote-debugging-port=${port}`,
    '--no-first-run', '--disable-gpu', '--window-size=600,600', path.join(work, 'index.html'),
  ], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {})

  let list = null
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { list = null }
    if (list && list.some((t) => t.url.includes('index.html'))) break
    list = null
  }
  if (!list) { console.error('CDP 未就绪'); child.kill(); process.exit(1) }

  const target = list.find((t) => t.url.includes('index.html'))
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS')) })
  let seq = 0
  const send = (method, params = {}, timeout = 60000) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(new Error('超时')), timeout)
    const onMessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== id) return
      clearTimeout(timer); ws.removeEventListener('message', onMessage)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const r = await send('Runtime.evaluate', { expression: 'window.__run()', returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) { console.error('求值失败:', r.exceptionDetails.exception?.description); process.exit(1) }
  const d = r.result.value

  console.log(`\n命中区域对比（素材 ${d.W}×${d.H}，采样 ${d.total} 点）\n${'─'.repeat(54)}`)
  console.log(`  素材上真正不透明的采样点: ${d.realOpaque}  (${(d.realOpaque / d.total * 100).toFixed(1)}%)`)
  console.log(`  旧实现(610×610)判为命中:  ${d.oldSaidHit}  (${(d.oldSaidHit / d.total * 100).toFixed(1)}%)`)
  console.log(`  漏判（点在宠物上却不算）: ${d.falseNegative}  (${(d.falseNegative / d.total * 100).toFixed(1)}%)`)
  console.log(`  误判（点在空白却算命中）: ${d.falsePositive}  (${(d.falsePositive / d.total * 100).toFixed(1)}%)`)
  const fnRate = d.falseNegative / Math.max(1, d.realOpaque)
  console.log(`\n  漏判率 = ${(fnRate * 100).toFixed(1)}%  ← 这就是「点击没反应」的比例`)

  ws.close()
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  process.exit(fnRate < 0.02 ? 0 : 1)
}

main().catch((e) => { console.error('验证异常：', e.message); process.exit(1) })
