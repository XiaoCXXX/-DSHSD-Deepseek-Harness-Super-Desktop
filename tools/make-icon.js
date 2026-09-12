'use strict'

// 从宠物素材生成多尺寸 .ico，供窗口 / 托盘 / 快捷方式 / 安装程序使用。
//   node tools/run-electron.js tools/make-icon.js
//
// 与旧版的区别：
//   1. 源图换成随包宠物素材（原来找的是已删除的 DSniang1.png）
//   2. 新素材是**竖幅**（911×1024），而图标必须是正方形。
//      直接缩放会把人压扁，所以这里**按内容包围盒取一个正方形区域**再缩放：
//      以「头部 + 举的牌子」为主体，头顶留一点、牌子切掉一部分，
//      这样小尺寸下也能看清脸。
//   3. 牌子上写项目简称 DSHSD —— 留白不放东西会显得空，
//      放字之后缩到 32px 仍能看出是个「举牌的形象」。

const fs = require('node:fs')
const path = require('node:path')
const { app, nativeImage, BrowserWindow } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SOURCE = path.join(ROOT, 'plugins', 'dsh-desktop-pet', 'assets', 'pet.png')
const TARGET = path.join(ROOT, 'assets', 'icon.ico')
const BOARD_TEXT = 'DSHSD'

app.whenReady().then(async () => {
  if (!fs.existsSync(SOURCE)) {
    console.error(`找不到素材：${SOURCE}`)
    app.exit(1)
    return
  }

  // 用隐藏窗口 + canvas 做合成：需要按「内容包围盒」取正方形区域，
  // nativeImage 没有裁剪 API，用 Chromium 画最直接。
  const win = new BrowserWindow({ show: false, width: 1200, height: 1200, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<html><body></body></html>')

  const dataUrl = `data:image/png;base64,${fs.readFileSync(SOURCE).toString('base64')}`
  const composed = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(dataUrl)}
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej })

    const W = img.naturalWidth, H = img.naturalHeight
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const ctx = cv.getContext('2d')
    ctx.drawImage(img, 0, 0)

    // 内容包围盒（按 alpha）
    const px = ctx.getImageData(0, 0, W, H).data
    let minX = W, minY = H, maxX = -1, maxY = -1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (px[(y * W + x) * 4 + 3] > 24) {
          if (x < minX) minX = x; if (y < minY) minY = y
          if (x > maxX) maxX = x; if (y > maxY) maxY = y
        }
      }
    }

    // 取正方形区域。
    //
    // 素材是竖幅（911×1024），图标必须正方形，所以得裁。裁哪里是取舍：
    //   - 贴合内容裁：脸最大，但 16/24px 下只剩一团蓝 + 一条白，认不出「举牌」
    //   - **留出边距裁**：整体略小，但「人物 + 牌子」的轮廓在小尺寸下也成立
    // 实测选后者（第一版贴太满，16px 完全糊成一团）。
    //
    // 边长 = 内容尺寸 × (1 + 2×边距)，再夹到素材短边以内。
    const PAD = 0.12
    const contentW = (maxX - minX + 1) * (1 + PAD * 2)
    const contentH = (maxY - minY + 1) * (1 + PAD * 2)
    const side = Math.min(W, H, Math.max(contentW, contentH))
    const sx = Math.round(Math.max(0, Math.min(W - side, (minX + maxX) / 2 - side / 2)))
    const sy = Math.round(Math.max(0, Math.min(H - side, (minY + maxY) / 2 - side / 2)))

    const out = document.createElement('canvas')
    out.width = Math.max(side, 512); out.height = Math.max(side, 512)
    const octx = out.getContext('2d')
    octx.imageSmoothingEnabled = true
    octx.imageSmoothingQuality = 'high'
    // 圆角底：纯透明背景的图在浅色任务栏上容易「飘」，给一层淡淡的圆角底
    const S = out.width
    const r = S * 0.22
    octx.beginPath()
    octx.moveTo(r, 0); octx.lineTo(S - r, 0); octx.quadraticCurveTo(S, 0, S, r)
    octx.lineTo(S, S - r); octx.quadraticCurveTo(S, S, S - r, S)
    octx.lineTo(r, S); octx.quadraticCurveTo(0, S, 0, S - r)
    octx.lineTo(0, r); octx.quadraticCurveTo(0, 0, r, 0)
    octx.closePath()
    const grad = octx.createLinearGradient(0, 0, S, S)
    grad.addColorStop(0, '#dbe6ff')
    grad.addColorStop(1, '#b9cdfa')
    octx.fillStyle = grad
    octx.fill()

    octx.drawImage(cv, sx, sy, side, side, 0, 0, S, S)

    // 在牌子区域写项目简称：字要落在牌子的白色区域里
    // 牌子的位置由 tools/prepare-pet 量过（在 911×1024 里 left 24% top 64.3% w 52% h 34.8%）
    // 换到这里的裁剪坐标：把牌子中心换算到 out 的坐标系
    const boardCxInSrc = W * (0.24 + 0.52 / 2)
    const boardCyInSrc = H * (0.643 + 0.348 / 2)
    const bx = (boardCxInSrc - sx) / side * S
    const by = (boardCyInSrc - sy) / side * S
    const bw = (W * 0.52) / side * S
    const bh = (H * 0.348) / side * S

    // 只在牌子确实还落在画布里时才写（正方形裁剪可能把它切没了）
    if (by > 0 && by < S && bx > 0 && bx < S) {
      octx.save()
      octx.textAlign = 'center'
      octx.textBaseline = 'middle'
      const fontPx = Math.max(8, Math.round(bh * 0.42))
      octx.font = '800 ' + fontPx + 'px system-ui, "Segoe UI", sans-serif'
      octx.fillStyle = '#41548a'
      octx.fillText(${JSON.stringify(BOARD_TEXT)}, bx, by)
      octx.restore()
    }

    return out.toDataURL('image/png')
  })()`)

  win.destroy()

  const base = nativeImage.createFromDataURL(composed)
  if (base.isEmpty()) {
    console.error('合成结果无法解码')
    app.exit(1)
    return
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const entries = sizes.map((size) => {
    const resized = base.resize({ width: size, height: size, quality: 'best' })
    return { size, png: resized.toPNG() }
  })

  // ICO 容器：ICONDIR + 每条目 16 字节目录项 + 各尺寸 PNG 数据（Vista+ 支持 PNG 条目）
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  let offset = 6 + entries.length * 16
  const directory = []
  for (const entry of entries) {
    const item = Buffer.alloc(16)
    const dimension = entry.size >= 256 ? 0 : entry.size
    item.writeUInt8(dimension, 0)
    item.writeUInt8(dimension, 1)
    item.writeUInt8(0, 2)
    item.writeUInt8(0, 3)
    item.writeUInt16LE(1, 4)
    item.writeUInt16LE(32, 6)
    item.writeUInt32LE(entry.png.length, 8)
    item.writeUInt32LE(offset, 12)
    offset += entry.png.length
    directory.push(item)
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true })
  fs.writeFileSync(TARGET, Buffer.concat([header, ...directory, ...entries.map((e) => e.png)]))
  console.log(`已生成 ${path.relative(ROOT, TARGET)}（${entries.length} 个尺寸，${fs.statSync(TARGET).size} 字节）`)
  app.exit(0)
})
