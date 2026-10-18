# DSH – Enhanced Model Support

一个模型座位，同时提供**模型选择**、**思考强度**与**订阅用量**。

DeepSeek Harness 原生把「模型」交给 `dsh-client-ui-model-selection`，思考强度与用量则各自散落。本插件用单个座位把它们合并进同一个菜单：

```
[ 模型        DeepSeek-V4.1-Flash  1017  › ]
[ 思考强度    High（随档位变色）        › ]
──────────────────────────────────────────
  订阅用量                                 刷新
  ChatGPT / Codex  ·  user@example.com
    5 小时窗口                      12%
    ▓▓░░░░░░░░░░░░░░░░░░   1h 42m 后重置
    每周窗口                        43%
    ▓▓▓▓▓▓▓░░░░░░░░░░░░   3d 4h 后重置
  Claude  ·  user@example.com
    …
```

## 功能

### 模型选择

- 与原生座位一致：按厂商分组列出模型、切换、记住选择
- 保留官方模型标签插槽，并在拿不到渲染器时内联绘制等价标记（例如 `DeepSeek-V4.1-Flash` 的 `1017`）

### 思考强度

- 把原来的档位按钮列表换成吸附式滑条
- **档位配色与滑条联动**：常规档蓝色 `#4a9eff`、次顶档紫色 `#a97bff`、最高档流动渐变（`ths-topFlow`）
- 到顶有爆发动画与光晕；`prefers-reduced-motion` 下保留颜色、关闭动画
- 自定义厂商（没有上游 reasoning 目录）时回退到 low/medium/high/max/xhigh 五档

### 订阅用量

- 直接读取 [`dsh-plugin-subscriptions`](https://github.com/V1ki/dsh-plugin-subscriptions) 已归一化的 `subscriptions-auth` RPC
- 因此**自动兼容所有主流厂商的计量方式**：

| 厂商 | 计量 | 展示 |
| --- | --- | --- |
| ChatGPT / Codex | 5 小时 + 每周窗口 | 进度条 + 重置倒计时 + 可用重置次数 |
| Claude | 5 小时 / 每周（含模型级 `scope`） | 进度条 + 倒计时，`scope` 附在标签后 |
| GitHub Copilot | 配额窗口 | 进度条 + 倒计时 |
| Google Antigravity | 配额 / 积分 | 进度条或文本 |
| Grok | 无公开接口 | 明确标注「不提供用量接口」 |

百分比配色：`<80%` 绿 / `80–94%` 琥珀 / `>=95%` 红。区块高度上限 240px，超出独立滚动；面板内可强制刷新（绕过服务端缓存）。

## 优雅降级

- 没有登录任何订阅账号 → 用量区块整块不渲染
- 没有安装 `dsh-plugin-subscriptions` → 用量区块不渲染，模型与思考强度照常工作
- 座位以 `priority: -2` 注册，优先于随客户端分发的 `thinking-slider`（-1）

## 安装

```bash
dsh plugin --profile web add dsh-enhanced-model-support
```

或手动放置：复制本目录到 `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-enhanced-model-support`，并把 `dsh-enhanced-model-support` 加进该 profile `package.json` 的 `dsh.profile.bundles`。

> 如果同时装有 `thinking-slider` 或 `dsh-subscription-usage`，建议移除，避免重复注册同一座位/区块。

安装后重启 DSH 服务。

## 依赖

- DeepSeek Harness `0.2.1-rc.2`
- 可选：[`dsh-plugin-subscriptions`](https://github.com/V1ki/dsh-plugin-subscriptions) `>= 0.9.9`（仅用量区块需要）

## 结构

```
lib/index.js      host 半边：空实现，仅让 Loader 有东西可挂载
lib/client.js     浏览器半边：注册 conversation.input.model 座位
cordis.patch.yml  自激活补丁（dsh.profile.bundles 的载荷）
```

## 许可

MIT
