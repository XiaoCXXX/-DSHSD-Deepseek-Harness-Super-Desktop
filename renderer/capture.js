'use strict'

// 全屏框选层。
//
// 只做两件事：把选择区以外的部分遮暗、把拖出来的矩形用 IPC 报回主进程。
// 坐标一律用**相对本显示器左上角的 CSS 像素**（= DIP），主进程再乘 scaleFactor
// 换算成位图像素——换算只放在一处（lib/screenshot.js 的 toImageRect），两边不重复算。
//
// 注意：本页开了 contextIsolation、没有 nodeIntegration，所以不能用 require，
// 只能走 preload.js 暴露的 window.dshClient。

;(function () {
  const api = window.dshClient
  const els = {
    top: document.getElementById('mTop'),
    bottom: document.getElementById('mBottom'),
    left: document.getElementById('mLeft'),
    right: document.getElementById('mRight'),
    sel: document.getElementById('sel'),
    size: document.getElementById('size'),
    hint: document.getElementById('hint'),
  }

  /** 提示文案由主进程按当前界面语言带过来（本页不加载 i18n 词典）。 */
  const hintText = new URLSearchParams(window.location.search).get('hint') || 'Esc'
  els.hint.textContent = hintText

  /** 小于这个尺寸就当成误触，不当一次框选。 */
  const MIN_SIDE = 6

  let dragging = false
  let startX = 0
  let startY = 0
  let rect = null
  let sent = false

  function finish(payload) {
    if (sent) return
    sent = true
    api.captureDone(payload)
  }

  function cancel() {
    if (sent) return
    sent = true
    api.captureCancel()
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

  /** 按当前选择框铺四块遮罩。 */
  function paint(sel) {
    const w = window.innerWidth
    const h = window.innerHeight
    if (!sel) {
      els.top.style.cssText = `left:0;top:0;width:${w}px;height:${h}px`
      els.bottom.style.cssText = 'display:none'
      els.left.style.cssText = 'display:none'
      els.right.style.cssText = 'display:none'
      els.sel.hidden = true
      return
    }
    const { x, y, width, height } = sel
    els.top.style.cssText = `left:0;top:0;width:${w}px;height:${y}px`
    els.bottom.style.cssText = `left:0;top:${y + height}px;width:${w}px;height:${Math.max(0, h - y - height)}px`
    els.left.style.cssText = `left:0;top:${y}px;width:${x}px;height:${height}px`
    els.right.style.cssText = `left:${x + width}px;top:${y}px;width:${Math.max(0, w - x - width)}px;height:${height}px`

    els.sel.hidden = false
    els.sel.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px`
    // 贴近屏幕边时把读数翻到框内，避免被裁掉
    els.sel.classList.toggle('flip-y', y < 26)
    els.sel.classList.toggle('flip-x', x + width > w - 60)
    els.size.textContent = `${width} × ${height}`
  }

  function rectFrom(x0, y0, x1, y1) {
    const w = window.innerWidth
    const h = window.innerHeight
    const left = clamp(Math.min(x0, x1), 0, w)
    const top = clamp(Math.min(y0, y1), 0, h)
    const right = clamp(Math.max(x0, x1), 0, w)
    const bottom = clamp(Math.max(y0, y1), 0, h)
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

  // 监听挂在 window 上：遮罩与选择框都是 pointer-events:none，
  // 指针事件本来就落在 body/html 上，不需要再 setPointerCapture，
  // 拖到窗口边缘之外也不会丢（鼠标抬起时指针仍在本窗口内）。
  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    dragging = true
    startX = event.clientX
    startY = event.clientY
    els.hint.classList.add('gone')
    rect = rectFrom(startX, startY, startX, startY)
    paint(rect)
  })

  window.addEventListener('pointermove', (event) => {
    if (!dragging) return
    rect = rectFrom(startX, startY, event.clientX, event.clientY)
    paint(rect)
  })

  window.addEventListener('pointerup', (event) => {
    if (!dragging) return
    dragging = false
    rect = rectFrom(startX, startY, event.clientX, event.clientY)
    // 太小 = 误触：回到等待状态，而不是直接取消（用户可能只是想重拖）
    if (rect.width < MIN_SIDE || rect.height < MIN_SIDE) {
      rect = null
      paint(null)
      els.hint.classList.remove('gone')
      return
    }
    paint(rect)
    finish({ rect })
  })

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    cancel()
  })
  // 双击 = 取消，与多数截图工具一致
  window.addEventListener('dblclick', () => cancel())
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel()
  })

  paint(null)
})()
