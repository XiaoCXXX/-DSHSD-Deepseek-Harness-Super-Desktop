'use strict'

// 截图功能的验证。
//
// 分两层：
//   A. 纯函数（不需要抓屏、不需要 DSH）：DPI 换算、缩放决策、图片 part 校验。
//      这三处是「错了也不会报错、只会静默出错」的地方，必须钉死。
//   B. 真实抓屏（需要 Electron + 一块屏幕）：走完整链路抓一张全屏图，
//      断言它真的是一张合规的 PNG，尺寸不超 DSH 的限制。
//
// node tools/verify-screenshot.js

delete process.env.ELECTRON_RUN_AS_NODE

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SANDBOX = path.join(ROOT, '.verify', 'screenshot')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const report = []
const note = (ok, label, value) => {
  report.push(ok)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${value === undefined ? '' : `  ${value}`}`)
}

async function main() {
  console.log(`\n截图功能验证\n${'─'.repeat(58)}`)

  // ---------------------------------------------------------------- A. 纯函数

  const shot = require('../lib/screenshot')
  const { toImageRect, fitSize, LIMITS } = shot

  // DPI 换算：这是本项目所在机器的真实情况（200% 缩放）
  const dpi2 = toImageRect({ x: 100, y: 50, width: 200, height: 120 }, 2, { width: 3120, height: 2080 })
  note(dpi2.x === 200 && dpi2.y === 100 && dpi2.width === 400 && dpi2.height === 240,
    '200% 缩放下框选矩形 ×2 换算成位图像素', JSON.stringify(dpi2))

  const dpi1 = toImageRect({ x: 10, y: 20, width: 30, height: 40 }, 1, { width: 1000, height: 800 })
  note(dpi1.x === 10 && dpi1.width === 30, '100% 缩放时原样不放大', JSON.stringify(dpi1))

  const dpi125 = toImageRect({ x: 40, y: 40, width: 80, height: 80 }, 1.25, { width: 1920, height: 1080 })
  note(dpi125.x === 50 && dpi125.width === 100, '125% 缩放换算正确', JSON.stringify(dpi125))

  // 越界：用户把鼠标拖到显示器外面，矩形会超图
  const oob = toImageRect({ x: 900, y: 900, width: 500, height: 500 }, 2, { width: 1000, height: 1000 })
  note(oob.x + oob.width <= 1000 && oob.y + oob.height <= 1000 && oob.width >= 1 && oob.height >= 1,
    '越界矩形被夹进图内且保持非空', JSON.stringify(oob))

  const neg = toImageRect({ x: -50, y: -50, width: 200, height: 200 }, 2, { width: 1000, height: 1000 })
  note(neg.x === 0 && neg.y === 0, '负坐标被夹到 0', JSON.stringify(neg))

  // 缩放：长边不超 2000，且只缩不放
  const big = fitSize({ width: 3120, height: 2080 })
  note(Math.max(big.width, big.height) <= LIMITS.maxImageDimension,
    `3120×2080 缩到长边 ≤ ${LIMITS.maxImageDimension}`, `${big.width}×${big.height}`)
  note(Math.abs(big.width / big.height - 3120 / 2080) < 0.01, '缩放保持长宽比',
    (big.width / big.height).toFixed(3))
  const small = fitSize({ width: 320, height: 200 })
  note(small.width === 320 && small.height === 200, '小图不放大（放大只会糊）', `${small.width}×${small.height}`)
  const square = fitSize({ width: 4000, height: 4000 })
  note(Math.max(square.width, square.height) <= LIMITS.maxImageDimension, '正方形超大图同样被限制',
    `${square.width}×${square.height}`)

  // ---------------------------------------------------------------- A2. 图片 part 校验

  const { imageParts, MAX_IMAGES, MAX_IMAGE_BYTES } = await import(
    `file:///${path.join(ROOT, 'plugins', 'dsh-quick-ask', 'lib', 'image-parts.js').replace(/\\/g, '/')}`)

  const png = { mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'a.png' }
  const kept = imageParts([png])
  note(kept.length === 1 && kept[0].type === 'image' && kept[0].mediaType === 'image/png',
    '合法图片被转成 image part', JSON.stringify(kept.map((p) => p.mediaType)))
  note(kept[0].name === 'a.png', '文件名透传')

  const mixed = imageParts([
    { mediaType: 'image/gif', data: 'R0lGOD' },
    { mediaType: 'text/plain', data: 'abc' },          // 类型不在白名单
    { mediaType: 'image/png', data: '' },              // 空数据
    { mediaType: 'image/webp', data: 'UklGR' },
    null,                                              // 垃圾项
    { mediaType: 'image/jpeg' },                       // 缺 data
  ])
  note(mixed.length === 2, '非法项被丢弃、合法项保留（不因一张坏图整体失败）',
    mixed.map((p) => p.mediaType).join(','))

  const tooBig = imageParts([{ mediaType: 'image/png', data: 'x'.repeat(Math.ceil(MAX_IMAGE_BYTES / 0.75) + 8) }])
  note(tooBig.length === 0, `超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 的图被丢弃`)

  const many = imageParts(Array.from({ length: 9 }, () => ({ mediaType: 'image/png', data: 'iVBORw0KGgo=' })))
  note(many.length === MAX_IMAGES, `单条消息最多 ${MAX_IMAGES} 张图`, String(many.length))

  note(imageParts(undefined).length === 0 && imageParts('nope').length === 0,
    '没有图片字段时返回空数组（老的纯文本请求不受影响）')

  // ---------------------------------------------------------------- B. 真实抓屏

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(SANDBOX, { recursive: true })

  // 用一个极小的 Electron 脚本抓一张全屏图并打印结论。
  // 注意 windowsHide 必须为 false：Node 的 windowsHide:true 会把 SW_HIDE 塞进
  // STARTUPINFO，Electron 的窗口就永远显示不出来（见 verify-overlay-drag 的同类坑）。
  const probe = path.join(SANDBOX, 'grab.js')
  fs.writeFileSync(probe, `
const { app, BrowserWindow, screen } = require('electron')
const path = require('node:path')
const shot = require(${JSON.stringify(path.join(ROOT, 'lib', 'screenshot.js'))})
const sharp = require(${JSON.stringify(path.join(ROOT, 'vendor', 'dsh', 'node_modules', 'sharp'))})
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 300, height: 200, show: false })
    const display = screen.getPrimaryDisplay()
    const result = await shot.capture({ mode: 'full' })
    // 关键：DSH 的图片准入会做**全量解码**（sharp().raw().toBuffer()），
    // 只过一遍 metadata() 是不够的 —— 头部能读、像素解不开的图会被
    // 笼统地报成 "Unsupported or malformed image data."。这里照它的做法验一遍。
    let decoded = null
    let decodeError = null
    if (result.ok && result.image) {
      try {
        const raw = await sharp(Buffer.from(result.image.data, 'base64'),
          { failOn: 'error', limitInputPixels: false }).raw().toBuffer()
        decoded = raw.length
      } catch (e) { decodeError = String(e && e.message) }
    }
    const out = {
      ok: result.ok,
      error: result.error || null,
      display: { w: display.size.width, h: display.size.height, scale: display.scaleFactor },
      decoded,
      decodeError,
      image: result.image ? {
        mediaType: result.image.mediaType,
        bytes: result.image.bytes,
        width: result.image.width,
        height: result.image.height,
        b64len: result.image.data.length,
        head: result.image.data.slice(0, 12),
      } : null,
    }
    process.stdout.write('RESULT:' + JSON.stringify(out) + '\\n')
    win.destroy()
  } catch (e) {
    process.stdout.write('RESULT:' + JSON.stringify({ ok: false, error: String(e && e.message) }) + '\\n')
  }
  setTimeout(() => app.exit(0), 200)
})
`)
  const child = spawn(ELECTRON, [probe], {
    env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d.toString() })
  child.stderr.on('data', (d) => { out += d.toString() })
  await Promise.race([new Promise((res) => child.on('exit', res)), sleep(60000)])
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }

  const line = out.split('\n').find((l) => l.startsWith('RESULT:'))
  const grabbed = line ? JSON.parse(line.slice(7)) : null
  note(Boolean(grabbed && grabbed.ok), '真实抓屏成功（desktopCapturer 拿到图）',
    grabbed ? JSON.stringify(grabbed.display) : out.slice(0, 200).replace(/\s+/g, ' '))

  if (grabbed && grabbed.ok && grabbed.image) {
    const img = grabbed.image
    note(img.head.startsWith('iVBORw0KGgo'), '编码成 PNG（魔数正确）', img.head)
    note(Math.max(img.width, img.height) <= LIMITS.maxImageDimension,
      `长边 ≤ ${LIMITS.maxImageDimension}（DSH 的硬限制）`, `${img.width}×${img.height}`)
    note(img.bytes <= LIMITS.maxImageBytes,
      `体积 ≤ ${Math.round(LIMITS.maxImageBytes / 1024 / 1024)}MB`,
      `${(img.bytes / 1024 / 1024).toFixed(2)}MB`)
    note(img.b64len > 0 && Math.abs(img.b64len * 0.75 - img.bytes) < 8,
      'base64 长度与字节数自洽', `${img.b64len} ≈ ${img.bytes}/0.75`)
    // 抓到的应该是真实屏幕内容，不是纯色空图
    note(img.bytes > 4096, '抓到的不是空白图（体积足以说明有内容）', `${img.bytes}B`)
    // 这条是整个功能的成败点：DSH 会全量解码，解不开就直接
    // 「Unsupported or malformed image data.」而拒绝整次提问。
    note(grabbed.decoded > 0, '产出的图能被 sharp 全量解码（= 能通过 DSH 的图片准入）',
      grabbed.decodeError || `${grabbed.decoded} 字节 raw`)
    note(img.width * img.height === (grabbed.decoded / 3) || img.width * img.height === (grabbed.decoded / 4),
      '解码出的像素数与声明尺寸一致',
      `${img.width}×${img.height} → ${grabbed.decoded}B`)
  }

  // ---------------------------------------------------------------- C. 框选层

  // 真实跑一遍 capture.html：用小窗口（不是全屏，不遮用户屏幕）+
  // webContents.sendInputEvent 造指针事件，检查拖出来的矩形和取消路径。
  // 这样框选层的算术与事件接线都有覆盖，而不用把全屏遮罩盖到用户屏幕上。
  const overlayProbe = path.join(SANDBOX, 'overlay.js')
  fs.writeFileSync(overlayProbe, `
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const CAPTURE_PAGE = ${JSON.stringify(path.join(ROOT, 'renderer', 'capture.html'))}
const sent = []
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 400, height: 300, frame: false, show: false,
    webPreferences: {
      preload: ${JSON.stringify(path.join(ROOT, 'preload.js'))},
      contextIsolation: true, nodeIntegration: false,
    },
  })
  win.webContents.on('ipc-message', (_e, channel, payload) => sent.push({ channel, payload }))
  await win.loadFile(${JSON.stringify(path.join(ROOT, 'renderer', 'capture.html'))}, { query: { hint: 'TEST-HINT' } })
  await new Promise((r) => setTimeout(r, 400))

  const ev = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, ...extra })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const readDom = () => win.webContents.executeJavaScript(\`(() => {
    const q = (id) => document.getElementById(id)
    return {
      hint: q('hint').textContent,
      hintGone: q('hint').classList.contains('gone'),
      selHidden: q('sel').hidden,
      sizeText: q('size').textContent,
      topH: q('mTop').style.height,
      bottomDisplay: q('mBottom').style.display,
      hasBridge: typeof window.dshClient.captureDone === 'function',
    }
  })()\`)

  // 1) 正常拖一个矩形：从 (50,40) 拖到 (250,180)
  ev('mouseDown', 50, 40, { buttons: 1 })
  for (const [x, y] of [[100, 70], [150, 100], [200, 140], [250, 180]]) { ev('mouseMove', x, y, { buttons: 1 }); await wait(30) }
  ev('mouseUp', 250, 180, { buttons: 0 })
  await wait(300)
  const afterDrag = await readDom()

  // 2) 误触：只拖 2px，应当**不**产生 done，并且退回等待状态
  const beforeTiny = sent.length
  ev('mouseDown', 300, 200, { buttons: 1 })
  ev('mouseMove', 302, 201, { buttons: 1 })
  ev('mouseUp', 302, 201, { buttons: 0 })
  await wait(300)
  const tinySent = sent.length - beforeTiny
  const afterTiny = await readDom()

  // 3) Esc 取消。必须在**新载入的页面**上测：上一段拖动已经 finish() 过，
  //    页面进入「已交付」状态，此后不再接受任何结果 —— 那是对的行为
  //    （真实运行时窗口这时已经被销毁了）。
  //    合成按键需要窗口焦点，而窗口是隐藏的，所以直接派发 DOM 键盘事件，
  //    测的是页面自己那条兜底路径（真实运行时主进程还会用 before-input-event 拦一次）。
  await win.loadFile(CAPTURE_PAGE, { query: { hint: 'TEST-HINT' } })
  await wait(400)
  const freshSent = sent.length
  await win.webContents.executeJavaScript(
    \`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))\`)
  await wait(300)
  const escSent = sent.length - freshSent

  process.stdout.write('RESULT:' + JSON.stringify({ sent, tinySent, afterDrag, afterTiny, escSent }) + '\\n')
  win.destroy()
  setTimeout(() => app.exit(0), 150)
})
`)

  const overlayChild = spawn(ELECTRON, [overlayProbe], {
    env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
  })
  let ovOut = ''
  overlayChild.stdout.on('data', (d) => { ovOut += d.toString() })
  overlayChild.stderr.on('data', (d) => { ovOut += d.toString() })
  await Promise.race([new Promise((res) => overlayChild.on('exit', res)), sleep(60000)])
  try { execFileSync('taskkill', ['/PID', String(overlayChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }

  const ovLine = ovOut.split('\n').find((l) => l.startsWith('RESULT:'))
  const ov = ovLine ? JSON.parse(ovLine.slice(7)) : null
  note(Boolean(ov), '框选层可加载并交互', ov ? '' : ovOut.slice(0, 200).replace(/\s+/g, ' '))

  if (ov) {
    const done = ov.sent.find((m) => m.channel === 'capture:done')
    note(Boolean(done), '拖动后报回 capture:done')
    if (done) {
      const r = done.payload && done.payload.rect
      // 400×300 的窗口里从 (50,40) 拖到 (250,180) → 宽 200 高 140
      note(Boolean(r) && r.x === 50 && r.y === 40 && r.width === 200 && r.height === 140,
        '框选矩形与拖动路径一致', r ? JSON.stringify(r) : 'null')
    }
    const d = ov.afterDrag || {}
    note(d.selHidden === false && d.sizeText === '200 × 140',
      '选择框可见且尺寸读数正确', `${d.sizeText} hidden=${d.selHidden}`)
    note(d.hintGone === true, '拖动开始后居中提示自动淡出')
    note(d.hint === 'TEST-HINT', '提示文案来自主进程（按界面语言传入）', d.hint)
    note(d.hasBridge === true, '框选层通过 preload 拿到 IPC 桥（没有用 require）')
    note(ov.tinySent === 0, '小于阈值的拖动视为误触，不产生结果', String(ov.tinySent))
    const t = ov.afterTiny || {}
    note(t.selHidden === true && t.hintGone === false,
      '误触后退回等待状态（选择框收起、提示重新出现）',
      `hidden=${t.selHidden} hintGone=${t.hintGone}`)
    const cancel = ov.sent.find((m) => m.channel === 'capture:cancel')
    note(Boolean(cancel) && ov.escSent > 0, 'Esc 能取消（新页面上）', `发出 ${ov.escSent} 条`)
  }

  // ---------------------------------------------------------------- A3. 历史缩略图

  // 历史里存的是缩略图而不是原图：一次截图 base64 约 0.7–1MB，历史上限 40 轮 ×
  // 每轮最多 4 张，全留着会把内存撑到上百 MB。这里验「缩略图确实变小了、
  // 而且尺寸标注还是原图的」。
  const thumbProbe = path.join(SANDBOX, 'thumb.js')
  fs.writeFileSync(thumbProbe, `
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const SHOT_THUMB_PX = 160
// 与 main.js 里的 shotThumbnail 同逻辑
function shotThumbnail(shot) {
  const image = nativeImage.createFromBuffer(Buffer.from(String(shot && shot.data || ''), 'base64'))
  if (image.isEmpty()) return null
  const size = image.getSize()
  const longest = Math.max(size.width, size.height)
  const scale = longest > SHOT_THUMB_PX ? SHOT_THUMB_PX / longest : 1
  const small = scale < 1 ? image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: 'good',
  }) : image
  return { mediaType: 'image/png', data: small.toPNG().toString('base64'), width: size.width, height: size.height }
}
app.whenReady().then(async () => {
  const src = fs.readFileSync(path.join(${JSON.stringify(SANDBOX)}, 'big.png'))
  const thumb = shotThumbnail({ mediaType: 'image/png', data: src.toString('base64') })
  const small = thumb ? Buffer.from(thumb.data, 'base64') : null
  process.stdout.write('RESULT:' + JSON.stringify({
    ok: Boolean(thumb),
    originalBytes: src.length,
    thumbBytes: small ? small.length : 0,
    originalSize: thumb ? [thumb.width, thumb.height] : null,
    thumbSize: small ? nativeImage.createFromBuffer(small).getSize() : null,
    // 空/坏数据必须返回 null 而不是抛错
    empty: shotThumbnail({ mediaType: 'image/png', data: '' }),
    junk: shotThumbnail({ mediaType: 'image/png', data: 'bm90YW5pbWFnZQ==' }),
  }) + '\\n')
  setTimeout(() => app.exit(0), 120)
})
`)

  // 先抓一张真图存到沙箱给缩略图测试用
  const grabProbe = path.join(SANDBOX, 'grab-for-thumb.js')
  fs.writeFileSync(grabProbe, `
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const shot = require(${JSON.stringify(path.join(ROOT, 'lib', 'screenshot.js'))})
app.whenReady().then(async () => {
  const r = await shot.capture({ mode: 'full' })
  if (r.ok) fs.writeFileSync(path.join(${JSON.stringify(SANDBOX)}, 'big.png'), Buffer.from(r.image.data, 'base64'))
  process.stdout.write('RESULT:' + JSON.stringify({ ok: r.ok }) + '\\n')
  setTimeout(() => app.exit(0), 120)
})
`)
  const grabChild = spawn(ELECTRON, [grabProbe], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
  await Promise.race([new Promise((res) => grabChild.on('exit', res)), sleep(60000)])
  try { execFileSync('taskkill', ['/PID', String(grabChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }

  const thumbChild = spawn(ELECTRON, [thumbProbe], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
  let thOut = ''
  thumbChild.stdout.on('data', (d) => { thOut += d.toString() })
  thumbChild.stderr.on('data', (d) => { thOut += d.toString() })
  await Promise.race([new Promise((res) => thumbChild.on('exit', res)), sleep(60000)])
  try { execFileSync('taskkill', ['/PID', String(thumbChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }

  const thLine = thOut.split('\n').find((l) => l.startsWith('RESULT:'))
  const th = thLine ? JSON.parse(thLine.slice(7)) : null
  note(Boolean(th && th.ok), '缩略图生成成功', th ? `${th.originalBytes}B → ${th.thumbBytes}B` : thOut.slice(0, 160).replace(/\s+/g, ' '))
  if (th && th.ok) {
    note(th.thumbBytes < th.originalBytes, '缩略图确实比原图小',
      `${(th.originalBytes / 1024).toFixed(0)}KB → ${(th.thumbBytes / 1024).toFixed(0)}KB`)
    note(Math.max(th.thumbSize.width, th.thumbSize.height) <= 160, '缩略图长边 ≤ 160px',
      `${th.thumbSize.width}×${th.thumbSize.height}`)
    note(th.originalSize[0] > 160 && th.originalSize[1] > 0, '尺寸标注记的是原图尺寸（不是缩略图）',
      `${th.originalSize[0]}×${th.originalSize[1]}`)
    note(th.empty === null && th.junk === null, '空数据/垃圾数据返回 null 而不是抛错')
  }

  const failed = report.filter((ok) => !ok).length
  console.log(`${'─'.repeat(58)}\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('验证异常：', e.message); process.exit(1) })
