'use strict'

// 从挂件的鲸鱼 PNG 生成多尺寸 .ico，供窗口/托盘/快捷方式使用。
//   electron tools/make-icon.js

const fs = require('node:fs')
const path = require('node:path')
const { app, nativeImage } = require('electron')
const { findWhaleAssets } = require('../lib/dsh-locator')

app.whenReady().then(() => {
  const assets = findWhaleAssets()
  const source = assets ? path.join(assets, 'DSniang1.png') : null
  if (!source || !fs.existsSync(source)) {
    console.error('找不到鲸鱼 PNG，跳过图标生成')
    app.exit(1)
    return
  }

  const image = nativeImage.createFromPath(source)
  if (image.isEmpty()) {
    console.error('鲸鱼 PNG 无法解码')
    app.exit(1)
    return
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const entries = sizes.map((size) => {
    const resized = size === 256 ? image : image.resize({ width: size, height: size, quality: 'best' })
    return { size, png: resized.toPNG() }
  })

  // ICO 容器：ICONDIR + 每条目 16 字节目录项 + 各尺寸 PNG 数据（Vista+ 支持 PNG 条目）
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = icon
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

  const target = path.join(__dirname, '..', 'assets', 'icon.ico')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, Buffer.concat([header, ...directory, ...entries.map((e) => e.png)]))
  console.log(`已生成 ${target}（${entries.length} 个尺寸，${fs.statSync(target).size} 字节）`)
  app.exit(0)
})
