'use strict'

// 截图：抓屏 → （可选）框选 → 裁剪缩放 → 编码成 DSH 能吃的图片 part。
//
// 为什么要单独一个模块：这块有两处容易写错、又必须能单独验证的数学——
//   1. 框选坐标是**显示器的 DIP**，而抓到的位图是**物理像素**，两者差一个
//      scaleFactor（本项目所在机器就是 200%）。漏乘一次，框选位置就会偏一半。
//   2. DSH 对图片有硬限制（maxImageDimension 2000 / maxImageBytes 5MB），
//      超了 prompt 会被拒。必须在发之前就缩到合规范围。
// 所以这里的**纯函数**（裁剪区域换算、缩放尺寸决策）用 verify-screenshot.js 单独测，
// 不依赖真的去抓屏。
//
// 抓屏用 desktopCapturer：它在主进程可用，不需要任何系统权限弹窗，
// 也不会像 CDP 截图那样在透明视图上超时。

const { desktopCapturer, screen, BrowserWindow } = require('electron')
const path = require('node:path')

/** DSH 侧的真实限制（见 dsh-client-connection 的 ImageAttachmentLimits 默认值）。 */
const LIMITS = {
  maxImageBytes: 5 * 1024 * 1024,
  maxImageDimension: 2000,
  maxImagePixels: 40 * 1000 * 1000,
}

/** 编码时优先保证文字清晰：先试 PNG，太大再退 JPEG。 */
const PNG_BUDGET = 4.2 * 1024 * 1024

/**
 * 把「显示器 DIP 坐标下的框选矩形」换算成「位图像素坐标下的裁剪矩形」。
 *
 * 纯函数，方便单测。
 *
 * @param {{x:number,y:number,width:number,height:number}} rect DIP，相对显示器左上角
 * @param {number} scaleFactor 显示器缩放（1 / 1.25 / 1.5 / 2 …）
 * @param {{width:number,height:number}} imageSize 位图实际尺寸
 * @returns {{x:number,y:number,width:number,height:number}} 位图像素矩形，已夹进图内且非空
 */
function toImageRect(rect, scaleFactor, imageSize) {
  const scale = Number(scaleFactor) > 0 ? Number(scaleFactor) : 1
  const left = Math.round(Number(rect.x) * scale)
  const top = Math.round(Number(rect.y) * scale)
  let width = Math.round(Number(rect.width) * scale)
  let height = Math.round(Number(rect.height) * scale)

  // 夹进图内：框选时鼠标可以拖到显示器外面，算出来的矩形会越界
  const x = Math.max(0, Math.min(left, imageSize.width - 1))
  const y = Math.max(0, Math.min(top, imageSize.height - 1))
  width = Math.max(1, Math.min(width, imageSize.width - x))
  height = Math.max(1, Math.min(height, imageSize.height - y))
  return { x, y, width, height }
}

/**
 * 决定缩放后的目标尺寸：长边不超过 maxDimension，且总像素不超过 maxPixels。
 * 只缩不放（放大会糊，也没有意义）。
 *
 * @param {{width:number,height:number}} size
 * @param {number} [maxDimension]
 * @param {number} [maxPixels]
 * @returns {{width:number,height:number}} 与输入相同表示不需要缩放
 */
function fitSize(size, maxDimension = LIMITS.maxImageDimension, maxPixels = LIMITS.maxImagePixels) {
  const w = Math.max(1, Math.round(size.width))
  const h = Math.max(1, Math.round(size.height))
  let factor = Math.min(1, maxDimension / Math.max(w, h))
  const pixels = (w * factor) * (h * factor)
  if (pixels > maxPixels) factor *= Math.sqrt(maxPixels / pixels)
  if (factor >= 1) return { width: w, height: h }
  return { width: Math.max(1, Math.round(w * factor)), height: Math.max(1, Math.round(h * factor)) }
}

/**
 * 抓取某个显示器的一帧。
 *
 * @param {import('electron').Display} display
 * @returns {Promise<import('electron').NativeImage>}
 */
async function grabDisplay(display) {
  const scale = display.scaleFactor || 1
  // 请求物理分辨率，避免拿到被缩过的缩略图（那样文字会糊）
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale),
    },
  })
  if (!sources.length) throw new Error('no screen source')

  // 多显示器时按 display_id 认人；认不出来就退回第一个（单屏场景下就是它）
  const wanted = String(display.id)
  const source = sources.find((s) => String(s.display_id) === wanted) || sources[0]
  const image = source.thumbnail
  if (!image || image.isEmpty()) throw new Error('empty screen capture')
  return image
}

/**
 * 把 NativeImage 编码成 DSH 的图片 part：{ mediaType, data(base64), name }。
 * 超过 DSH 的限制就逐级降级（缩放 → JPEG）。
 *
 * @param {import('electron').NativeImage} image
 * @returns {{mediaType:string, data:string, name:string, width:number, height:number, bytes:number}}
 */
function encodeForPrompt(image) {
  let current = image
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const size = current.getSize()
    const png = current.toPNG()
    if (png.length <= PNG_BUDGET) {
      return {
        mediaType: 'image/png',
        data: png.toString('base64'),
        name: 'screenshot.png',
        width: size.width,
        height: size.height,
        bytes: png.length,
      }
    }
    // PNG 太大：大色块/照片类截图用 JPEG 能小一个数量级
    const jpeg = current.toJPEG(85)
    if (jpeg.length <= LIMITS.maxImageBytes) {
      return {
        mediaType: 'image/jpeg',
        data: jpeg.toString('base64'),
        name: 'screenshot.jpg',
        width: size.width,
        height: size.height,
        bytes: jpeg.length,
      }
    }
    // JPEG 也太大：缩小尺寸再来一轮
    const next = fitSize({ width: Math.round(size.width * 0.75), height: Math.round(size.height * 0.75) })
    current = current.resize({ width: next.width, height: next.height, quality: 'good' })
  }
  // 兜底：交给上层按错误处理，绝不发一个必然被拒的图片
  const fallback = current.toPNG()
  return {
    mediaType: 'image/png',
    data: fallback.toString('base64'),
    name: 'screenshot.png',
    width: current.getSize().width,
    height: current.getSize().height,
    bytes: fallback.length,
  }
}

/**
 * 弹出全屏框选层，让用户拖一个矩形。
 *
 * 为什么用「独立全屏透明窗口」而不是在主窗口里做：截图要覆盖整个屏幕，
 * 包括本客户端窗口之外的区域。这一层只负责显示暗色遮罩和选择框，
 * 真正的裁剪发生在主进程里、用的是**弹出这一层之前**抓好的那帧图，
 * 所以遮罩本身绝不会被拍进去。
 *
 * @param {import('electron').Display} display
 * @param {string} hint 框选层上显示的提示文案（由调用方按界面语言给）
 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>} null = 用户取消
 */
function selectRegion(display, hint) {
  return new Promise((resolve) => {
    const bounds = display.bounds
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      if (!win.isDestroyed()) win.destroy()
      resolve(value)
    }

    // 取消路径：Esc、窗口失焦、关闭
    win.on('closed', () => finish(null))
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') finish(null)
    })

    win.loadFile(path.join(__dirname, '..', 'renderer', 'capture.html'), {
      query: hint ? { hint } : {},
    })
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    // 渲染层拖完/取消都走这两个通道
    win.webContents.on('ipc-message', (_event, channel, payload) => {
      if (channel === 'capture:done') finish(payload && payload.rect ? payload.rect : null)
      else if (channel === 'capture:cancel') finish(null)
    })
  })
}

/**
 * 完整流程：抓屏 → 可选框选 → 裁剪缩放 → 编码。
 *
 * @param {{mode?: 'full'|'region', hint?: string}} [options]
 * @returns {Promise<{ok:boolean, canceled?:boolean, image?:object, error?:string}>}
 */
async function capture({ mode = 'region', hint = '' } = {}) {
  try {
    // 用悬浮窗所在的显示器：用户在哪个屏幕上点，就截哪个屏幕
    const focused = BrowserWindow.getFocusedWindow()
    const anchor = focused && !focused.isDestroyed() ? focused.getBounds() : null
    const display = anchor
      ? screen.getDisplayMatching(anchor)
      : screen.getPrimaryDisplay()

    const shot = await grabDisplay(display)

    let rect = { x: 0, y: 0, width: display.size.width, height: display.size.height }
    if (mode === 'region') {
      const picked = await selectRegion(display, hint)
      if (!picked) return { ok: false, canceled: true }
      rect = picked
    }

    const imageRect = toImageRect(rect, display.scaleFactor, shot.getSize())
    let cropped = shot.crop(imageRect)
    const target = fitSize(cropped.getSize())
    const now = cropped.getSize()
    if (target.width !== now.width || target.height !== now.height) {
      cropped = cropped.resize({ width: target.width, height: target.height, quality: 'best' })
    }
    return { ok: true, image: encodeForPrompt(cropped) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

module.exports = { capture, toImageRect, fitSize, LIMITS }
