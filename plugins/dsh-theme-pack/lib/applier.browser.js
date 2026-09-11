/* dsh-theme-pack 应用脚本 —— 由宿主半注入到 DSH Web 页面（<script defer>）。
 *
 * 职责：
 *  1. 从 /dsh-theme/theme.json 读取当前主题；
 *  2. 把主题色写成 **inline + !important** 的自定义属性，同时落在
 *     documentElement 与 body 上 —— DSH 自带的主题 presenter 会往这两个地方写
 *     非 important 的值（或整块改写），important 的 inline 值优先级更高，所以
 *     我们的配色不会被它顶掉；
 *  3. 按主题声明的 colorScheme 钉住基底模式（body[data-ds-dark-theme]），并用
 *     MutationObserver 在被改回来时重新钉住；
 *  4. 轮询主题变化（本地 HTTP、载荷极小），失焦页面暂停。
 *
 * 这段代码是普通页面脚本，不是 cordis 客户端插件（仓库外的插件复现不了
 * 客户端插件的 lazy-CJS 构建链），因此只依赖 DOM 与 fetch。
 */
(function () {
  'use strict'

  var ENDPOINT = '/dsh-theme/theme.json'
  var POLL_MS = 3000
  var appliedNames = []
  var appliedId = null
  var modeObserver = null

  function elements() {
    var list = []
    if (document.documentElement) list.push(document.documentElement)
    if (document.body) list.push(document.body)
    return list
  }

  function applyVars(vars) {
    var els = elements()
    var names = []
    // 先清掉上一轮自己写下的名字，再写这一轮。
    //
    // 不这么做就会有一个很隐蔽的 bug：原生主题（dsh-white-blue / dsh-dark）的
    // vars 是空的 {}，applyVars({}) 什么都不写、同时把 appliedNames 置空，
    // 于是上一套主题留在 html/body 上的 inline + !important 变量**再也没有人清**。
    // 那些变量带 !important，优先级高于 DSH 自己的调色板，表现为
    // 「从非原生主题切回原生主题，DSH 界面切不回去」。
    // （ocean → contrast 之所以看着正常，是因为 contrast 自带整套变量，
    //   把该覆盖的都覆盖了，正好绕过这条路径。）
    for (var c = 0; c < els.length; c++) {
      var prev = els[c].style
      for (var p = 0; p < appliedNames.length; p++) prev.removeProperty(appliedNames[p])
    }
    for (var i = 0; i < els.length; i++) {
      var style = els[i].style
      for (var key in vars) {
        if (!Object.prototype.hasOwnProperty.call(vars, key)) continue
        style.setProperty(key, vars[key], 'important')
      }
    }
    for (var name in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, name)) names.push(name)
    }
    appliedNames = names
  }

  function clearVars() {
    var els = elements()
    for (var i = 0; i < els.length; i++) {
      for (var j = 0; j < appliedNames.length; j++) els[i].style.removeProperty(appliedNames[j])
    }
    appliedNames = []
  }

  /** 原生主题（vars 为空）要把基底模式还给 DSH 自己，不能一直钉着。 */
  function isNativeTheme(payload) {
    return payload && payload.native === true
  }

  function pinMode(scheme) {
    if (!document.body) return
    var wantDark = scheme === 'dark'
    var has = document.body.hasAttribute('data-ds-dark-theme')
    if (wantDark && !has) document.body.setAttribute('data-ds-dark-theme', '')
    if (!wantDark && has) document.body.removeAttribute('data-ds-dark-theme')

    if (typeof MutationObserver === 'undefined') return
    if (modeObserver) modeObserver.disconnect()
    modeObserver = new MutationObserver(function () {
      var now = document.body.hasAttribute('data-ds-dark-theme')
      if (wantDark && !now) document.body.setAttribute('data-ds-dark-theme', '')
      if (!wantDark && now) document.body.removeAttribute('data-ds-dark-theme')
    })
    modeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  }

  function apply(payload) {
    if (!payload || !payload.theme) return
    var scheme = payload.colorScheme === 'dark' ? 'dark' : 'light'

    // 「不覆盖配色」和「不管基底明暗」是两件事，别捆在一起。
    //
    // 原生主题不覆盖任何令牌（它的 vars 是空的），但**仍然要钉住基底模式**——
    // 否则「原生白蓝 ↔ 原生暗色」互相切不动：两套主题都不写变量，
    // 又都不动 data-ds-dark-theme，页面明暗就永远停在切换前的那个。
    // 这里曾经把两件事一起 return 掉，正好踩中这个坑。
    pinMode(scheme)

    if (isNativeTheme(payload)) {
      // 原生主题：清掉我们写过的变量，把配色整个还给 DSH 自己的调色板。
      // 不清的话，上一套非原生主题留在 html/body 上的 inline + !important
      // 会继续压着 DSH 的调色板，表现为「切回原生主题没反应」。
      clearVars()
    } else {
      // 每次都重放：presenter 可能在主题/系统配色变化时改写，重放成本极低。
      // applyVars 内部会先清掉上一轮的名字，所以从深色主题切到浅色主题不会留下残影。
      applyVars(payload.vars || {})
    }
    appliedId = payload.theme
  }

  function poll() {
    // 不要在 document.hidden 时提前返回：客户端的 DSH 视图在窗口隐藏 / 最小化到托盘时
    // 同样是 hidden，而那时恰恰需要能拉到主题（本地 HTTP 轮询，代价可忽略）。
    fetch(ENDPOINT, { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null })
      .then(function (data) { if (data && data.ok) apply(data) })
      .catch(function () { /* 宿主未就绪时静默重试 */ })
  }

  // ---------------------------------------------------------------- UI 微调
  //
  // 只依赖 DSH 客户端稳定的 data-* 钩子（不是哈希类名），只改观感不改行为：
  //   1) 输入区与对话面板合成一体：去掉居中浮动卡片的圆角/阴影/限宽，贴成面板底部
  //   2) 本轮进行中折叠过程成员，直接显示答案（答案行带 data-turn-process-answer）
  // 关掉：window.__dshThemePack.setUiTweaks(false)
  var UI_TWEAKS_ID = 'dsh-theme-ui-tweaks'
  var UI_TWEAKS_CSS = [
    '/* 1) 输入区并入对话面板（仅在对话态生效，新会话 hero 保持原样） */',
    'body:has([data-chat-turn]) [data-composer-seat]{background:var(--dsw-alias-bg-base,Canvas)!important}',
    'body:has([data-chat-turn]) [data-composer-card]{width:100%!important;max-width:none!important;border-radius:0!important;box-shadow:none!important;border-top:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))!important;background:var(--dsw-alias-bg-base,Canvas)!important}',
    'body:has([data-chat-turn]) [data-composer-seat]>*{padding-left:0!important;padding-right:0!important}',
    '/* 2) 生成过程中直接显示答案：隐藏非答案的过程行 */',
    '[data-turn-process][data-open] [data-turn-process-member]:not([data-turn-process-answer]):not([data-turn-process-hidden]){display:none!important}',
  ].join('\n')

  function installUiTweaks() {
    if (!document.head) return
    var el = document.getElementById(UI_TWEAKS_ID)
    if (!el) {
      el = document.createElement('style')
      el.id = UI_TWEAKS_ID
      document.head.appendChild(el)
    }
    if (el.textContent !== UI_TWEAKS_CSS) el.textContent = UI_TWEAKS_CSS
  }

  function removeUiTweaks() {
    var el = document.getElementById(UI_TWEAKS_ID)
    if (el && el.parentNode) el.parentNode.removeChild(el)
  }

  function start() {
    installUiTweaks()
    poll()
    setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll() })
  }

  // 供调试：window.__dshThemePack
  window.__dshThemePack = {
    refresh: poll,
    get appliedTheme() { return appliedId },
    clear: function () { clearVars(); if (modeObserver) modeObserver.disconnect() },
    setUiTweaks: function (on) { if (on === false) removeUiTweaks(); else installUiTweaks() },
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
