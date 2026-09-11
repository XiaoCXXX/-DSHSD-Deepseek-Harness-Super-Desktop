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

    wrap.appendChild(el('div', 'ask', turn.question))

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

  // ------------------------------------------------------------ 服务状态

  function applyState(state) {
    if (!state) return
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

  // ------------------------------------------------------------ 提问

  function autoGrow() {
    els.input.style.height = 'auto'
    els.input.style.height = `${Math.min(els.input.scrollHeight, 96)}px`
  }

  async function submit() {
    const question = els.input.value.trim()
    if (!question || running) return
    els.input.value = ''
    autoGrow()
    running = true
    els.send.disabled = true
    const result = await api.quickAsk({ question })
    if (result && result.ok === false) {
      running = false
      els.send.disabled = false
      turns.push({
        id: result.requestId || `local-${Date.now()}`,
        question,
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
  els.hide.addEventListener('click', () => api.hideWindow())

  // ------------------------------------------------------------ 事件

  api.onState(applyState)

  api.onQuickEvent((event) => {
    if (!event || typeof event !== 'object') return
    const turn = findTurn(event.id)

    if (event.type === 'start') {
      if (!turn) {
        turns.push({ id: event.id, question: event.question || '', status: 'running', answer: '' })
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
