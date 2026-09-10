'use strict'

// 把客户端的语言选择同步给 DSH 自身。
//
// DSH 的语言偏好存在 $DSH_HOME/settings.yaml 的 locale.preference
// （见 @deepseek-ai/dsh-client-locale），取值 zh | en。
// 该文件被 DSH 用 chokidar 监听（settings-file 的 watch 默认开启），
// 因此改完即时生效，不需要重启服务。
//
// 写入时必须保留文件里其它命名空间的内容（例如 ui-onboarding），
// 否则用户会重新看到一次欢迎提示。

const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

function settingsFile(home) {
  return path.join(home, 'settings.yaml')
}

/** 读取设置文档；文件不存在或解析失败时返回空对象。 */
function readSettings(home) {
  try {
    const doc = yaml.load(fs.readFileSync(settingsFile(home), 'utf8'))
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}
  } catch {
    return {}
  }
}

/** 当前 DSH 已记录的语言偏好，未设置返回 undefined。 */
function readDshLanguage(home) {
  const value = readSettings(home)?.locale?.preference
  return typeof value === 'string' ? value : undefined
}

/**
 * 写入 DSH 语言偏好，保留其它命名空间。
 * @param {string} home - DSH_HOME
 * @param {'zh'|'en'} language - DSH 侧的语言 id
 * @returns {{changed:boolean, file:string, language:string}}
 */
function writeDshLanguage(home, language) {
  const file = settingsFile(home)
  if (readDshLanguage(home) === language) return { changed: false, file, language }

  const doc = readSettings(home)
  doc.locale = doc.locale && typeof doc.locale === 'object' && !Array.isArray(doc.locale) ? doc.locale : {}
  doc.locale.preference = language

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 120, noRefs: true }), 'utf8')
  return { changed: true, file, language }
}

module.exports = { readDshLanguage, writeDshLanguage, settingsFile }
