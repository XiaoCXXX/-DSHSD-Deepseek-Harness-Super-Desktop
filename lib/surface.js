'use strict'

// 服务状态 → 界面形态。
//
// 用户要求：**服务未运行时不要折叠**，要显示「全面的控制界面」；只有服务**启动过程中**
// 才折叠成悬浮条。因此只有过渡态（starting/stopping）与运行态用悬浮条，其余
// （stopped 以及任何未知状态）都用全面控制台——未知状态宁可多给控制项，不要少给。

const BAR_STATES = new Set(['starting', 'stopping', 'running', 'external'])

/**
 * @param {string} state ServerManager 的状态（stopped/starting/running/external/stopping）
 * @returns {'console'|'bar'}
 */
function surfaceForState(state) {
  return BAR_STATES.has(String(state || 'stopped')) ? 'bar' : 'console'
}

module.exports = { surfaceForState, BAR_STATES }
