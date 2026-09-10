'use strict'

// 渲染进程取词：词典由主进程通过 IPC 提供（与托盘菜单共用同一份，避免二次维护）。
//
// 静态文案用属性标注，由 applyStatic() 一次性填充：
//   data-i18n="key"               → textContent
//   data-i18n-title="key"         → title 属性
//   data-i18n-placeholder="key"   → placeholder 属性
// 动态生成的文案在渲染时调用 __dshI18n.t()。
//
// 整体包在 IIFE 里：传统 <script> 的顶层声明会落进全局作用域，
// 与 control.js 的同名 const 冲突（曾因此报 "Identifier 't' has already been declared"）。

;(function () {
  let MESSAGES = {}
  let LANGUAGE = 'zh'

  /**
   * @param {string} language
   * @param {Record<string,string>} messages
   */
  function setMessages(language, messages) {
    LANGUAGE = language === 'en' ? 'en' : 'zh'
    MESSAGES = messages && typeof messages === 'object' ? messages : {}
    document.documentElement.lang = LANGUAGE === 'zh' ? 'zh-CN' : 'en'
  }

  /**
   * 取词并替换 {name} 占位符。
   * @param {string} key
   * @param {Record<string, string|number>} [params]
   * @returns {string}
   */
  function t(key, params) {
    const template = MESSAGES[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
  }

  /** 填充带 data-i18n* 标注的静态文案。 */
  function applyStatic(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n)
    }
    for (const el of root.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle)
    }
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
      el.placeholder = t(el.dataset.i18nPlaceholder)
    }
  }

  window.__dshI18n = { setMessages, t, applyStatic, get language() { return LANGUAGE } }
})()
