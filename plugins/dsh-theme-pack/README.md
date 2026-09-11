# dsh-theme-pack（设计文档 / 实现中）

给 DSH 桌面客户端 + DSH Web 界面提供**一套统一主题**：一次切换，同时改变

1. **DSH 桌面客户端**自己的界面（悬浮选项栏 / 未运行时的全面控制台）
2. **DSH Web 界面**的颜色（`--dsw-*` 令牌）
3. （可选）小鲸鱼挂件的颜色（见下方「挂件的颜色问题」）

目标状态由客户端「设置」面板里的主题切换器产生，持久化在客户端
`%APPDATA%\dsh-desktop-client\config.json` 的 `theme` 字段，并同步给 DSH 侧。

---

## 架构

沿用本项目已有的 `dsh-whale-widget` 先例（一个 DSH **bundle** 插件：宿主半 + 注入到页面的浏览器脚本）：

```
客户端 (Electron 主进程)
  ├─ renderer 用 CSS 变量渲染自己的界面（client 平面）
  └─ PUT /dsh-theme/theme.json  { "theme": "<id>" }
                    ↓
dsh-theme-pack（DSH 宿主插件）
  ├─ 存盘：$DSH_HOME/.dsh-theme.json
  ├─ GET  /dsh-theme/theme.json     读当前主题
  ├─ PUT  /dsh-theme/theme.json     写当前主题
  ├─ GET  /dsh-theme/theme.js       注入到 DSH 页面的应用脚本
  └─ GET  /dsh-theme/palettes.json  主题数据（供脚本/调试）
                    ↓
DSH Web 页面
  └─ applier 脚本：把主题色写进 document 的 --dsw-alias-* 自定义属性，
     并在主题变化时重放（DSH 自带主题 presenter 会重写这些属性，需要压制）
```

选择「宿主插件 + 注入脚本」而不是「cordis 客户端插件」的原因：DSH 的
客户端插件需要用仓库内的 `packages/client/tsdown.client.ts` 打成 lazy-CJS
工厂格式，该构建链未随 npm 包发布，仓库外的插件无法复现；而挂件已经证明了
「宿主插件 + 注入脚本」这条路可行。

---

## 主题清单

| id | 名称 | 基调 |
|---|---|---|
| `dsh-white-blue` | DSH 原生白蓝（**默认**） | 白底 + DSH 品牌蓝强调色，浅色平面 |
| `dsh-dark` | DSH 原生暗色 | 与内置暗色调色板一致 |
| `ice` | 冰蓝 | 更冷更淡的白蓝，低饱和背景、青色强调 |
| `ocean` | 深海 | 中等深度蓝灰底 + 亮青强调 |
| `midnight` | 午夜 | 近黑深蓝底，高对比文本，蓝紫强调 |
| `contrast` | 高对比 | 纯白/纯黑 + 最强对比，无障碍向 |

每套主题在**两个色板模式（light / dark 基底）**下都有取值——沿用 DSH 主题服务
的约定：覆盖层必须同时给出 `light` 与 `dark` 两组值，避免用户切换系统配色后
出现不可读的组合。`dsh-white-blue` 以 light 为基底、`dsh-dark` 以 dark 为基底，
其余主题各自声明。

---

## 挂件的颜色问题

`dsh-whale-widget@0.2.10` 的颜色是**硬编码**的，实测结论：

- 完全没有引用任何 `--dsw-*` 令牌
- 也没有引用 `data-ds-dark-theme` / `prefers-color-scheme`

所以**主题切换不会影响挂件**。它的色板（出现次数）：

| 颜色 | 用途 |
|---|---|
| `#203170`（10 处） | 主色：文字、气泡边线、图标描边 |
| `#FFFFFF` / `#fff` | 气泡底、文字反白 |
| `#9fb0d9` / `#536ba9` | 次级文字 / 次级描边 |
| `#e0433f` | 余额告警（负向） |
| `#2fa24c` | 正向（余额充足） |
| `rgba(32,49,112, ...)` | 各级透明叠加（.06/.08/.16/.25/.35/.4/.85） |

好在它本身**就是白蓝**（`#203170` + 白），与默认主题的观感一致，所以默认状态下
不违和。若要让挂件跟随主题，需要对挂件做一次小改造：把那 10 处 `#203170` 与
相关色值改成读取 `getComputedStyle(document.documentElement)` 的 DSH 令牌
（挂件脚本就跑在页面里，取得到）。这属于**第三方包的本地改造**，插件更新会覆盖，
因此作为可选项、且改造要记录在案。

---

## 待办

- [x] `--dsw-alias-*` 令牌共 79 个（实测抽取），palette 挂在 `:root` / `body[data-ds-dark-theme]`
- [x] 路由与注入机制取自 `dsh-whale-widget`：`ctx.webServer.register({kind:'exact',path,handler})` + `ctx.webServer.tapIndex(fn)`
- [x] `lib/themes.js` + `lib/token-map.js`：6 套主题 → 74 个令牌覆盖（native 主题不覆盖、靠钉住基底模式）
- [x] `lib/index.js`：GET/PUT `/dsh-theme/theme.json`、`/dsh-theme/theme.js`、`tapIndex` 注入、`$DSH_HOME/.dsh-theme.json` 存盘
- [x] 随安装包分发：源码收进 `dsh-client/plugins/dsh-theme-pack/`，由 `tools/stage-vendor.js` 复制进 vendor，客户端启动时自动装进 web profile 并写进 bundles
- [x] 客户端侧：`--c-*` 令牌化 + 主题下拉 + 写 `$DSH_HOME/.dsh-theme.json` 同步（不走 HTTP，避开 CORS/鉴权）
- [x] 端到端验证通过：`dsh-client/tools/verify.js`（两阶段）+ `dsh-client/tools/verify-dsh-theme.js`（跨平面切换）
