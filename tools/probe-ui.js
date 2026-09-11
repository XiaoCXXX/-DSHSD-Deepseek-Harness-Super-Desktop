'use strict'

// 用 CDP 探 DSH 界面的真实 DOM 结构（无需肉眼）：输入区（composer）与对话区的关系、
// 过程行/答案行的稳定钩子。开发期工具，用于改 UI 前先看清结构。
//   node tools/probe-ui.js
//
// 说明：启动一个隐藏的客户端实例并接管 3080 上的 dsh web，只读页面结构，不输入任何内容。

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

/**
 * 子进程环境：必须清掉 ELECTRON_RUN_AS_NODE。
 * 当宿主（例如客户端用「Electron 当 Node」拉起的 bundled dsh web）带着这个变量时，
 * electron.exe 会退化成纯 Node，require('electron').app 为 undefined，
 * 客户端一启动就崩在 main.js 的 app.commandLine 上。
 */
const childEnv = () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
const OUT_DIR = path.join(ROOT, '.verify')
const USER_DATA = path.join(OUT_DIR, 'userdata-probe')
const CDP_PORT = 9234

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpTargets() {
  try {
    return await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  } catch {
    return null
  }
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })
  let seq = 0
  const send = (method, params = {}, timeout = 20000) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => reject(new Error(`${method} 超时`)), timeout)
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
        else resolve(msg.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, send }
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, 20000)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || '页面脚本抛错')
  return result.result?.value
}

const PROBE = `(() => {
  const box = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').split(' ').filter(Boolean).slice(0, 3).join('.'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      position: cs.position, display: cs.display,
      margin: cs.margin, padding: cs.padding,
      radius: cs.borderRadius, shadow: cs.boxShadow === 'none' ? 'none' : 'yes',
      border: cs.borderWidth + ' ' + cs.borderStyle,
      bg: cs.backgroundColor, maxWidth: cs.maxWidth,
      overflowY: cs.overflowY,
    }
  }
  const chain = (el, n) => {
    const out = []
    let cur = el
    for (let i = 0; i < n && cur && cur !== document.documentElement; i++) { out.push(box(cur)); cur = cur.parentElement }
    return out
  }

  const editable = document.querySelector('[contenteditable="true"], textarea')
  let composerCard = null
  if (editable) {
    let cur = editable
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur)
      if (cs.boxShadow !== 'none' || parseFloat(cs.borderRadius) >= 8) { composerCard = cur; break }
      cur = cur.parentElement
    }
  }

  // 最大的可滚动容器 = 对话区
  let scroller = null
  for (const el of document.querySelectorAll('div')) {
    const cs = getComputedStyle(el)
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      if (!scroller || el.clientHeight > scroller.clientHeight) scroller = el
    }
  }

  // 稳定的 data-* 钩子全量收集（改 UI 时优先依赖这些，而不是哈希类名）
  const dataAttrs = new Set()
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) if (a.name.startsWith('data-')) dataAttrs.add(a.name)
  }

  return {
    url: location.href,
    title: document.title,
    textSample: document.body ? document.body.innerText.slice(0, 400) : '',
    hasEditable: Boolean(editable),
    composerCard: composerCard ? box(composerCard) : null,
    composerChain: editable ? chain(editable, 6) : [],
    scroller: scroller ? box(scroller) : null,
    dataAttrs: [...dataAttrs].sort(),
  }
})()`

const PROBE_CONVERSATION = `(() => {
  const box = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').split(' ').filter(Boolean).slice(0, 3).join('.'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      position: cs.position, radius: cs.borderRadius,
      shadow: cs.boxShadow === 'none' ? 'none' : 'yes',
      bg: cs.backgroundColor, padding: cs.padding, margin: cs.margin,
      bottom: Math.round(r.bottom),
    }
  }
  const attrDump = (el) => {
    const out = {}
    for (const a of el.attributes) if (a.name.startsWith('data-')) out[a.name] = a.value
    return out
  }
  const card = document.querySelector('[data-composer-card]')
  const overlay = document.querySelector('[data-conversation-composer-overlay]')
  const seat = document.querySelector('[data-composer-seat]')
  const scroller = document.querySelector('[data-conversation-scroll]')
  const turns = [...document.querySelectorAll('[data-chat-turn]')]
  // 全局抓 process 容器（含「正在生成」的 open 状态），而不是只看最后一个 turn
  const processes = [...document.querySelectorAll('[data-turn-process]')].map((p) => ({
    box: box(p),
    attrs: attrDump(p),
    answer: p.querySelector('[data-turn-process-answer]') ? box(p.querySelector('[data-turn-process-answer]')) : null,
    members: [...p.querySelectorAll('[data-turn-process-member]')].map((m) => ({
      box: box(m),
      attrs: attrDump(m),
      text: m.innerText.replace(/\\n/g, ' / ').slice(0, 70),
    })),
  }))
  return {
    hasConversation: Boolean(scroller),
    overlay: overlay ? { box: box(overlay), attrs: attrDump(overlay) } : null,
    card: card ? { box: box(card), attrs: attrDump(card) } : null,
    seat: seat ? { box: box(seat), attrs: attrDump(seat) } : null,
    scroller: scroller ? { ...box(scroller), scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight } : null,
    gapScrollToCard: scroller && card ? Math.round(card.getBoundingClientRect().top - scroller.getBoundingClientRect().bottom) : null,
    turnCount: turns.length,
    processCount: processes.length,
    processes,
  }
})()`

const CLICK_FIRST_SESSION = `(() => {
  const wanted = ['你好我想要安装Starship美化软件', '什么是库伦定理']
  const nodes = [...document.querySelectorAll('button, [role="button"], a, div, span')]
  for (const w of wanted) {
    const hit = nodes.find((el) => el.children.length === 0 && el.textContent.trim() === w)
    if (hit) {
      const target = hit.closest('button, [role="button"], a') || hit
      target.click()
      return w
    }
  }
  return null
})()`

async function main() {
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.writeFileSync(
    path.join(USER_DATA, 'config.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'p-probe', name: 'probe', cwd: ROOT, port: 3080 }],
      activeProjectId: 'p-probe',
      adoptExternal: true,
      autoStartOnLaunch: false,
      openUiOnStart: false,
      stopServerOnQuit: false,
      theme: 'dsh-white-blue',
    }),
    'utf8',
  )

  const child = spawn(ELECTRON, ['.', '--hidden', `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`], {
    cwd: ROOT,
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const cleanup = () => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
  process.on('exit', cleanup)

  const output = []
  child.stdout.on('data', (d) => output.push(String(d)))
  child.stderr.on('data', (d) => output.push(String(d)))

  let targets = null
  let lastSeen = []
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    targets = await cdpTargets()
    if (targets) lastSeen = targets.map((t) => `${t.type} ${t.url}`)
    if (targets && targets.some((t) => t.type === 'page' && /127\.0\.0\.1:3080/.test(t.url))) break
    targets = null
  }
  if (!targets) {
    console.error('未找到 DSH 页面（3080 上是否在运行 dsh web？）')
    console.error('最后看到的 targets：\n  ' + (lastSeen.join('\n  ') || '(CDP 没起来)'))
    console.error('客户端输出尾部：\n' + output.join('').split('\n').slice(-15).join('\n'))
    cleanup()
    process.exit(1)
  }

  try {
    const dsh = await connect(targets.find((t) => t.type === 'page' && /127\.0\.0\.1:3080/.test(t.url)))
    await sleep(4000)
    const hero = await evaluate(dsh.send, PROBE)

    // 点开一个会话，量出「对话态」的输入区与滚动区几何关系
    const clicked = await evaluate(dsh.send, CLICK_FIRST_SESSION)
    let conversation = null
    if (clicked) {
      await sleep(4000)
      conversation = await evaluate(dsh.send, PROBE_CONVERSATION)
    }

    const result = { hero: { textSample: hero.textSample, composerCard: hero.composerCard, dataAttrs: hero.dataAttrs }, clickedSession: clicked, conversation }
    const out = path.join(OUT_DIR, 'ui-probe.json')
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8')
    console.log(`已写入 ${out}`)
    console.log(`点开的会话：${clicked || '(未找到，仍是新会话页)'}`)
    if (conversation) {
      const c = conversation.card && conversation.card.box
      const s = conversation.seat && conversation.seat.box
      console.log(`对话滚动区 rect=${JSON.stringify(conversation.scroller && conversation.scroller.rect)}`)
      console.log(`输入卡 rect=${JSON.stringify(c && c.rect)} 圆角=${c && c.radius} 阴影=${c && c.shadow} 背景=${c && c.bg}`)
      console.log(`输入 seat rect=${JSON.stringify(s && s.rect)} 背景=${s && s.bg}`)
      console.log(`对话区底边到输入卡顶边的间距：${conversation.gapScrollToCard}px`)
      console.log(`微调① 生效？ 圆角=0:${c && c.radius === '0px'}  无阴影:${c && c.shadow === 'none'}  满宽:${c && s && Math.abs(c.rect.w - s.rect.w) < 40}  seat 背景不透明:${s && !/rgba\(0, 0, 0, 0\)/.test(s.bg)}`)
      console.log(`轮次数=${conversation.turnCount}  process 容器数=${conversation.processCount}`)
      for (const p of conversation.processes) {
        console.log(`  process attrs=${JSON.stringify(p.attrs)} rect=${JSON.stringify(p.box.rect)} answer=${p.answer ? JSON.stringify(p.answer.rect) : 'null'}`)
        for (const m of p.members) console.log(`    member ${JSON.stringify(m.attrs)} rect=${JSON.stringify(m.box.rect)} :: ${m.text.slice(0, 55)}`)
      }
    }
    // 微调②：用产品源码里的真实属性语义合成一段结构，检验「生成中只显示答案」的规则
    const tweak2 = await evaluate(dsh.send, `(() => {
      const host = document.createElement('div')
      host.setAttribute('data-turn-process', '1')
      host.setAttribute('data-open', 'true')
      const mk = (attrs, text) => {
        const d = document.createElement('div')
        for (const k in attrs) d.setAttribute(k, attrs[k])
        d.textContent = text
        host.appendChild(d)
        return d
      }
      const proc = mk({ 'data-turn-process-member': '' }, 'process-row')
      const ans = mk({ 'data-turn-process-member': '', 'data-turn-process-answer': 'true' }, 'answer-row')
      const hid = mk({ 'data-turn-process-member': '', 'data-turn-process-hidden': 'true' }, 'hidden-row')
      const closed = document.createElement('div')
      closed.setAttribute('data-turn-process', '1')
      const procClosed = document.createElement('div')
      procClosed.setAttribute('data-turn-process-member', '')
      procClosed.textContent = 'closed-process-row'
      closed.appendChild(procClosed)
      document.body.append(host, closed)
      const out = {
        processRow: getComputedStyle(proc).display,
        answerRow: getComputedStyle(ans).display,
        hiddenRow: getComputedStyle(hid).display,
        closedTurnProcessRow: getComputedStyle(procClosed).display,
      }
      host.remove()
      closed.remove()
      return out
    })()`)
    console.log(`微调② 合成检验：${JSON.stringify(tweak2)}`)
    console.log(`  生成中隐藏过程行:${tweak2.processRow === 'none'}  答案行保留:${tweak2.answerRow !== 'none'}  已折叠的行不受影响:${tweak2.hiddenRow === 'none'}  已结束的轮次不受影响:${tweak2.closedTurnProcessRow !== 'none'}`)
    dsh.ws.close()
  } finally {
    cleanup()
    await sleep(300)
  }
}

main().catch((error) => {
  console.error('探测失败：', error.message)
  process.exit(1)
})
