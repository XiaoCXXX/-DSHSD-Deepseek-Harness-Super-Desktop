# 第三方挂件耦合审计（dsh-whale-widget）

- **状态**：归档结论，**未改动任何代码**（2026-09-10）
- **背景**：`dsh-whale-widget`（`github:MeteorNOX/DeepSeek-Balance-Whale-Widget`）是**第三方插件，不属于我们**。
  我们不自有、不维护、不改造它；后续会换成自己的挂件（素材正在约稿）。
- **本文目的**：把「我们自己的代码里依赖它的地方」盘清楚，避免将来替换时到处漏。
- **行号基准**：2026-09-10 完成主题改造后的代码。

---

## 结论速览

| 类别 | 位置数量 | 影响 |
|---|---|---|
| ① 写死指向该包（包名 / 仓库地址 / 资源名 / 路由前缀） | 7 个文件 | 换挂件时必须逐处修改 |
| ② 功能绑死在它的 HTTP 路由上（余额数据源） | 客户端 2 处 + 验证 2 处 | 「余额显示」目前没有自己的数据源 |
| ③ **反向依赖：我们自己的图标用了它的素材** | 3 处 | 最该优先解开 |
| ④ 仅文档 / 无关 | README、`.dshw-usage.json` 忽略规则、占位页 emoji | 无功能风险 |

---

## ① 写死的第三方标识

| 文件 | 位置 | 内容 |
|---|---|---|
| `main.js` | `L41` / `L42` | `WHALE_SPEC = 'github:MeteorNOX/DeepSeek-Balance-Whale-Widget'`、`WHALE_NAME = 'dsh-whale-widget'` |
| `renderer/control.js` | `L8` | 又一份 `WHALE_SPEC` 常量（与主进程重复） |
| `renderer/control.js` | `L237`–`L246` | 未安装时的占位卡片写死包名与「余额挂件」文案，安装按钮默认用该 spec |
| `lib/dsh-locator.js` | `L111`–`L133` | `findWhaleAssets()` 只在两处找 `dsh-whale-widget/assets/DSniang1.png` |
| `main.js` | `L614`–`L616` | 插件安装/更新/卸载的默认参数用 `WHALE_SPEC` / `WHALE_NAME` |
| `tools/stage-vendor.js` | `L19`,`L42`–`L67` | 打包物料阶段把该插件复制进 `vendor/plugins/`（可用 `WHALE_SOURCE` 覆盖来源） |
| `tools/preview-overlay.js` | `L46`–`L56` | 预览用的假状态里写死挂件条目与资源路径 |

## ② 绑死在它的路由上

| 文件 | 位置 | 用途 |
|---|---|---|
| `main.js` | `L577` | 手动刷新余额：`GET /dsh-whale/balance.json` |
| `main.js` | `L715` | 定时余额轮询（悬浮条上的余额数字） |
| `tools/preflight-install.js` | `L91` | 安装前自检里探测该路由 |
| `tools/verify-lifecycle.js` | `L139`–`L141` | 生命周期验证里把「余额接口可用」当成一项 |

> 也就是说：**「余额显示」这个能力的数据源是借来的**。换成自有挂件时，要么继续提供同名路由，要么把数据源抽象出来。

## ③ 反向依赖：我们的图标是人家的素材（建议最先解开）

| 文件 | 位置 | 说明 |
|---|---|---|
| `main.js` | `L110`–`L122` | `whaleIcon()` / `trayImage()` 读挂件 PNG 作为窗口与托盘图标；资源缺失时回落 `nativeImage.createEmpty()`（优雅降级，不崩，但会没有图标） |
| `tools/make-icon.js` | `L9`–`L13` | 打包用的 `.ico` 由挂件 PNG 生成（资源缺失时该工具直接失败） |
| `lib/dsh-locator.js` | `L111`–`L133` | 上述两处都经由 `findWhaleAssets()` |

> **风险**：挂件被卸载、升级改了素材名、或仓库改名，我们自己的窗口/托盘图标就跟着失效。这条依赖方向和「用它当第三方插件」是反的——我们借了它的美术资源，理应最先切断。

## ④ 其他

- `tools/verify-build.js` `L58`/`L111`–`L121`、`tools/verify-packaged.js` `L64`–`L133`：断言 `resources/plugins/dsh-whale-widget/` 存在、`/dsh-whale/*` 路由可用。换包后这些断言必然变红，属于预期。
- `main.js` `L265` 附近注释：悬浮栏锚定右上角的理由是「避开右下角的小鲸鱼挂件」——**布局假设**，自有挂件若换位置需同步调整。
- `tools/audit-secrets.js` `L63`：忽略 `.dshw-usage.json`（它的账本文件），换掉后可清理。
- `README.md`：多处描述随包预装该挂件、余额来源等，属文档层面。
- `renderer/placeholder.html` `L58` 的 🐋 是自写 emoji，**无依赖**。

---

## 换成自有挂件时需要动的点（清单）

- [ ] 包名 / 仓库地址 / 插件 spec：`main.js`（2 处常量）、`renderer/control.js`（常量 + 占位卡片文案）
- [ ] 资源定位：`findWhaleAssets()` 泛化为按配置找目录（并改判据文件名）
- [ ] 图标：改从**我们自己的 assets** 取图，同时更新 `tools/make-icon.js`
- [ ] 余额数据源：新增自有路由，或把「余额来源」抽象成一个 provider
- [ ] 打包物料：`tools/stage-vendor.js` 的目标包名与来源
- [ ] 验证断言：`verify-build.js` / `verify-packaged.js` / `verify-lifecycle.js` / `preflight-install.js` / `preview-overlay.js`
- [ ] 布局假设：悬浮栏避让位置（若自有挂件不在右下角）
- [ ] 文档：`README.md` 相关段落

## 已经具备的有利条件（替换成本比看上去低）

1. **`lib/provision.js` 本来就是参数化的**：它只接收 `plugins: [{ name, sourceDir }]`，
   不认具体插件名；写死包名的只有调用方 `main.js`（`L170`–`L179`）。首次运行预装这条路不用重写。
2. **主题系统已就绪且是我们自有的**：自有挂件只要用 `--dsw-alias-*` 令牌着色，
   就会自动跟随 6 套主题（`dsh-theme-pack` 已把令牌与基底模式钉住）。见 `../dsh-theme-pack/README.md`。
3. **注入方式的参考已经是我们自己的**：`dsh-theme-pack` 自带了
   `ctx.webServer.register({ kind:'exact', path, handler })` + `ctx.webServer.tapIndex(fn)`
   的可用示例，做自有挂件时不必再参考第三方包。

---

## 待办（已与用户确认：**先只归档，暂不动代码**）

- [ ] 「挂件集成契约 + 素材规格」文档（给画师：张数/姿态/透明背景/尺寸/在浅色与暗色主题下都可读；
      给开发者：令牌约定、插件形态、是否继续提供余额路由）
- [ ] 把上述耦合收敛成**可替换的挂件槽位**（配置化包名/资源目录/余额路由；图标改自有素材）
