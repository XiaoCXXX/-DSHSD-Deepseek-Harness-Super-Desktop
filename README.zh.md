# DSH 桌面客户端

[English](README.md) | **中文**

⚠️注意：本项目完全由deepseek编写，甚至以下介绍的主体也是deepseek干的，我只负责维护，命令ds干活和检查信息的正确性

**DSHSD** = **D**eepseek **H**arness **S**uper **D**esktop，项目简称；安装包（`DSHSD-Setup-<版本>.exe`）和桌面快捷方式都用这个名字。

把 DeepSeek Harness 装进一个真正的桌面应用：**双击即用，不用敲命令、不用开浏览器，也不用先装 Node.js**。

安装包**自带 DSH 本体**，开箱即可运行；DSH 界面铺满窗口，所有控制项以**悬浮选项栏**浮在右上角。
本客户端为dsh的功能提供了延伸，你可以在未启动的情况下通过客户端进行配置。本客户端同时拥有主题功能。

---

## 给最终用户
由于deepseek自行写的说明书是为了解析本客户端原理的，以下为极简使用方式：
从release中下载安装包
安装客户端
双击客户端快捷方式启动

首次启动需要配置你的api-key，这显而易见

### 安装

双击 `DSHSD-Setup-<版本>.exe`（当前为 `DSHSD-Setup-0.1.3.exe`），一路下一步即可（默认装到当前用户目录，无需管理员权限），
安装完桌面会多一个 **DSHSD** 快捷方式（快捷方式与卸载项名称都是英文）。

**目标机器不需要预装 Node.js / pnpm / npx** —— 安装包里已经带了。

### 首次启动

双击快捷方式。客户端会自动：

1. 在 `%USERPROFILE%\.dsh` 下创建 DSH 的 web profile；
2. 把随包附带的小鲸鱼余额挂件装好并启用；
3. 拉起 DSH 服务并直接显示界面。

**每个使用者都必须配置自己的 `DEEPSEEK_API_KEY`**，获取api-key请前往deepseek官网的开放平台

> 关闭窗口只会最小化到**托盘**，服务继续运行。要真正退出请点悬浮栏「设置」里的 **退出客户端**，或托盘右键 → 退出。

### 界面

```
┌─ 窗口（DSH 界面铺满）──────────────┐
│                    ┌─────────────┐ │
│                    │● 运行中·接管 │ │ ← 悬浮条常驻右上角
│                    │ CNY 147.18  │ │
│                    │ ▶ ■ ⟳ ⋯    │ │
│                    └─────────────┘ │
└────────────────────────────────────┘
```

点 `⋯` 展开成五个可折叠选项栏：

| 选项栏 | 内容 |
|---|---|
| **服务** | 端口 / PID / 已运行时长 / 工作目录，启动·停止·重启·在浏览器打开 |
| **项目** | 项目列表（工作目录 + 端口），新建 / 编辑 / 删除 / 切换 |
| **插件** | 已安装插件清单（版本、是否界面层），逐个更新 / 卸载，也可填包名安装 |
| **日志** | 服务端 / 客户端 / 插件三类输出，可筛选、清空、打开日志文件 |
| **设置** | 开机自启、自动拉起服务等开关，界面主题与界面语言，自动切换界面，环境探测结果，隐藏窗口，退出客户端 |

双击悬浮条空白处也能开合；展开后按 `Esc` 收起。

界面切换、折叠栏开合、按键按下都带过渡动画；切换主题时颜色会平滑渐变，
并且会跟随系统的「减少动态效果」设置自动关闭动画。

### 主题

六套主题：**DSH 原生白蓝**、**DSH 原生暗色**（这两套是原生的），加上**冰蓝**、**深海**、**午夜**、**高对比**。
一处切换同时驱动两个平面：客户端自己的 `--c-*` 令牌，以及 DSH Web 界面的 `--dsw-*` 令牌。

DSH 那一侧由随安装包分发的两个自带插件之一 [`plugins/dsh-theme-pack`](plugins/dsh-theme-pack) 负责：
它提供主题载荷、往 DSH 页面注入一小段 applier 脚本，状态存在 `$DSH_HOME/.dsh-theme.json`。
applier 把配色写成 `<html>`/`<body>` 上的 inline `!important` 自定义属性，这样 DSH 自带的
presenter 顶不掉；同时按主题声明的 `colorScheme` 钉住基底模式（`body[data-ds-dark-theme]`）。

选中**原生**主题时，applier 会把自己写过的变量全部清掉、并解除基底模式的强制，完全交还给 DSH——
否则上一套主题那些带 `!important` 的变量会继续压着 DSH 自己的调色板，表现就是「切回原生主题没反应」。

### 三种界面形态与手动切换

客户端有三个形态：**悬浮条 + DSH 界面**（`bar`）、**铺满窗口的客户端控制台**（`console`）、
以及**便携悬浮窗**（`bubble`）。

默认是**手动切换**：悬浮条右上角的 `▣` 按钮切到控制台，控制台头部的「返回 DSH 界面」切回来；
手动选择会记住，下次启动仍是你选的那个。`❐` 按钮进入便携悬浮窗。

想让形态随服务启停自动切换（停止时铺开控制台、运行中缩回悬浮条），打开
**设置 → 服务启停时自动切换界面**。点手动切换按钮会隐含关闭该开关——
否则下一次服务状态变化就会把你手动选的形态顶掉。
便携悬浮窗只能手动选：它跟「服务有没有在跑」无关，自动推导不出来。

### 便携悬浮窗（快速提问）

这个形态下整个客户端只剩两件东西：**悬浮控制台**和**可以打字的气泡**。

- 无边框、置顶的 380×540 小窗，顶部那条既是控制台也是拖动把手。
- 在气泡里提问。回答过程中正文流式显示，这一轮结束后会把完整回答压成**一句话**。
- 点「查看完整回答」会切回能看到 DSH 界面的窗口——完整回答就在那段对话里。
- `✕` 收起悬浮窗（不是退出客户端），`⤢` 直接跳到 DSH 界面。

「设置 → 便携悬浮窗」下有两个选项：

| 选项 | 取值 | 含义 |
|---|---|---|
| 快速提问落在哪个会话 | 当前活跃会话 / 专用会话 | 当前活跃会话复用你正在聊的那段，完整回答天然就在屏幕上；专用会话另开一个 `快速提问 / Quick ask`，不打扰现有对话。 |
| 简答怎么产生 | 让模型压成一句话 / 直接截断 | 模型方式会额外发一次小调用（与回答同一路由，关掉 thinking）要一句话；截断方式直接砍完整回答，模型调用失败时也会自动退到这条。 |

#### 快速提问是怎么接起来的

客户端**不走** DSH 的内部 RPC。安装包里另外带了一个小 DSH 插件
[`plugins/dsh-quick-ask`](plugins/dsh-quick-ask)，它跑在 DSH 进程内，只对外暴露一个普通的 SSE 路由：

```
GET /dsh-quick/ask?id=…&q=…&session=active|dedicated&summary=model|truncate
    → text/event-stream: answer / summary / done / error
```

插件内部用 `ctx.sessionController` 建立/恢复会话并投递提问，用 `ctx.on('session/event')`
盯住**自己那一轮**（按提问的 `requestId` 匹配），用 `ctx.llm.stream()` 做那一句话摘要。
摘要调用不会往任何会话日志里写东西，所以快速提问不会污染对话。

### 界面语言

支持**中文 / English**，在「设置 → 界面语言」里切换，一处同时作用于：

- 本客户端界面（悬浮栏、控制台、托盘菜单）
- DSH 自身界面 —— 通过写入 `$DSH_HOME/settings.yaml` 的 `locale.preference`（`zh` / `en`）

DSH 用 chokidar 监听该文件，因此**切换即时生效，不需要重启服务**；写入时会保留文件里
其它命名空间的内容（例如 `ui-onboarding`）。客户端启动时也会同步一次，保证两边一致——
也就是说**客户端是语言的唯一入口**，若在 DSH 自己的设置里改语言，下次启动会被同步回来。

日志也跟随语言：客户端自己产生的行（启动、接管、签发 cookie、插件命令等）按当前语言输出；
**DSH 服务端与 pnpm 的输出原样透传，不翻译**。已产生的历史日志保持当时的语言不变。

---

## 架构

### 单窗口分层

一个 `BrowserWindow` 里叠了三个 `WebContentsView`：

```
┌─ 窗口 ────────────────────────────────────┐
│  dshView          DSH 本体界面（铺满）      │  ← 运行时显示
│  overlayView      悬浮选项栏（透明、置顶）  │  ← 始终在最上层
└───────────────────────────────────────────┘
```

**关键点**：悬浮栏视图的大小会被精确设置成它自身内容的尺寸（收起时约 320×54，展开时约 396×702）。
这样面板以外的区域在系统层面就不属于悬浮栏视图，鼠标事件会照常落到下面的 DSH 界面上——
不会出现「透明遮罩挡住点击」的问题。悬浮栏锚定**右上角**，避开右下角的小鲸鱼挂件。

### 运行时（两种模式）

`lib/runtime.js` 按优先级解析：

| 模式 | 何时使用 | node | dsh |
|---|---|---|---|
| **bundled** | 存在 `resources/dsh/`（安装包形态） | **Electron 自带的 Node**（`ELECTRON_RUN_AS_NODE=1`） | `resources/dsh/node_modules/@deepseek-ai/dsh` |
| **system** | 开发期 / 未打包 | 系统 `node.exe` | npx 缓存或全局安装的 dsh |

打包形态不需要单独分发 `node.exe`，直接用 Electron 内置的 Node 24。

> **必须带 `--expose-internals`**：DSH 的 HMR 服务需要 Node 内部模块。
> `cordis-plugin-loader` 有两条获取路径——带该标志时走 `require()`，否则回落到原生插件
> `node-addon-require-builtin`；后者是按系统 Node 的 ABI 编译的，在 Electron 下加载会失败。
> 所以 bundled 模式始终传这个标志（`lib/runtime.js` 里有注释说明）。

### 首次运行的环境准备

`lib/provision.js` 不依赖 pnpm：

1. 若 profile 不存在，按 DSH 自带模板生成 `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml`；
2. 把 `resources/plugins/dsh-whale-widget` 复制进 profile 的 `node_modules`（**仅在缺失时**，
   不覆盖用户自己装的版本）；
3. 把插件名写进 `dsh.profile.bundles`。

> 为什么必须复制到 profile 的 `node_modules`：bundle 是以 **ES module 从 profile 目录 import** 的，
> 只放在 DSH 安装锚点虽然能被 `resolveBundleDir` 找到，但 import 时会 `ERR_MODULE_NOT_FOUND`。

### 关于认证（为什么不用手动登录）

DSH 每次启动会生成一个随机令牌，并把带 `?token=...` 的 URL 打印到 stdout；
访问该 URL 后服务器会写入一个绑定 `host:port` 的签名 cookie（有效期 30 天）。客户端两条路都走：

1. 自己启动服务时 → 直接从 stdout 抓取令牌；
2. 接管别人启动的服务时 → 用凭据库里的签名密钥**自行签发**同样的 cookie。

签名算法（`lib/auth-cookie.js` 复刻自 `@deepseek-ai/dsh-client-connection`）：

```
cookie 名 = "dsh-auth-" + base64url(sha256(authority))
cookie 值 = "v1." + base64url(JSON{version,authority,issuedAt,expiresAt})
                  + "." + base64url(HMAC-SHA256(secret, <中间的 base64url 串>))
密钥      = $DSH_HOME/.credentials.yaml 中 client-connection/browser-session 的 payload.secret
```

因为密钥持久化在凭据库、cookie 绑定的是 `127.0.0.1:<端口>` 而非进程，所以**跨服务器重启依然有效**。

---

## 开发

```powershell
npm install
npm start                      # 开发运行（使用系统 node + 已安装的 dsh）
npm start -- --hidden          # 不显示任何窗口，便于自动化验证

node tools/selftest.js         # 不依赖 Electron 的能力自检（含 cookie 签发验证）
node tools/verify.js           # 界面/结构验证 + 截图（.verify\）
node tools/verify-lifecycle.js # 独立端口真实跑 启动→重启→停止
node tools/verify-packaged.js  # 全新 DSH_HOME 下验证「随包 DSH」运行链路
electron tools/preview-overlay.js  # 只渲染悬浮栏并截图，快速迭代外观
electron tools/make-icon.js    # 重新生成 assets/icon.ico
```

### 打包

```powershell
npm run build        # 生成 dist\DSHSD-Setup-<version>.exe
npm run build:dir    # 只出免安装目录 dist\win-unpacked（调试用）
npm run verify:build # 验证产物：用独立端口跑打包后的 exe 并检查路由
```

物料准备由 `tools/stage-vendor.js` 完成：

- `vendor/dsh/` —— 通过 `npm install @deepseek-ai/dsh@<版本>` 拉取的 DSH 本体（约 212 MB）
- `vendor/plugins/dsh-whale-widget/` —— 随包挂件

可用环境变量覆盖：`DSH_VERSION`（默认 `0.1.5-rc.1`）、`WHALE_SOURCE`（挂件来源目录）。

> **维护者注意**：electron-builder 的过滤器
> （`app-builder-lib/out/util/filter.js`）会**无条件排除**相对路径等于或以 `/node_modules`
> 结尾的目录，`extraResources` 里整棵 `node_modules` 都不会被复制（`filter: ["**/*"]` 也救不了）。
> 因此 `electron-builder.config.js` 在构建时枚举出所有 `node_modules` 目录，
> 把 `from` 指到每一层的**内部**，让相对路径变成各包名而非 `node_modules` 本身。

### 目录

```
dsh-client/
├── main.js                     Electron 主进程（单窗口三视图、托盘、IPC、余额轮询）
├── preload.js                  contextBridge 安全桥
├── electron-builder.config.js  打包配置（动态生成 extraResources）
├── lib/
│   ├── runtime.js              运行时解析（bundled / system）+ 安全开关说明
│   ├── provision.js            首次运行的 profile 准备与插件预装
│   ├── config.js               配置持久化与多项目
│   ├── dsh-locator.js          定位 node / dsh / 挂件资源
│   ├── auth-cookie.js          自行签发会话 cookie
│   ├── server-manager.js       服务进程生命周期
│   └── logger.js               环形缓冲 + 落盘日志
├── renderer/
│   ├── control.html/css/js     悬浮选项栏 / 全窗口控制台
├── tools/                      自检、验证、预览、图标、物料准备
├── vendor/                     打包物料（dsh / plugins，构建时生成）
└── dist/                       打包产物
```

---

## 配置与数据位置

| 内容 | 路径 |
|---|---|
| 客户端配置 | `%APPDATA%\dsh-desktop-client\config.json` |
| 客户端日志 | `%APPDATA%\dsh-desktop-client\logs\dsh-client.log` |
| Electron 会话（含 cookie） | `%APPDATA%\dsh-desktop-client\Partitions\` |
| DSH 家目录 / profile | `%USERPROFILE%\.dsh\` |
| 挂件账本 | `%USERPROFILE%\.dsh\.dshw-usage.json` |

---

## 已知限制

- 仅面向 Windows x64（停止进程依赖 `taskkill`，端口探测依赖 `netstat`）。
- **插件的安装/更新/卸载仍需系统装 pnpm**（`dsh plugin` 是 pnpm 的转发器）。
  随包内置的挂件不受影响；缺少 pnpm 时日志会给出明确提示。
  首次运行预装挂件这条路径**不依赖 pnpm**。
- 「停止」在接管模式下会结束端口上的监听进程——如果那是你手动启动的实例，它也会被关掉。
- 余额与今日已用读取挂件的 `/dsh-whale/balance.json`；未配置 API Key 时显示 `--`，服务状态仍正常。
- 本地记账模式下「今日已用」依赖余额差值，客户端未运行时产生的消耗不会被计入（挂件自身的行为）。
- 开发提示：透明的 `WebContentsView` 无法用 CDP `Page.captureScreenshot` 截图（会超时），
  悬浮栏外观请用 `tools/preview-overlay.js` 查看。

### 两个容易踩的环境陷阱

**① 不要给 DSH 注入名字含 `KEY`/`TOKEN`/`SECRET` 的环境变量。**
`dsh-subprocess` 会按 `/KEY|PASSWORD|SECRET|TOKEN/i` 清洗传给子进程的环境
（这是防凭据泄漏的安全设计）。曾经为了让 git 走 openssl 而注入
`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`，
结果 `KEY_0` 被清掉、另两个留下，git 直接报
`missing config key GIT_CONFIG_KEY_0` 并**拒绝执行任何命令**。
git 的 schannel 后端在非受限进程里本就正常，这个绕过既无必要也有害。

**② 随包 DSH 运行时会向子进程传染 `ELECTRON_RUN_AS_NODE=1`。**
bundled 模式靠这个变量让 Electron 以 Node 模式承载 DSH，但它会留在 DSH 进程的环境里
并被继承下去。后果：**在 DSH 会话里启动任何 Electron 程序都会以纯 Node 模式运行**
（`require('electron').app` 为 `undefined`）而崩溃——`npm start` 本客户端就会中招。
`tools/` 下的脚本已统一加 `delete process.env.ELECTRON_RUN_AS_NODE` 自保；
`make-icon` / `preview-overlay` 这类本身要跑在 Electron 里的脚本请用
`node tools/run-electron.js <脚本>` 启动。
若想彻底消除该污染，可改为随包分发独立的 `node.exe`（代价是安装包大约 +80 MB）。

---

## 第三方组件与许可

本项目自身代码以 MIT 协议发布。构建产物中随包分发以下第三方组件，全部为 MIT 协议：

| 组件 | 许可 | 来源 |
|---|---|---|
| [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（`@deepseek-ai/dsh` 及其依赖） | MIT | npm，构建时由 `tools/stage-vendor.js` 拉取 |
| [小鲸鱼余额挂件](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（`dsh-whale-widget`） | MIT © 2026 MeteorNOX | 构建时从上游仓库拉取 |
| [Electron](https://github.com/electron/electron) | MIT | npm |

关于小鲸鱼挂件：上游是 **MIT 协议**，明确允许再分发（`publish, distribute, sublicense`），
因此安装包中随包分发该插件是合规的；插件自带的 `LICENSE` 文件会一并放进
`resources/plugins/dsh-whale-widget/LICENSE`，满足 MIT 要求的"保留版权声明与许可全文"。

本仓库**不包含**上述第三方的源码（`vendor/` 已在 `.gitignore` 中排除），
构建时由 `npm run stage` 自动获取。

---

## 许可证

本项目以 [MIT License](LICENSE) 发布。

安装包中随包分发的第三方组件（DeepSeek Harness、小鲸鱼余额挂件、Electron）同样为 MIT 协议，
各自的版权声明见其自身的 `LICENSE` 文件。
