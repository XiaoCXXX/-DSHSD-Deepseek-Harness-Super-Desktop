'use strict'

// 客户端主题数据 —— 主题 id 与 DSH 侧主题包（dsh-theme-pack）**必须一致**，
// 一次切换同时驱动两个平面：客户端界面（renderer/theme-tokens.css，由生成器产出）
// 与 DSH Web 界面（主题包覆盖 --dsw-alias-*）。
//
// 每套主题给出 22 个角色 + panelBg（悬浮条底色，可半透明）。默认主题是
// `dsh-white-blue`：白底 + 蓝强调，即「DSH 原生白蓝」。
//
// 客户端 CSS 令牌由 rolesToTokens() 映射；生成器 tools/gen-theme-css.js 用它产出
// renderer/theme-tokens.css。

const DEFAULT_THEME_ID = 'dsh-white-blue'

/** DSH 侧合法的主题 id（与 dsh-theme-pack/lib/themes.js 对齐）。 */
const THEME_IDS = ['dsh-white-blue', 'dsh-dark', 'ice', 'ocean', 'midnight', 'contrast']

const THEMES = [
  {
    id: 'dsh-white-blue',
    label: 'DSH 原生白蓝',
    colorScheme: 'light',
    panelBg: 'rgba(255, 255, 255, .97)',
    palette: {
      pageBg: '#FFFFFF',
      surface1: '#FFFFFF',
      surface2: '#F7F9FF',
      surface3: '#E9EEFB',
      textPrimary: '#1B2337',
      textSecondary: '#5B6784',
      textMuted: '#8A95AC',
      textAccent: '#203170',
      borderSubtle: '#EEF1F8',
      border: '#DDE4F2',
      borderStrong: '#C3CFE6',
      hoverBg: '#F0F4FD',
      activeBg: '#E4EBFB',
      brand: '#2F5BD7',
      brandSoft: '#E4EBFB',
      success: '#1F9D63',
      warning: '#B8801F',
      danger: '#CF4A42',
      info: '#2F7FD7',
      sidebarFill: '#F7F9FF',
      scrollThumb: '#CCD6E8',
      scrollThumbHover: '#A9BAD6',
    },
  },
  {
    id: 'dsh-dark',
    label: 'DSH 原生暗色',
    colorScheme: 'dark',
    panelBg: 'rgba(23, 27, 37, .97)',
    palette: {
      pageBg: '#14171F',
      surface1: '#171B25',
      surface2: '#1B2029',
      surface3: '#232A3A',
      textPrimary: '#E6E9F0',
      textSecondary: '#9AA3B5',
      textMuted: '#6B7385',
      textAccent: '#9DC0FF',
      borderSubtle: '#262C3A',
      border: '#2B3140',
      borderStrong: '#38415A',
      hoverBg: '#2B3142',
      activeBg: '#232A3A',
      brand: '#4C8DFF',
      brandSoft: '#151D2C',
      success: '#35C48A',
      warning: '#E0A33C',
      danger: '#E2574C',
      info: '#4C8DFF',
      sidebarFill: '#12151C',
      scrollThumb: '#333A4A',
      scrollThumbHover: '#46506A',
    },
  },
  {
    id: 'ice',
    label: '冰蓝',
    colorScheme: 'light',
    panelBg: 'rgba(255, 255, 255, .97)',
    palette: {
      pageBg: '#F7FBFF',
      surface1: '#FFFFFF',
      surface2: '#EDF5FC',
      surface3: '#E2EFFA',
      textPrimary: '#12283A',
      textSecondary: '#4A6B84',
      textMuted: '#86A3B8',
      textAccent: '#0E7FD8',
      borderSubtle: '#E8F1F8',
      border: '#D6E6F2',
      borderStrong: '#B6D2E8',
      hoverBg: '#EAF4FC',
      activeBg: '#DCEDFA',
      brand: '#0E7FD8',
      brandSoft: '#D9EEFB',
      success: '#2E9E6B',
      warning: '#C98A16',
      danger: '#D8544F',
      info: '#2F8FD8',
      sidebarFill: '#F1F8FD',
      scrollThumb: '#C6DCEB',
      scrollThumbHover: '#A9C9DE',
    },
  },
  {
    id: 'ocean',
    label: '深海',
    colorScheme: 'dark',
    panelBg: 'rgba(14, 42, 62, .97)',
    palette: {
      pageBg: '#0B2233',
      surface1: '#0E2A3E',
      surface2: '#123449',
      surface3: '#17405A',
      textPrimary: '#E6F2FA',
      textSecondary: '#9FC0D4',
      textMuted: '#6E93A8',
      textAccent: '#4FD1E0',
      borderSubtle: '#16405A',
      border: '#1D4C69',
      borderStrong: '#2A6488',
      hoverBg: '#16405A',
      activeBg: '#1D4C69',
      brand: '#2FA8C9',
      brandSoft: '#123E52',
      success: '#3FBF8F',
      warning: '#E0B24C',
      danger: '#EC6A66',
      info: '#4FB8E0',
      sidebarFill: '#0C2839',
      scrollThumb: '#275A78',
      scrollThumbHover: '#35708F',
    },
  },
  {
    id: 'midnight',
    label: '午夜',
    colorScheme: 'dark',
    panelBg: 'rgba(11, 18, 32, .97)',
    palette: {
      pageBg: '#070B16',
      surface1: '#0B1220',
      surface2: '#111A2C',
      surface3: '#17233A',
      textPrimary: '#EAF0FF',
      textSecondary: '#A9B6D6',
      textMuted: '#7482A6',
      textAccent: '#8FA8FF',
      borderSubtle: '#17203A',
      border: '#1F2B49',
      borderStrong: '#2C3C63',
      hoverBg: '#16203A',
      activeBg: '#1E2A49',
      brand: '#5B7BFF',
      brandSoft: '#16204A',
      success: '#4ED2A0',
      warning: '#EDC25E',
      danger: '#FF6F7D',
      info: '#62B6FF',
      sidebarFill: '#090F1C',
      scrollThumb: '#26314F',
      scrollThumbHover: '#35456B',
    },
  },
  {
    id: 'contrast',
    label: '高对比',
    colorScheme: 'light',
    panelBg: 'rgba(255, 255, 255, .99)',
    palette: {
      pageBg: '#FFFFFF',
      surface1: '#FFFFFF',
      surface2: '#F2F2F2',
      surface3: '#E6E6E6',
      textPrimary: '#000000',
      textSecondary: '#1F1F1F',
      textMuted: '#4A4A4A',
      textAccent: '#0033CC',
      borderSubtle: '#BFBFBF',
      border: '#8A8A8A',
      borderStrong: '#000000',
      hoverBg: '#E6E6E6',
      activeBg: '#CCCCCC',
      brand: '#0033CC',
      brandSoft: '#D6E0FF',
      success: '#006B2D',
      warning: '#8A5A00',
      danger: '#B3001B',
      info: '#004C99',
      sidebarFill: '#F7F7F7',
      scrollThumb: '#767676',
      scrollThumbHover: '#4A4A4A',
    },
  },
]

/** 按 id 取主题；未知 id 回落默认（与 main.js 的校验保持一致）。 */
function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME_ID)
}

/** 归一化任意输入为主题 id（非法值一律回落到默认主题）。 */
function normalizeThemeId(id) {
  return THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME_ID
}

/**
 * 角色 → 客户端 CSS 令牌。客户端界面的令牌名与 DSH 侧不同，但都由同一份角色色板驱动，
 * 因此两个平面不会跑偏。
 * @param {Record<string,string>} p 角色色板
 * @param {string} panelBg 悬浮条底色（可半透明）
 * @returns {Record<string,string>}
 */
function rolesToTokens(p, panelBg) {
  return {
    '--c-page': p.pageBg,
    '--c-panel': panelBg,
    '--c-surface': p.surface2,
    '--c-surface-2': p.surface2,
    '--c-surface-3': p.surface3,
    '--c-item-bg': p.surface1,
    '--c-border': p.border,
    '--c-border-soft': p.borderSubtle,
    '--c-border-strong': p.borderStrong,
    '--c-text': p.textPrimary,
    '--c-text-dim': p.textSecondary,
    '--c-text-mute': p.textMuted,
    '--c-accent': p.brand,
    '--c-accent-strong': p.textAccent,
    '--c-accent-soft': p.brandSoft,
    '--c-success': p.success,
    '--c-warning': p.warning,
    '--c-danger': p.danger,
    '--c-btn': p.surface2,
    '--c-btn-border': p.border,
    '--c-btn-hover': p.hoverBg,
    '--c-input-bg': p.surface1,
    '--c-logs-bg': p.pageBg,
    '--c-scroll': p.scrollThumb,
    '--c-scroll-hover': p.scrollThumbHover,
    '--c-active-item-bg': p.activeBg,
    '--c-active-item-border': p.brand,
    '--c-tag-border': p.brand,
    '--c-tag-text': p.textAccent,
    '--c-primary-bg': p.surface3,
    '--c-primary-border': p.success,
    '--c-primary-text': p.success,
    '--c-danger-btn-bg': p.surface3,
    '--c-danger-btn-border': p.danger,
    '--c-danger-btn-text': p.danger,
    '--c-bar-shadow': p.colorScheme === 'dark' ? '0 10px 30px rgba(0, 0, 0, .45)' : '0 10px 30px rgba(31, 49, 112, .14)',
    '--c-shadow': p.colorScheme === 'dark' ? '0 6px 18px rgba(0, 0, 0, .4)' : '0 6px 18px rgba(31, 49, 112, .12)',
  }
}

/** 生成 renderer/theme-tokens.css 的内容（默认块 + 每主题覆盖块）。 */
function themeTokensCss() {
  const lines = [
    '/* 由 tools/gen-theme-css.js 生成，请勿手改。',
    ' * 数据源：lib/themes.js（与 DSH 侧 dsh-theme-pack 的角色色板一致）。',
    ' * 默认块 = DSH 原生白蓝；body[data-theme] 覆盖其余主题。 */',
    '',
  ]
  const fallback = getTheme(DEFAULT_THEME_ID)
  lines.push('body {')
  for (const [token, value] of Object.entries(rolesToTokens(fallback.palette, fallback.panelBg))) {
    lines.push(`  ${token}: ${value};`)
  }
  lines.push('  color-scheme: light;')
  lines.push('}')
  for (const theme of THEMES) {
    lines.push('')
    lines.push(`body[data-theme="${theme.id}"] {`)
    for (const [token, value] of Object.entries(rolesToTokens(theme.palette, theme.panelBg))) {
      lines.push(`  ${token}: ${value};`)
    }
    lines.push(`  color-scheme: ${theme.colorScheme};`)
    lines.push('}')
  }
  lines.push('')
  return lines.join('\n')
}

/** 给渲染进程用的精简主题清单（id/label/colorScheme）。 */
function themeList() {
  return THEMES.map((t) => ({ id: t.id, label: t.label, colorScheme: t.colorScheme }))
}

module.exports = { THEMES, THEME_IDS, DEFAULT_THEME_ID, getTheme, normalizeThemeId, rolesToTokens, themeTokensCss, themeList }
