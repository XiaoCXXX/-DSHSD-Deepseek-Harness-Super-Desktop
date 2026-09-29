'use strict'

// 便携悬浮窗渲染进程：只有「悬浮控制台 + 可以打字的气泡」。
//
// 回答由主进程经 IPC 流式推过来（'quick:event'），这里只负责显示：
//   提问 → 流式正文（表示还在跑）→ 一句话简答 + 「查看完整回答」。
// 正文与简答都只当作纯文本渲染，绝不拼 innerHTML。

;(function () {
  const api = window.dshClient
  const t = (key, params) => window.__dshI18n.t(key, params)

  const els = {
    head: document.getElementById('head'),
    dot: document.getElementById('dot'),
    state: document.getElementById('state'),
    balance: document.getElementById('balance'),
    start: document.getElementById('btnStart'),
    stop: document.getElementById('btnStop'),
    restart: document.getElementById('btnRestart'),
    openDsh: document.getElementById('btnOpenDsh'),
    hide: document.getElementById('btnHide'),
    thread: document.getElementById('thread'),
    empty: document.getElementById('empty'),
    input: document.getElementById('input'),
    send: document.getElementById('btnSend'),
    shots: document.getElementById('shots'),
    shotRegion: document.getElementById('btnShotRegion'),
    shotFull: document.getElementById('btnShotFull'),
  }

  /** 会话内的问答轮次；主进程是唯一权威，这里保留一份用于重绘。 */
  let turns = []
  let running = false
  let lastState = { state: 'stopped' }

  // ------------------------------------------------------------ 渲染

  function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function renderTurn(turn) {
    const wrap = el('div', 'turn')
    wrap.dataset.id = turn.id

    const ask = el('div', 'ask')
    // 附过的图要留在对话里：不然回头看只剩一句问题，不知道当时发的哪张图
    const shots = Array.isArray(turn.images) ? turn.images : []
    for (const shot of shots) {
      if (!shot || !shot.data) continue
      const img = document.createElement('img')
      img.className = 'ask-shot'
      img.src = `data:${shot.mediaType};base64,${shot.data}`
      img.alt = ''
      ask.appendChild(img)
    }
    if (turn.question) ask.appendChild(document.createTextNode(turn.question))
    wrap.appendChild(ask)

    const reply = el('div', 'reply')
    if (turn.status === 'failed') {
      reply.classList.add('failed')
      reply.textContent = turn.error || t('quick.failed')
    } else if (turn.summary) {
      // 拿到简答：正文折叠掉，只留一句话
      reply.textContent = turn.summary
    } else if (turn.answer) {
      reply.classList.add('streaming')
      reply.textContent = turn.answer
      reply.appendChild(el('span', 'caret', '▌'))
    } else {
      reply.classList.add('streaming')
      reply.textContent = t('quick.thinking')
      reply.appendChild(el('span', 'caret', '▌'))
    }
    wrap.appendChild(reply)

    const foot = el('div', 'reply-foot')
    if (turn.status === 'running') {
      foot.appendChild(el('span', null, t('quick.running')))
    } else {
      foot.appendChild(el('span', null, turn.summary ? t('quick.summaryLabel') : ''))
      const view = el('button', null, t('quick.viewFull'))
      view.addEventListener('click', () => api.quickOpenInDsh(turn.id))
      foot.appendChild(view)
    }
    wrap.appendChild(foot)

    return wrap
  }

  function render() {
    els.thread.textContent = ''
    const visible = turns.slice(-30)
    els.empty.hidden = visible.length > 0
    if (els.empty.parentNode !== els.thread) els.thread.appendChild(els.empty)
    if (visible.length === 0) {
      els.thread.appendChild(els.empty)
      return
    }
    for (const turn of visible) els.thread.appendChild(renderTurn(turn))
    els.thread.scrollTop = els.thread.scrollHeight
  }

  function findTurn(id) {
    return turns.find((turn) => turn.id === id) || null
  }

  // ------------------------------------------------------------ 主题

  /**
   * 悬浮窗是**独立窗口**，不会继承主窗口的 DOM，所以必须自己把主题打到 body 上。
   * theme-tokens.css 是靠 body[data-theme="..."] 出颜色的——不打这个属性，
   * 所有主题规则都匹配不上，悬浮窗就永远是默认外观。
   */
  function applyTheme(theme, animate = false) {
    const next = theme || 'dsh-white-blue'
    if (document.body.dataset.theme === next) return
    if (animate) {
      document.body.classList.add('theme-anim')
      clearTimeout(applyTheme._timer)
      applyTheme._timer = setTimeout(() => document.body.classList.remove('theme-anim'), 340)
    }
    document.body.dataset.theme = next
  }

  // ------------------------------------------------------------ 服务状态

  function applyState(state) {
    if (!state) return
    applyTheme(state.config && state.config.theme, true)
    lastState = state.server || lastState
    const label = t(`state.${lastState.state}`)
    els.state.textContent = label
    els.dot.className = `dot ${lastState.state}`
    const amount = state.balance
      ? `${state.balance.currency || ''} ${Number(state.balance.totalBalance).toFixed(2)}`.trim()
      : '--'
    els.balance.textContent = amount

    const active = lastState.state === 'running' || lastState.state === 'external'
    const busy = lastState.state === 'starting' || lastState.state === 'stopping'
    els.start.disabled = active || busy
    els.stop.disabled = !active && !busy
    els.restart.disabled = busy
  }

  // ------------------------------------------------------------ 截图

  /**
   * 待发送的截图。用数组而不是单张：多截几张再一起问是很自然的用法
   * （比如「对比这两张图」）。
   */
  let pending = []

  const dataUrl = (shot) => `data:${shot.mediaType};base64,${shot.data}`

  function renderShots() {
    els.shots.textContent = ''
    els.shots.hidden = pending.length === 0
    pending.forEach((shot, index) => {
      const box = el('div', 'shot')
      const img = document.createElement('img')
      img.src = dataUrl(shot)
      img.alt = ''
      box.appendChild(img)
      box.appendChild(el('span', 'shot-meta', `${shot.width}×${shot.height}`))
      const x = el('button', 'shot-x', '✕')
      x.type = 'button'
      x.title = t('shot.remove')
      x.addEventListener('click', () => {
        pending.splice(index, 1)
        renderShots()
      })
      box.appendChild(x)
      els.shots.appendChild(box)
    })
  }

  async function grab(mode) {
    if (running) return
    els.shotRegion.disabled = true
    els.shotFull.disabled = true
    try {
      const result = await api.captureScreen(mode)
      if (!result || result.ok === false) {
        if (result && result.canceled) return
        quickError((result && result.error) || t('shot.failed', { message: '' }))
        return
      }
      pending.push(result.image)
      renderShots()
      els.input.focus()
    } finally {
      els.shotRegion.disabled = false
      els.shotFull.disabled = false
    }
  }

  /** 截图相关的失败不走对话列表，直接在状态行提示一下就够了 */
  function quickError(message) {
    els.state.textContent = message
    clearTimeout(quickError._timer)
    quickError._timer = setTimeout(() => {
      const label = t(`state.${lastState.state}`)
      els.state.textContent = label
    }, 2600)
  }

  els.shotRegion.addEventListener('click', () => grab('region'))
  els.shotFull.addEventListener('click', () => grab('full'))

  // ------------------------------------------------------------ 提问

  function autoGrow() {
    els.input.style.height = 'auto'
    els.input.style.height = `${Math.min(els.input.scrollHeight, 96)}px`
  }

  async function submit() {
    const question = els.input.value.trim()
    // 允许只发图不问字：模型会自己看图
    if (running) return
    if (!question && !pending.length) {
      quickError(t('shot.needSomething'))
      return
    }
    const images = pending
    els.input.value = ''
    pending = []
    renderShots()
    autoGrow()
    running = true
    els.send.disabled = true
    const result = await api.quickAsk({ question, images })
    if (result && result.ok === false) {
      running = false
      els.send.disabled = false
      turns.push({
        id: result.requestId || `local-${Date.now()}`,
        question,
        images,
        status: 'failed',
        error: result.error || t('quick.failed'),
      })
      render()
    }
  }

  els.send.addEventListener('click', submit)
  els.input.addEventListener('input', autoGrow)
  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  })

  // ------------------------------------------------------------ 控制台按钮

  els.start.addEventListener('click', () => api.start())
  els.stop.addEventListener('click', () => api.stop())
  els.restart.addEventListener('click', () => api.restart())
  els.openDsh.addEventListener('click', () => api.quickOpenInDsh())
  els.hide.addEventListener('click', () => api.closeBubble())

  // ------------------------------------------------------------ 事件

  api.onState(applyState)

  api.onQuickEvent((event) => {
    if (!event || typeof event !== 'object') return
    const turn = findTurn(event.id)

    if (event.type === 'start') {
      if (!turn) {
        turns.push({
          id: event.id,
          question: event.question || '',
          images: Array.isArray(event.images) ? event.images : [],
          status: 'running',
          answer: '',
        })
      }
    } else if (event.type === 'answer') {
      if (turn) turn.answer = event.text || ''
    } else if (event.type === 'summary') {
      if (turn) turn.summary = event.text || ''
    } else if (event.type === 'done') {
      if (turn) {
        turn.status = 'done'
        if (typeof event.answer === 'string') turn.answer = event.answer
        if (!turn.summary) turn.summary = turn.answer
      }
      running = false
      els.send.disabled = false
    } else if (event.type === 'error') {
      if (turn) {
        turn.status = 'failed'
        turn.error = event.message || t('quick.failed')
      }
      running = false
      els.send.disabled = false
    }
    render()
  })

  // ------------------------------------------------------------ 验证钩子

  /**
   * 给 tools/verify-matrix.js 用：截图要走真实抓屏 + 全屏框选层，
   * 自动化里没法（也不该）真的去拍用户屏幕，所以这里直接注入一张假图，
   * 把「待发送缩略图 → 移除 → 发送时带上」这条渲染层逻辑单独测掉。
   * 传输层（POST + image part 能不能被 DSH 接受）由 verify-quick-ask.js 覆盖。
   */
  window.__dshBubble = {
    addShot(width = 16, height = 16) {
      // 1×1 红点放大后作为占位图：只要 data URL 合法，渲染层就不关心内容
      pending.push({
        mediaType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        name: 'hook.png',
        width,
        height,
      })
      renderShots()
      return pending.length
    },
    clearShots() {
      pending = []
      renderShots()
      return pending.length
    },
    removeFirstShot() {
      const x = els.shots.querySelector('.shot-x')
      if (x) x.click()
      return pending.length
    },
    get pendingCount() { return pending.length },
    get shotsHidden() { return els.shots.hidden },
    get chipCount() { return els.shots.querySelectorAll('.shot').length },
    get chipSizeText() {
      const node = els.shots.querySelector('.shot-meta')
      return node ? node.textContent : null
    },
    get sendDisabled() { return els.send.disabled },
    get canSendWithoutText() {
      // 只发图不发字应当被允许：submit 的前置条件不能要求文字
      return pending.length > 0
    },
    setInput(value) {
      els.input.value = value
      return els.input.value
    },
    get turnImages() {
      return turns.map((turn) => (Array.isArray(turn.images) ? turn.images.length : 0))
    },
  }

  // ------------------------------------------------------------ 启动

  ;(async () => {
    const i18n = await api.i18nMessages()
    window.__dshI18n.setMessages(i18n.language, i18n.messages)
    window.__dshI18n.applyStatic()

    const history = await api.quickHistory()
    turns = Array.isArray(history) ? history : []
    running = turns.some((turn) => turn.status === 'running')
    els.send.disabled = running

    applyState(await api.getState())
    render()
    els.input.focus()
  })()
})()
