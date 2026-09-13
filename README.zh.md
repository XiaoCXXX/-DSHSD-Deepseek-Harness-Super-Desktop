# DSH 桌面客户端

[English](README.md) | **中文**

## 概述

DSH 桌面客户端是 **DeepSeek Harness（DSH）** 的 Windows 桌面宿主程序。它将 DSH 服务、DSH Web
界面以及一组配套插件封装为单一应用程序，使 DSH 的启动不再需要终端、不需要手动打开浏览器，也不
要求目标机器预先安装 Node.js 工具链。

**DSHSD** = **D**eepseek **H**arness **S**uper **D**esktop。该缩写为本项目简称，同时用作安装包
（`DSHSD-Setup-<版本>.exe`）、桌面快捷方式与卸载项的名称。

### 主要特性

- 安装包**内置 DSH 运行时**，目标机器无需安装 Node.js、pnpm 或 npx。
- DSH Web 界面铺满应用窗口，客户端全部控制项位于锚定右上角的**悬浮选项栏**内。
- 客户端在两个方向上对 DSH 作出扩展：服务停止时仍可进行配置，并在 DSH 原有外观之上增加了完整
  的主题系统。
- 安装包**不包含任何凭据**，自身也不发起任何模型调用。

> **关于作者。** 本项目源码及本文档的主体均由 DeepSeek 生成。维护者的职责是向智能体下达指令，并
> 核实本文所述信息的准确性。

---

## 一、安装与首次启动

### 1.1 环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11，x64 |
| 磁盘空间 | 安装后约 500 MB |
| 权限 | 管理员权限（安装程序为全机器安装） |
| 预装运行时 | 无。**不需要** Node.js、pnpm 或 npx |
| 凭据 | 使用者本人的 `DEEPSEEK_API_KEY` |

### 1.2 安装步骤

1. 从 [Releases](../../releases) 下载 `DSHSD-Setup-<版本>.exe`，当前版本为 `1.0.0-HF1`。
2. 运行安装程序并按提示操作。由于安装包为全机器安装，Windows 会请求一次提权，请予批准。
3. 安装完成后，桌面会创建 **DSHSD** 快捷方式，并在「应用和功能」中登记卸载项。

> 由早于 `1.0.0-HF1` 的版本升级时，卸载项可能出现两条。原因是该版本将安装方式由「当前用户」改
> 为「全机器」，注册位置随之由 `HKCU` 迁移至 `HKLM`。原有的用户级条目可以删除。

### 1.3 首次启动

通过快捷方式启动客户端后，将依次执行以下操作：

1. 若 `%USERPROFILE%\.dsh` 下的 DSH Web profile 不存在，则创建之；
2. 安装并启用安装包内置的插件；
3. 启动 DSH 服务，并在应用窗口中显示其界面。

**每位使用者都必须配置自己的 API Key**，可从 DeepSeek 开放平台获取。DSH 会在首次启动时主动要求
输入，无需自行查找或编辑配置文件。

> 关闭应用窗口只会将其最小化至**托盘**，服务继续运行。如需完全退出，请使用「设置」中的**退出客
> 户端**，或在托盘图标上右键选择「退出」。

---

## 二、用户界面

### 2.1 布局

```
┌─ 窗口（DSH 界面铺满）──────────────┐
│                    ┌─────────────┐ │
│                    │● 运行中·接管 │ │ ← 悬浮条常驻右上角
│                    │ CNY 147.18  │ │
│                    │ ▶ ■ ⟳ ⋯    │ │
│                    └─────────────┘ │
└────────────────────────────────────┘
```

选择 `⋯` 可将悬浮条展开为五个可折叠选项栏：

| 选项栏 | 内容 |
|---|---|
| **服务** | 端口、进程 ID、已运行时长与工作目录；启动、停止、重启、在浏览器中打开 |
| **项目** | 项目列表（工作目录与端口）；新建、编辑、删除、切换 |
| **插件** | 已安装插件及其版本与是否界面层；逐个更新、卸载，亦可按包名安装 |
| **日志** | 服务端、客户端、插件三类输出；可筛选、清空、打开日志文件 |
| **设置** | 开机自启、自动拉起服务、界面主题、界面语言、自动切换界面、环境探测、隐藏窗口、退出客户端 |

双击悬浮条空白区域同样可以开合；展开后按 `Esc` 收起。

界面切换、选项栏开合与按键按下均带有过渡动画，切换主题时颜色为平滑插值。当操作系统请求「减少动
态效果」时，全部动画会自动关闭。

### 2.2 主题

客户端提供六套主题：两套 DSH 原生主题（**DSH 原生白蓝**、**DSH 原生暗色**），以及**冰蓝**、**深
海**、**午夜**、**高对比**。单次选择同时驱动两个表现层——客户端自身的 `--c-*` 令牌与 DSH Web 界
面的 `--dsw-*` 令牌。

DSH 一侧由随安装包分发的插件 [`plugins/dsh-theme-pack`](plugins/dsh-theme-pack) 实现。该插件提供
主题载荷、向 DSH 页面注入一小段 applier 脚本，并将状态持久化于 `$DSH_HOME/.dsh-theme.json`。
applier 将配色写为 `<html>` 与 `<body>` 上的内联 `!important` 自定义属性，使 DSH 自带的 presenter
无法覆盖；同时按所选主题钉住基底配色方案（`body[data-ds-dark-theme]`）。

选中**原生**主题时，applier 会清除其先前写入的全部变量并解除基底配色方案的钉定，将控制权完全交
还 DSH。若缺少这一步骤，上一套主题那些带 `!important` 的变量将持续压制 DSH 自身的调色板，其表现
即为「切回原生主题没有反应」这一缺陷。

### 2.3 界面形态

客户端提供三种形态：**悬浮条 + DSH 界面**（`bar`）、**铺满窗口的客户端控制台**（`console`），以
及**便携悬浮窗**（`bubble`）。

默认采用**手动切换**：悬浮条中的 `▣` 按钮打开控制台，控制台头部的「返回 DSH 界面」返回悬浮条。
所选形态会持久保存，重启后保持不变。`❐` 按钮进入便携悬浮窗。

若希望形态随服务状态变化（停止时展开控制台，运行时收回悬浮条），请启用**设置 → 服务启停时自动切
换界面**。手动选择形态会隐含地关闭该开关，否则下一次服务状态变化将覆盖手动选择。便携悬浮窗仅可手
动选择：它与服务是否运行无关，因而无法由服务状态推导。

### 2.4 便携悬浮窗（快速提问）

该形态下，客户端仅由两个元素构成：**悬浮控制台**与**可输入的气泡**。

- 无边框、置顶的 380×540 窗口；顶部条带既为控制台，亦作拖动把手。
- 在气泡中输入问题。回答过程中，正文以流式显示于气泡内；该轮结束后，完整回答会被压缩为**一句
  话**。
- 「查看完整回答」将返回显示 DSH 界面的窗口，完整回答即位于该段对话中。
- `✕` 收起悬浮窗，但不退出客户端；`⤢` 直接切换至 DSH 界面。

**设置 → 便携悬浮窗**下提供两个选项：

| 选项 | 取值 | 含义 |
|---|---|---|
| 快速提问使用的会话 | 当前活跃会话 / 专用会话 | 「当前活跃会话」复用正在进行的对话，完整回答天然位于屏幕之上；「专用会话」另开一个 `快速提问 / Quick ask` 会话，不影响既有对话。 |
| 简答的产生方式 | 模型 / 截断 | 「模型」额外发起一次小规模模型调用（与回答同一路由，且关闭推理），要求输出一句话；「截断」直接截取完整回答。模型调用失败时自动改用截断。 |

#### 2.4.1 快速提问的实现

客户端**不使用** DSH 的内部 RPC。安装包另行分发一个 DSH 插件
[`plugins/dsh-quick-ask`](plugins/dsh-quick-ask)，该插件运行于 DSH 进程内，对外仅暴露一个普通 SSE
路由：

```
GET /dsh-quick/ask?id=…&q=…&session=active|dedicated&summary=model|truncate
    → text/event-stream: answer / summary / done / error
```

插件内部使用 `ctx.sessionController` 建立或恢复会话并投递提问，使用 `ctx.on('session/event')` 观察
该特定轮次（按提问的 `requestId` 匹配），并使用 `ctx.llm.stream()` 生成那一句话摘要。摘要调用不会
向任何会话日志写入内容，因此快速提问不会污染对话。

### 2.5 界面语言

界面支持**中文 / English**，可在**设置 → 界面语言**中切换。单次选择同时作用于两个层面：

- 客户端自身——悬浮栏、控制台与托盘菜单；
- DSH 界面——通过向 `$DSH_HOME/settings.yaml` 写入 `locale.preference`（`zh` / `en`）实现。

DSH 使用 chokidar 监听该文件，因此切换即时生效，**无需重启服务**。写入时会保留文件中其它命名空间
的内容（例如 `ui-onboarding`）。客户端在启动时亦会同步一次，以保证两个层面一致。因此**客户端是语
言的唯一控制入口**：在 DSH 自身设置中所作的修改，将在下次启动客户端时被同步回来。

日志输出遵循同一设置：由客户端自身产生的行（启动、接管、签发 cookie、插件命令等）按当前语言写
入；**DSH 服务端与 pnpm 的输出原样透传，不予翻译**。既有日志行保持其写入时的语言。

---

## 三、架构

### 3.1 单窗口分层视图

一个 `BrowserWindow` 承载两个堆叠的 `WebContentsView`：

```
┌─ 窗口 ────────────────────────────────────┐
│  dshView          DSH 界面（铺满窗口）      │  ← 运行时显示
│  overlayView      悬浮选项栏（透明、置顶）  │  ← 始终位于最上层
└───────────────────────────────────────────┘
```

其关键在于：悬浮栏视图的尺寸被精确设置为其自身内容的尺寸（收起时约 320×54，展开时约 396×702）。
因此悬浮栏以外的区域在操作系统层面并不属于该视图，鼠标事件可正常抵达其下方的 DSH 界面，不存在
「透明遮罩拦截点击」的问题。悬浮栏锚定于右上角，以避开右下角的桌面宠物。

### 3.2 运行时解析

`lib/runtime.js` 按以下优先级解析运行时：

| 模式 | 适用情形 | node | dsh |
|---|---|---|---|
| **bundled** | 存在 `resources/dsh/`（安装包形态） | **Electron 内置 Node**（`ELECTRON_RUN_AS_NODE=1`） | `resources/dsh/node_modules/@deepseek-ai/dsh` |
| **system** | 开发期，或未打包 | 系统 `node.exe` | npx 缓存或全局安装的 dsh |

打包形态不单独分发 `node.exe`，而是直接使用 Electron 内置的 Node 24。

> **必须传递 `--expose-internals` 标志。** DSH 的 HMR 服务依赖 Node 内部模块。
> `cordis-plugin-loader` 有两条获取途径：带该标志时使用 `require()`，否则回退至原生插件
> `node-addon-require-builtin`；后者按系统 Node 的 ABI 编译，在 Electron 下加载会失败。因此
> bundled 模式始终传递该标志，详见 `lib/runtime.js`。

### 3.3 首次运行的环境准备

`lib/provision.js` 不依赖 pnpm：

1. 若 profile 不存在，则依据 DSH 自带模板生成 `package.json`、`cordis.patch.yml` 与
   `pnpm-workspace.yaml`；
2. 将内置插件复制进 profile 的 `node_modules`。文件缺失时始终安装；已有安装在其版本较新**或**
   内容哈希不同时予以刷新，从而避免过期副本在升级后残留；
3. 将插件名写入 `dsh.profile.bundles`。

> 复制进 profile 的 `node_modules` 是必需的，因为 bundle 是以 **ES module 相对于 profile 目录**
> 导入的。仅置于 DSH 安装锚点虽可被 `resolveBundleDir` 找到，但导入本身会以
> `ERR_MODULE_NOT_FOUND` 失败。

### 3.4 认证机制

DSH 在启动时生成一个随机令牌，并将含 `?token=…` 的 URL 打印至 stdout。访问该 URL 后，服务器会写
入一个绑定 `host:port`、有效期 30 天的签名 cookie。客户端两条途径均会使用：

1. 由客户端自身启动服务时，直接从 stdout 读取令牌；
2. 接管由其它进程启动的服务时，使用凭据库中的签名密钥**自行签发**同一 cookie。

签名方案（`lib/auth-cookie.js`，复刻自 `@deepseek-ai/dsh-client-connection`）：

```
cookie 名 = "dsh-auth-" + base64url(sha256(authority))
cookie 值 = "v1." + base64url(JSON{version,authority,issuedAt,expiresAt})
                  + "." + base64url(HMAC-SHA256(secret, <中间的 base64url 串>))
密钥      = $DSH_HOME/.credentials.yaml 中 client-connection/browser-session 的 payload.secret
```

由于密钥持久化于凭据库，且 cookie 绑定的是 `127.0.0.1:<端口>` 而非某个进程，因此**跨服务重启依然
有效**。

---

## 四、开发

### 4.1 命令

```powershell
npm install
npm start                      # 开发运行（系统 node + 已安装的 dsh）
npm start -- --hidden          # 不显示任何窗口，便于自动化

node tools/selftest.js         # 不依赖 Electron 的能力自检（含 cookie 签发）
node tools/verify.js           # 界面与结构验证，含截图（.verify\）
node tools/verify-lifecycle.js # 在备用端口上真实执行 启动 → 重启 → 停止
node tools/verify-packaged.js  # 在全新 DSH_HOME 下验证「随包 DSH」运行链路
node tools/verify-i18n-live.js # 语言切换、动画、界面形态切换
node tools/check-sync.js       # 校验插件三份副本内容一致
node tools/run-electron.js tools/preview-overlay.js  # 仅渲染悬浮栏并截图
node tools/run-electron.js tools/make-icon.js        # 重新生成 assets/icon.ico
```

### 4.2 打包

```powershell
npm run build        # 生成 dist\DSHSD-Setup-<version>.exe
npm run build:dir    # 仅生成免安装目录 dist\win-unpacked（调试用）
npm run verify:build # 验证产物：运行打包后的可执行文件并探测其路由
```

物料准备由 `tools/stage-vendor.js` 完成：

- `vendor/dsh/` —— 通过 `npm install @deepseek-ai/dsh@<版本>` 安装的 DSH 运行时（约 212 MB）；
- `vendor/plugins/<名称>/` —— 内置插件，取自本仓库的 `plugins/`。

可用环境变量覆盖默认值：`DSH_VERSION`（默认 `0.1.5-rc.1`）。

> **维护者注意。** electron-builder 的过滤器（`app-builder-lib/out/util/filter.js`）会无条件排除
> 相对路径等于或以 `/node_modules` 结尾的目录，因此整棵 `node_modules` 会被静默地从
> `extraResources` 中丢弃，`filter: ["**/*"]` 亦无济于事。为此
> `electron-builder.config.js` 在构建时枚举出所有 `node_modules` 目录，将 `from` 指向每一层的内
> 部，使相对路径成为各包名而非 `node_modules`。

### 4.3 仓库结构

```
dsh-client/
├── main.js                     Electron 主进程（窗口、视图、托盘、IPC、余额轮询）
├── preload.js                  contextBridge 安全桥
├── electron-builder.config.js  打包配置（动态生成 extraResources）
├── lib/
│   ├── runtime.js              运行时解析（bundled / system）及标志说明
│   ├── provision.js            首次运行的 profile 准备与插件预装
│   ├── i18n.js                 主进程与渲染进程共用的中英文词典
│   ├── dsh-settings.js         写入 DSH 自身的语言偏好
│   ├── config.js               配置持久化与多项目
│   ├── dsh-locator.js          定位 node、dsh 与插件资源
│   ├── auth-cookie.js          自行签发会话 cookie
│   ├── server-manager.js       服务进程生命周期
│   └── logger.js               环形缓冲与落盘日志
├── renderer/
│   ├── control.html/css/js     悬浮选项栏与全窗口控制台
│   ├── bubble.html/css/js      便携悬浮窗
│   └── i18n.js                 渲染进程侧查表
├── plugins/                    内置 DSH 插件（唯一源头）
├── nsis/                       安装程序定制
├── tools/                      自检、验证、预览、图标、物料准备
├── vendor/                     打包物料（构建时生成）
└── dist/                       打包产物
```

---

## 五、配置与数据位置

| 内容 | 路径 |
|---|---|
| 客户端配置 | `%APPDATA%\dsh-desktop-client\config.json` |
| 客户端日志 | `%APPDATA%\dsh-desktop-client\logs\dsh-client.log` |
| Electron 会话数据（含 cookie） | `%APPDATA%\dsh-desktop-client\Partitions\` |
| DSH 家目录与 profile | `%USERPROFILE%\.dsh\` |
| 桌面宠物用量账本 | `%USERPROFILE%\.dsh\.dshw-usage.json` |

---

## 六、已知限制

- **仅支持 Windows x64。** 停止进程依赖 `taskkill`，端口探测依赖 `netstat`。
- **安装、更新或卸载插件仍需宿主机安装 pnpm**，因为 `dsh plugin` 是 pnpm 的转发器。安装包内置的
  插件不受影响；缺少 pnpm 时日志会说明需要安装什么。首次运行的环境准备流程**不**依赖 pnpm。
- 接管模式下的**停止**会结束在该端口上监听的进程，包括手动启动的实例。
- 余额与当日用量读取桌面宠物的 `/dsh-pet/balance.json`。未配置 API Key 时显示 `--`，服务状态仍
  正常上报。
- 本地记账模式下，「今日已用」由余额差值推导，因此客户端未运行期间产生的消耗不会被计入。此为桌
  面宠物自身的行为。
- 透明 `WebContentsView` 无法通过 CDP 的 `Page.captureScreenshot` 截图（会超时）。如需查看悬浮栏
  外观，请使用 `tools/preview-overlay.js`。

### 6.1 两个环境陷阱

**① 不要向 DSH 注入名称含 `KEY`、`TOKEN` 或 `SECRET` 的环境变量。** `dsh-subprocess` 会按
`/KEY|PASSWORD|SECRET|TOKEN/i` 清洗子进程环境，这是防止凭据泄漏的刻意设计。曾为迫使 git 使用
openssl 而注入 `GIT_CONFIG_COUNT`、`GIT_CONFIG_KEY_0` 与 `GIT_CONFIG_VALUE_0`，结果 `KEY_0` 被清
除而另两个得以保留，git 随即拒绝执行任何操作并报出 `missing config key GIT_CONFIG_KEY_0`。git 的
schannel 后端在非受限进程中工作正常，该绕过方案既无必要亦有害。

**② 随包 DSH 会向子进程泄漏 `ELECTRON_RUN_AS_NODE=1`。** bundled 模式借助该变量使 Electron 以
Node 模式承载 DSH，但它会留在 DSH 进程环境中并被继承。其后果是：**在 DSH 会话中启动任何 Electron
程序，都会以纯 Node 模式运行**（`require('electron').app` 为 `undefined`）并随即崩溃，本客户端的
`npm start` 即属此类。`tools/` 下的脚本均加入 `delete process.env.ELECTRON_RUN_AS_NODE` 以自保。
必须运行于 Electron 之内的脚本（如 `make-icon`、`preview-overlay`）应以
`node tools/run-electron.js <脚本>` 启动。若需彻底消除该污染，则须另行分发独立的 `node.exe`，代价
约为 80 MB。

---

## 七、第三方组件与许可

本项目自身代码以 MIT 协议发布。构建产物分发以下第三方组件，均为 MIT 协议：

| 组件 | 许可 | 来源 |
|---|---|---|
| [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（`@deepseek-ai/dsh` 及其依赖） | MIT | npm，构建时由 `tools/stage-vendor.js` 获取 |
| [小鲸鱼余额挂件](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | MIT © 2026 MeteorNOX | 构建时自上游仓库获取 |
| [Electron](https://github.com/electron/electron) | MIT | npm |

关于小鲸鱼余额挂件：上游采用 **MIT** 协议，明确允许再分发（`publish, distribute, sublicense`），
因此将其随包分发于安装包内是合规的。该插件自身的 `LICENSE` 文件会一并分发于安装包内，满足 MIT 要
求的保留版权与许可声明之义务。

本仓库**不包含**上述第三方组件的源码；`vendor/` 已通过 `.gitignore` 排除，物料在构建时由
`npm run stage` 获取。

---

## 八、许可证

本项目以 [MIT License](LICENSE) 发布。

安装包内随包分发的第三方组件（DeepSeek Harness、小鲸鱼余额挂件、Electron）同样为 MIT 协议，各自
的版权声明见其自身的 `LICENSE` 文件。
