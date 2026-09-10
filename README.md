# DSH 桌面客户端

把 DeepSeek Harness 装进一个真正的桌面应用：**双击即用，不用敲命令、不用开浏览器，也不用先装 Node.js**。

安装包**自带 DSH 本体**，开箱即可运行；DSH 界面铺满窗口，所有控制项以**悬浮选项栏**浮在右上角。

---

## 给最终用户

### 安装

双击 `DSH-Client-Setup-0.1.0.exe`，一路下一步即可（默认装到当前用户目录，无需管理员权限），
安装完桌面会多一个 **DSH 客户端** 快捷方式。

**目标机器不需要预装 Node.js / pnpm / npx** —— 安装包里已经带了。

### 首次启动

双击快捷方式。客户端会自动：

1. 在 `%USERPROFILE%\.dsh` 下创建 DSH 的 web profile；
2. 把随包附带的小鲸鱼余额挂件装好并启用；
3. 拉起 DSH 服务并直接显示界面。

唯一还需要你配置的是 **`DEEPSEEK_API_KEY`**（拉取余额用），写在 `%USERPROFILE%\.dsh\.credentials.yaml` 里。
没配也能正常用，只是余额和挂件会显示未配置。

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
| **设置** | 开机自启、自动拉起服务等开关，环境探测结果，隐藏窗口，退出客户端 |

双击悬浮条空白处也能开合；展开后按 `Esc` 收起。服务未运行时，悬浮栏会铺满成全窗口的
**控制台形态**（不再是单独的「服务未运行」页面）；启动中／停止中保持悬浮条形态。

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
npm run build        # 生成 dist\DSH-Client-Setup-<version>.exe
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
