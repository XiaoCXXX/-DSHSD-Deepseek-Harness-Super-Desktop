// dsh-quick-ask —— 桌面客户端「便携悬浮窗」的后端。
//
// 为什么做成 DSH 插件而不是在客户端里直连 DSH 的 RPC：
//   客户端要发一次提问，得走 DSH 的 Typert Remote 协议（HTTP POST + /api/remote.mux
//   的逻辑流）并跟进生成代码的版本。放进 DSH 进程内做，用的就是 Host 自己的服务
//   （sessionController / llm），客户端只需要连一个普通的 SSE 路由。
//
// 对外只有一个路由：
//   GET /dsh-quick/ask?id=<客户端生成的 id>&q=<问题>&session=active|dedicated&summary=model|truncate
//   响应 text/event-stream，事件：
//     event: answer   data: {"text": "<这一轮到目前为止的正文>"}
//     event: summary  data: {"text": "<一句话简答>"}
//     event: done     data: {"sessionId": "...", "answer": "..."}
//     event: error    data: {"message": "..."}
//
// 版本：0.1.0

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const name = 'dsh-quick-ask'
// 只注入跑不掉的服务。sessions / agentDefaultModel 用 ctx.get() 取：
// 万一某个部署没编排它们，缺一个也只是能力降级，不该让整个插件装不上。
const inject = ['webServer', 'sessionController', 'llm']

const ROUTE = '/dsh-quick/ask'
/** 不调模型时，简答直接截断到这个长度。 */
const TRUNCATE_CHARS = 160
/** 摘要调用最多花多久；超时就先用截断顶着，别让气泡一直转。 */
const SUMMARY_TIMEOUT_MS = 20000
/** 一问一答的总预算。 */
const ANSWER_TIMEOUT_MS = 10 * 60 * 1000
/** 专用会话的标题，方便用户在 DSH 侧边栏里认出来。 */
const DEDICATED_TITLE = '快速提问 / Quick ask'

/** 插件自己的小状态文件：目前只记专用会话 id，用来跨重启复用同一个会话。 */
function stateFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, '.dsh-quick-ask.json')
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeState(patch) {
  try {
    const file = stateFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify({ ...readState(), ...patch }, null, 2)}\n`, 'utf8')
  } catch { /* 记不住就退回每次新建，不影响提问本身 */ }
}

/** 把一段文本压到 TRUNCATE_CHARS 以内，尽量断在句子边界。 */
function truncate(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  if (flat.length <= TRUNCATE_CHARS) return flat
  const head = flat.slice(0, TRUNCATE_CHARS)
  const marks = ['。', '.', '！', '!', '？', '?', '；', ';']
  const cut = Math.max(...marks.map((mark) => head.lastIndexOf(mark)))
  return `${cut > TRUNCATE_CHARS * 0.5 ? head.slice(0, cut + 1) : head}…`
}

/** 从一个 assistant 消息里取纯文本（tool-call 块不算）。 */
function textOfMessage(message) {
  const content = message && Array.isArray(message.content) ? message.content : []
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/**
 * 提问的 requestId 会被回显成用户消息的 rpcId；字段名在几个包之间不完全一致，这里都认。
 * 拿不到也不致命：调用方有兜底（超时后按「下一条 assistant/message」算）。
 */
function rpcIdOf(event) {
  const data = event && event.data
  if (!data || typeof data !== 'object') return undefined
  return data.rpcId ?? data.source?.rpcId ?? data.message?.source?.rpcId
}

/**
 * 子代理会话不进「当前活跃会话」的候选。
 * 只认 header.origin —— fork 出来的会话也会带 parentSession，但 origin 不是 subagent。
 */
function isSubagent(session) {
  return Boolean(session && session.header && session.header.origin === 'subagent')
}

/** turn/end 的 reason → 失败原因；成功返回 null。 */
function turnFailure(reason) {
  if (!reason || typeof reason !== 'object') return null
  if (reason.kind === 'completed') return null
  if (reason.kind === 'error') {
    const failure = reason.error || {}
    return `模型出错：${failure.message || failure.code || 'unknown'}`
  }
  if (reason.kind === 'aborted') return '这一轮被中止了'
  if (reason.kind === 'max-tokens') return '回答达到输出上限'
  return `这一轮没有正常结束（${reason.kind}）`
}

function apply(ctx) {
  /** sessionId -> watch。同一会话同时只允许一个在等的提问。 */
  const watches = new Map()
  /**
   * sessionId -> { turn }：标着「这一轮不要推理」的会话。
   * turn 为 null 表示还没从 turn/start 认出是哪一轮。
   */
  const fastTurns = new Map()
  /** 最近出现过事件的普通会话，作为「当前活跃会话」的优先候选。 */
  let lastActiveSessionId = null
  /** 专用会话 id，建一次就复用。 */
  let dedicatedSessionId = null

  function emit(res, type, payload) {
    if (res.writableEnded) return
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  // ---------------------------------------------------------------- 无推理档位

  // 悬浮窗的要求是「越快越好」，所以快速提问那一轮一律关掉推理。
  // DeepSeek 适配器里 reasoningEffort:'off' → thinking:'disabled'（见 dsh-llm-deepseek
  // 的 resolveThinking），模型直接出答案，不再先想一遍。
  //
  // 为什么走 agent/request 瀑布，而不是 sessionController.selectModel：
  //   selectModel 会顺手 agentDefaultModel.saveSelection()，把这次选择存成**部署默认**。
  //   拿它做「只快这一轮」的临时覆盖，会把用户以后所有新会话的默认档位一起改掉。
  //   这个瀑布只替换这一轮真正发出去的那份请求配置，会话上的持久选择一个字节都不动。
  //   瀑布按 agent 作用域过滤，payload 里带着 agent 和 turn，正好用来认自己那一轮。
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const sessionId = payload?.agent?.session?.id
    if (!sessionId) return config
    const fast = fastTurns.get(sessionId)
    if (!fast) return config
    // 还没认出轮次前先不设限；认出来之后只认那一轮
    if (fast.turn !== null && payload.turn !== fast.turn) return config
    if (config.reasoningEffort === 'off') return config
    // 用 console 而不是 ctx.logger：日志要出现在 DSH 的 stdout 里，
    // 客户端会把它收成 [server] 行，排查时能直接看到档位有没有被换掉。
    console.log(`[quick-ask] turn ${payload.turn} step ${payload.step} 关闭推理（原档位 ${config.reasoningEffort ?? '默认'}）`)
    return { ...config, reasoningEffort: 'off' }
  })

  // ---------------------------------------------------------------- 会话观察

  ctx.on('session/event', (session, event) => {
    const sessionId = session && session.id
    if (!sessionId) return
    if (!isSubagent(session)) lastActiveSessionId = sessionId
    const watch = watches.get(sessionId)
    if (watch) watch.observe(event)
  })

  ctx.on('session/disposed', (session) => {
    const watch = session && session.id ? watches.get(session.id) : null
    if (watch) watch.fail(new Error('会话已销毁'))
  })

  // ---------------------------------------------------------------- 选会话

  /** 最近活跃的普通会话：优先「刚有过事件的那个」，否则用列表里最新的。 */
  async function activeSession() {
    if (lastActiveSessionId) {
      const live = ctx.get('sessions')?.get?.(lastActiveSessionId)
      // 已经被回收的会话也可能还能 resume，交给 sessionController 处理
      if (live === undefined || !isSubagent(live)) return lastActiveSessionId
      lastActiveSessionId = null
    }
    try {
      const { items } = await ctx.sessionController.list({}, AbortSignal.timeout(5000))
      const ordinary = items.filter((row) => row.origin !== 'subagent')
      if (ordinary.length > 0) return ordinary[0].sessionId
    } catch (error) {
      ctx.logger?.warn?.(`[quick-ask] 列会话失败：${error?.message || error}`)
    }
    return null
  }

  /**
   * 专用会话。**只在进程内复用**：每次 DSH 启动会新建一个「快速提问」会话。
   *
   * 试过把 id 记到 $DSH_HOME 里跨重启复用（见 readState/writeState），两种写法都在
   * 无凭据的沙箱里挂死——直接 prompt 旧 id、或先 create({sessionId}) 收养再 prompt，
   * 之后都不会产生任何 turn 事件，请求一直等到超时。新建会话的失败是干净的，
   * 所以先退回这个已证实可用的行为；跨重启复用等有真实 key 的环境再验。
   */
  async function dedicatedSession() {
    if (dedicatedSessionId) return dedicatedSessionId
    const created = await ctx.sessionController.create({ cwd: process.cwd() })
    dedicatedSessionId = created.sessionId
    try {
      await ctx.sessionController.rename({ sessionId: dedicatedSessionId, title: DEDICATED_TITLE })
    } catch { /* 标题是锦上添花 */ }
    return dedicatedSessionId
  }

  async function targetSession(mode) {
    if (mode === 'dedicated') return dedicatedSession()
    const active = await activeSession()
    return active || dedicatedSession()
  }

  // ---------------------------------------------------------------- 一句话简答

  /** 摘要走哪个模型：优先这一轮回答实际用的路由，其次部署默认。 */
  function summaryRoute(used) {
    if (used && used.provider && used.model) return { provider: used.provider, model: used.model }
    try {
      const fallback = ctx.get('agentDefaultModel')?.currentSelection?.()
      if (fallback && fallback.provider && fallback.model) return fallback
    } catch { /* 拿不到就走截断 */ }
    return null
  }

  async function summarize(answer, used, sessionId) {
    const route = summaryRoute(used)
    if (!route) return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS)
    const call = async (extra) => {
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [createUserMessage({
          content: [{
            type: 'text',
            text: `把下面这段回答压缩成一句话，直接输出这句话本身，不要任何前后缀：\n\n${answer}`,
          }],
          source: { kind: 'plugin', plugin: name },
        })],
        system: '你在做摘要。只输出一句话，不要 Markdown、不要引号、不要解释。用回答本身的语言。',
        maxTokens: 256,
        sessionId,
        signal: controller.signal,
        ...extra,
      })) {
        assembler.push(chunk)
      }
      if (assembler.finish.kind !== 'stop') return null
      const text = assembler.blocks()
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join(' ')
        .trim()
      return text || null
    }
    try {
      // 摘要同样不要推理：模型直接给一句话
      try {
        return await call({ reasoningEffort: 'off' })
      } catch (error) {
        // 换一个不认 off 的适配器时就退回默认档位，别把摘要整条丢掉
        if (!/reasoning effort|UNSUPPORTED_REASONING_EFFORT/i.test(String(error?.message || error))) throw error
        return await call({})
      }
    } finally {
      clearTimeout(timer)
    }
  }

  // ---------------------------------------------------------------- 一次提问

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const question = String(url.searchParams.get('q') || '').trim()
    const mode = url.searchParams.get('session') === 'dedicated' ? 'dedicated' : 'active'
    const summaryMode = url.searchParams.get('summary') === 'truncate' ? 'truncate' : 'model'
    const id = String(url.searchParams.get('id') || '')

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })

    if (!question) {
      emit(res, 'error', { message: '问题为空' })
      res.end()
      return
    }

    let sessionId
    try {
      sessionId = await targetSession(mode)
    } catch (error) {
      emit(res, 'error', { message: `无法打开会话：${error?.message || error}` })
      res.end()
      return
    }
    if (!sessionId) {
      emit(res, 'error', { message: '没有可用的会话' })
      res.end()
      return
    }
    if (watches.has(sessionId)) {
      emit(res, 'error', { message: '该会话上已经有一个快速提问在跑' })
      res.end()
      return
    }

    const requestId = brandString(id || `quick-${Date.now().toString(36)}`)
    let settle
    const done = new Promise((resolve) => { settle = resolve })

    const watch = {
      phase: 'awaiting',     // awaiting → running → done
      turn: null,
      answer: '',
      route: null,
      timer: null,
      observe(event) {
        const data = event && event.data
        if (watch.phase === 'awaiting') {
          // 用户消息把提问的 rpcId 回显在 source 上，用它认领这一轮
          if (rpcIdOf(event) !== requestId) return
          watch.phase = 'running'
        }
        if (watch.phase !== 'running') return
        // turn/start 是我们唯一能拿到轮次号的地方（user/message 的 data 就是消息本身，
        // 没有 turn 字段）。认出来之后，无推理档位就只作用于这一轮。
        if (event.type === 'turn/start' && data && typeof data.turn === 'number') {
          if (watch.turn === null) {
            watch.turn = data.turn
            const fast = fastTurns.get(sessionId)
            if (fast) fast.turn = data.turn
          }
          return
        }
        // 认准自己那一轮，别把会话里别的 turn 算进来
        if (watch.turn !== null && data && typeof data.turn === 'number' && data.turn !== watch.turn) return

        if (event.type === 'assistant/message') {
          const message = data && data.message
          // interrupted 的只是被取消时已交付的前缀，不作为最终答案
          const text = textOfMessage(message)
          if (text) {
            watch.answer = text
            watch.route = (message && message.source) || watch.route
            emit(res, 'answer', { text })
          }
          return
        }
        if (event.type === 'turn/end') {
          const failure = turnFailure(data && data.reason)
          if (failure) watch.fail(new Error(failure))
          else watch.finish()
        }
      },
      async finish() {
        if (watch.phase === 'done') return
        watch.phase = 'done'
        clearTimeout(watch.timer)
        watches.delete(sessionId)
        fastTurns.delete(sessionId)

        const answer = watch.answer
        let summary = ''
        if (summaryMode === 'model' && answer) {
          try {
            summary = await summarize(answer, watch.route, sessionId) || ''
          } catch (error) {
            ctx.logger?.warn?.(`[quick-ask] 摘要失败，退回截断：${error?.message || error}`)
          }
        }
        if (!summary) summary = truncate(answer)
        emit(res, 'summary', { text: summary })
        emit(res, 'done', { sessionId, answer })
        res.end()
        settle()
      },
      fail(error) {
        if (watch.phase === 'done') return
        watch.phase = 'done'
        clearTimeout(watch.timer)
        watches.delete(sessionId)
        fastTurns.delete(sessionId)
        emit(res, 'error', { message: error?.message || String(error) })
        res.end()
        settle()
      },
    }

    watches.set(sessionId, watch)
    // 这一轮不要推理：先标记，轮次号从 turn/start 认出来后再收窄
    fastTurns.set(sessionId, { turn: null })
    watch.timer = setTimeout(() => watch.fail(new Error('回答超时')), ANSWER_TIMEOUT_MS)
    // rpcId 回显的字段名不是公开契约。等 5 秒还没配上，就按「下一条 assistant/message」算，
    // 免得因为字段改名而永远挂在这里。
    const grace = setTimeout(() => {
      if (watch.phase === 'awaiting') watch.phase = 'running'
    }, 5000)
    done.then(() => clearTimeout(grace))

    res.on('close', () => {
      if (watch.phase !== 'done') {
        clearTimeout(watch.timer)
        clearTimeout(grace)
        watches.delete(sessionId)
        fastTurns.delete(sessionId)
        watch.phase = 'done'
        settle()
      }
    })

    try {
      await ctx.sessionController.prompt({
        requestId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: question }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }, AbortSignal.timeout(15000))
    } catch (error) {
      watch.fail(new Error(`发送失败：${error?.message || error}`))
      return
    }

    await done
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req, res) => {
      handle(req, res).catch((error) => {
        ctx.logger?.warn?.(`[quick-ask] 未捕获错误：${error?.message || error}`)
        try {
          emit(res, 'error', { message: String(error?.message || error) })
          if (!res.writableEnded) res.end()
        } catch { /* 连接已经没了 */ }
      })
    },
  }))
}

export { name, inject, apply }
