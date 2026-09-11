// 角色 → DSH CSS 变量映射。
//
// 令牌名来自对 dsh-client-ui-theme/lib/client.js 的实测抽取：该包一共声明 79 个
// `--dsw-alias-*`。这里只把「颜色身份」相关的映射出来；未覆盖的令牌回落到与
// theme.colorScheme 匹配的内置色板，因此不会出现半明半暗的混搭。
//
// 另有一个非别名的 `--dsw-specific-sidebar-fill`（ui-sidebar 直接用），也一起覆盖。

export const ROLE_TO_TOKENS = {
  pageBg: ['--dsw-alias-bg-base'],
  surface1: ['--dsw-alias-bg-layer-1'],
  surface2: ['--dsw-alias-bg-layer-2'],
  surface3: ['--dsw-alias-bg-layer-3'],
  textPrimary: ['--dsw-alias-label-primary'],
  textSecondary: ['--dsw-alias-label-secondary'],
  textMuted: [
    '--dsw-alias-label-tertiary',
    '--dsw-alias-label-dimmed',
    '--dsw-alias-label-caption',
    '--dsw-alias-label-primary-dimmed',
  ],
  textAccent: ['--dsw-alias-label-primary-bluish', '--dsw-alias-link', '--dsw-alias-markdown-tag'],
  borderSubtle: ['--dsw-alias-border-l1'],
  border: ['--dsw-alias-border-l2', '--dsw-alias-border-l2-darkmode-thin'],
  borderStrong: ['--dsw-alias-border-l3', '--dsw-alias-border-l4'],
  hoverBg: [
    '--dsw-alias-interactive-bg-hover',
    '--dsw-alias-interactive-bg-hover-accent',
    '--dsw-alias-interactive-bg-hover-solid',
    '--dsw-alias-button-tool-bar-hover',
    '--dsw-alias-button-ghost-active-hover',
  ],
  activeBg: [
    '--dsw-alias-interactive-bg-active',
    '--dsw-alias-button-ghost-active-fill',
    '--dsw-alias-button-ghost-active-border',
    '--dsw-alias-markdown-code-segment-selected',
  ],
  brand: [
    '--dsw-alias-brand-primary',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-state-business-primary',
  ],
  brandSoft: ['--dsw-alias-state-business-tertiary', '--dsw-alias-brand-primary-invert'],
  success: ['--dsw-alias-state-success-primary'],
  warning: ['--dsw-alias-state-warn-primary', '--dsw-alias-state-warn-label'],
  danger: ['--dsw-alias-state-error-primary'],
  info: ['--dsw-alias-button-info-fill'],
  sidebarFill: ['--dsw-specific-sidebar-fill'],
  scrollThumb: ['--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2'],
  scrollThumbHover: ['--dsw-alias-scrollbar-hover-l1', '--dsw-alias-scrollbar-hover-l2'],
}

/**
 * 由调色板派生的令牌：不单独设计颜色，跟随上面某个角色，保证整体一致。
 * @param {Record<string,string>} p 主题调色板（角色 → 色值）
 * @returns {Record<string,string>} 额外令牌
 */
function derived(p) {
  return {
    // 按钮族
    '--dsw-alias-button-primary-hover': p.brand,
    '--dsw-alias-button-primary-dimmed': p.brandSoft,
    '--dsw-alias-button-info-hover': p.info,
    '--dsw-alias-button-elevated-fill': p.surface2,
    '--dsw-alias-button-floating-fill': p.surface1,
    '--dsw-alias-button-floating-hover': p.hoverBg,
    '--dsw-alias-button-tool-bar-fill': p.surface1,
    '--dsw-alias-button-tool-bar-fill-invisible': 'transparent',
    '--dsw-alias-button-contrast-fill': p.textPrimary,
    // 状态次级色
    '--dsw-alias-state-success-secondary': p.success,
    '--dsw-alias-state-success-tertiary': p.brandSoft,
    '--dsw-alias-state-warn-secondary': p.warning,
    '--dsw-alias-state-warn-tertiary': p.brandSoft,
    '--dsw-alias-state-error-secondary': p.danger,
    // Markdown / 代码
    '--dsw-alias-markdown-code-block': p.surface2,
    '--dsw-alias-markdown-code-block-banner': p.surface3,
    '--dsw-alias-markdown-inline-code': p.surface3,
    '--dsw-alias-markdown-placeholder': p.textMuted,
    '--dsw-alias-markdown-citation': p.textAccent,
    '--dsw-alias-markdown-code-segment-unselected': p.surface3,
    // 浮层
    '--dsw-alias-bg-overlay': p.surface1,
    '--dsw-alias-bg-skeleton': p.surface3,
    '--dsw-alias-bg-multi-select': p.hoverBg,
    '--dsw-alias-bg-module-platform': p.surface2,
    '--dsw-alias-tooltip-bg': p.textPrimary,
    '--dsw-alias-toast-bg': p.surface2,
    // 反白
    '--dsw-alias-label-primary-inverted': p.pageBg,
    '--dsw-alias-label-primary-foreground': p.pageBg,
    '--dsw-alias-border-inverted': p.pageBg,
    '--dsw-alias-border-inverted2': p.pageBg,
    '--dsw-alias-brand-text': p.pageBg,
    '--dsw-alias-interactive-bg-hover-danger': p.danger,
  }
}

/**
 * 把一个主题展开成扁平的 `变量名 → 色值` 表。
 * `native` 主题返回空表：它不覆盖任何令牌，只靠应用脚本钉住基底模式
 * （light/dark），因此拿到的就是 DSH 内置的原生配色。
 * @param {{native?: boolean, palette: Record<string,string>}} theme
 * @returns {Record<string,string>}
 */
export function buildVars(theme) {
  if (!theme || theme.native) return {}
  const p = theme.palette || {}
  /** @type {Record<string,string>} */
  const vars = {}
  for (const role of Object.keys(ROLE_TO_TOKENS)) {
    const value = p[role]
    if (!value) continue
    for (const token of ROLE_TO_TOKENS[role]) vars[token] = value
  }
  Object.assign(vars, derived(p))
  return vars
}
