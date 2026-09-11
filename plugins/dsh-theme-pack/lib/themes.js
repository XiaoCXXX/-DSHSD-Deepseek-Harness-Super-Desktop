// 主题数据：每个主题声明自己建立在哪个内置色板模式上（colorScheme），以及一组
// 「角色 → 色值」的覆盖。角色到真实 CSS 变量的映射在 token-map.js，等调研结果
// （--dsw-alias-* 全量令牌表）确认后再定稿。
//
// 设计约定：
//  - `native: true` 的主题不覆盖任何令牌，直接使用 DSH 内置色板 —— 这两个主题
//    就是「DSH 原生白蓝」与「DSH 原生暗色」，用来满足「默认配色 = DSH 原生白蓝」。
//  - 其余主题给出完整覆盖；覆盖层只碰「颜色身份」相关的令牌（表面/文字/描边/
//    交互态/品牌与状态色/侧栏/滚动条），未覆盖的令牌回落到与 colorScheme 匹配的
//    内置色板，因此不会出现半明半暗的混搭。
//  - 每个主题只给一组值，因为应用脚本会把页面基底模式一并钉住（见 index.js 的
//    applier：按 colorScheme 设/清 body[data-ds-dark-theme]），所以不需要
//    light/dark 成对出现。

export const THEME_IDS = ['dsh-white-blue', 'dsh-dark', 'ice', 'ocean', 'midnight', 'contrast']

export const THEMES = [
  {
    id: 'dsh-white-blue',
    label: 'DSH 原生白蓝',
    labelEn: 'DSH White / Blue',
    colorScheme: 'light',
    native: true,
    palette: {},
  },
  {
    id: 'dsh-dark',
    label: 'DSH 原生暗色',
    labelEn: 'DSH Dark',
    colorScheme: 'dark',
    native: true,
    palette: {},
  },
  {
    id: 'ice',
    label: '冰蓝',
    labelEn: 'Ice',
    colorScheme: 'light',
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
    labelEn: 'Ocean',
    colorScheme: 'dark',
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
    labelEn: 'Midnight',
    colorScheme: 'dark',
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
    labelEn: 'High Contrast',
    colorScheme: 'light',
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

export const DEFAULT_THEME_ID = 'dsh-white-blue'

/** 按 id 取主题定义；未知 id 回落到默认主题。 */
export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME_ID)
}

/** 客户端 UI 用的角色名（control.css 的 CSS 变量）与 DSH 令牌角色同名，便于同一份数据驱动两边。 */
export const ROLES = [
  'pageBg', 'surface1', 'surface2', 'surface3',
  'textPrimary', 'textSecondary', 'textMuted', 'textAccent',
  'borderSubtle', 'border', 'borderStrong',
  'hoverBg', 'activeBg',
  'brand', 'brandSoft',
  'success', 'warning', 'danger', 'info',
  'sidebarFill', 'scrollThumb', 'scrollThumbHover',
]
