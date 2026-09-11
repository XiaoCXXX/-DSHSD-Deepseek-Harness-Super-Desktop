# DSH Desktop Client

**English** | [中文](README.zh.md)

> ⚠️ Note: this project was written entirely by DeepSeek — including most of this document. I only maintain it: I direct the agent and verify that the information is correct.

> **DSHSD** = **D**eepseek **H**arness **S**uper **D**esktop — the project's short name. It is what the installer (`DSHSD-Setup-<version>.exe`) and the desktop shortcut are called.

Puts DeepSeek Harness into a real desktop application: **double-click and go — no commands to type, no browser to open, and no need to install Node.js first.**

The installer **ships DSH itself**, so it runs out of the box. The DSH UI fills the window and every control lives in a **floating panel** pinned to the top-right corner. The client extends DSH: you can configure things while the service is stopped, and it adds a full theming system.

---

## For end users

The long sections below explain how the client works internally. The short version:

1. Download the installer from [Releases](../../releases)
2. Install the client
3. Double-click the client shortcut

On first launch you need to configure your own API key — that part should be obvious.

### Install

Double-click `DSHSD-Setup-<version>.exe` (currently `DSHSD-Setup-0.1.3.exe`) and keep clicking Next.
It installs into your user folder, so no administrator rights are needed, and adds a **DSHSD** shortcut to your desktop.

**The target machine does not need Node.js, pnpm or npx** — everything is bundled.

### First launch

Double-click the shortcut. The client will:

1. create DSH's web profile under `%USERPROFILE%\.dsh`;
2. install and enable the bundled whale balance widget;
3. start the DSH service and show its UI.

**Every user must configure their own `DEEPSEEK_API_KEY`.** Get one from the DeepSeek open platform.
DSH itself prompts for it on first run — you never have to go hunting for a config file.

> Closing the window only minimizes to the **tray**; the service keeps running. To really quit, use
> **Quit client** in the panel's Settings section, or right-click the tray icon → Quit.

### UI

```
┌─ Window (DSH UI fills it)───────────┐
│                    ┌─────────────┐  │
│                    │● Running    │  │ ← floating bar, top-right
│                    │ CNY 147.18  │  │
│                    │ ▶ ■ ⟳ ⋯     │  │
│                    └─────────────┘  │
└─────────────────────────────────────┘
```

Click `⋯` to expand five collapsible sections:

| Section | Contents |
|---|---|
| **Service** | port / PID / uptime / working directory; start · stop · restart · open in browser |
| **Projects** | project list (working directory + port); create / edit / delete / switch |
| **Plugins** | installed plugins (version, whether it is a UI layer); update / uninstall, or install by package name |
| **Logs** | server / client / plugin output; filter, clear, open the log file |
| **Settings** | launch at login, auto-start, theme, language, auto view switching, environment probe, hide window, quit |

Double-clicking an empty part of the bar also toggles it; press `Esc` to collapse.

View switches, section expand/collapse and button presses are all animated; switching themes fades
colors smoothly. Animations are disabled automatically when the system asks for reduced motion.

### Themes

Six themes — **DSH White/Blue** and **DSH Dark** (the two native ones) plus **Ice**, **Ocean**,
**Midnight** and **High Contrast**. One switch drives both planes: this client's own `--c-*` tokens
*and* the DSH web UI's `--dsw-*` tokens.

The DSH side is handled by [`plugins/dsh-theme-pack`](plugins/dsh-theme-pack), one of the two DSH plugins
that ship inside the installer. It serves the theme payload, injects a small applier script into the DSH
page, and keeps the state in `$DSH_HOME/.dsh-theme.json`. The applier writes the palette as inline
`!important` custom properties on `<html>`/`<body>` so DSH's own theme presenter cannot override it,
and pins the base color scheme (`body[data-ds-dark-theme]`) to match the selected theme.

For a **native** theme the applier clears everything it wrote and steps back entirely — otherwise the
previous theme's `!important` variables would keep overriding DSH's own palette, which is exactly the
bug where switching back to a native theme appeared to do nothing.

### Three view modes, switched manually

The client has three modes: **floating bar + DSH UI** (`bar`), **full-window client console** (`console`),
and **portable floating window** (`bubble`).

By default you switch **manually**: the `▣` button in the bar opens the console, and
**Back to DSH** in the console header returns. Your choice is remembered across restarts.
The `❐` button enters the portable floating window.

To let the mode follow the service instead (console when stopped, bar when running), enable
**Settings → Switch the view automatically with the service**. Clicking the manual switch turns that
setting off implicitly — otherwise the next service state change would override your choice.
The portable floating window can only be picked by hand: it has nothing to do with whether the service
is running, so there is nothing to derive it from.

### Portable floating window (quick ask)

In this mode the whole client is just two things: the **floating console** and a **typeable bubble**.

- A frameless, always-on-top, 380×540 window; the header strip is the drag handle.
- Ask a question in the bubble. The answer streams into the bubble while it runs, and when the turn
  ends the full text is condensed to **one sentence**.
- **View full answer** switches back to the window that shows the DSH UI — the full reply is right
  there in the conversation.
- `✕` hides the floating window (it does not quit the client); `⤢` jumps to the DSH UI.

Two settings under **Settings → Portable floating window**:

| Setting | Values | Meaning |
|---|---|---|
| Which session quick ask uses | active session / dedicated session | Active reuses the conversation you are in, so the full answer is already on screen. Dedicated opens a separate `快速提问 / Quick ask` session and leaves your conversations alone. |
| How the short answer is produced | model / truncate | Model makes a second, small LLM call (same route as the answer, thinking disabled) asking for one sentence. Truncate just cuts the full answer — used automatically when the model call fails. |

#### How quick ask is wired

The client does **not** speak DSH's internal RPC. Instead the installer ships a second small DSH plugin,
[`plugins/dsh-quick-ask`](plugins/dsh-quick-ask), which runs inside the DSH process and exposes one
ordinary SSE route:

```
GET /dsh-quick/ask?id=…&q=…&session=active|dedicated&summary=model|truncate
    → text/event-stream: answer / summary / done / error
```

Inside DSH it uses `ctx.sessionController` to create/resume a session and admit the prompt,
`ctx.on('session/event')` to watch that exact turn (matched by the prompt's `requestId`), and
`ctx.llm.stream()` for the one-sentence summary. That summary call writes nothing into any session
log, so quick asking never pollutes a conversation.

### UI language

Supports **Chinese / English**. Switch under **Settings → Language**; one switch affects both:

- this client (panel, console, tray menu)
- the DSH UI itself — by writing `locale.preference` (`zh` / `en`) into `$DSH_HOME/settings.yaml`

DSH watches that file with chokidar, so **the change applies immediately with no service restart**.
The write preserves other namespaces in the file (such as `ui-onboarding`). The client also syncs once
at startup so both sides agree — in other words **the client is the single source of truth for language**;
if you change it in DSH's own settings, the next client start will sync it back.

Logs follow the language too: lines produced by the client itself (startup, adoption, cookie minting,
plugin commands) are written in the current language, while **DSH server and pnpm output is passed through
untranslated**. Existing log lines keep the language they were written in.

---

## Architecture

### Single window, layered views

One `BrowserWindow` stacks two `WebContentsView`s:

```
┌─ Window ──────────────────────────────────┐
│  dshView        DSH UI (fills the window) │  ← shown while running
│  overlayView    floating panel (transparent, on top) │  ← always on top
└───────────────────────────────────────────┘
```

**The key trick**: the overlay view is sized to exactly its own content (about 320×54 collapsed,
396×702 expanded). Areas outside the panel therefore do not belong to the overlay view at the OS level,
so mouse events reach the DSH UI underneath — there is no "invisible mask swallowing clicks".
The panel is anchored **top-right** to stay clear of the whale widget in the bottom-right corner.

### Runtime (two modes)

`lib/runtime.js` resolves in priority order:

| Mode | When | node | dsh |
|---|---|---|---|
| **bundled** | `resources/dsh/` exists (installed build) | **Electron's built-in Node** (`ELECTRON_RUN_AS_NODE=1`) | `resources/dsh/node_modules/@deepseek-ai/dsh` |
| **system** | development / not packaged | system `node.exe` | npx cache or globally installed dsh |

The packaged build does not need to ship a separate `node.exe`; it uses Electron's built-in Node 24.

> **`--expose-internals` is required.** DSH's HMR service needs Node internals.
> `cordis-plugin-loader` has two ways to get them — with that flag it uses `require()`, otherwise it
> falls back to the native addon `node-addon-require-builtin`, which is compiled against system Node's
> ABI and fails to load under Electron. So bundled mode always passes the flag (see `lib/runtime.js`).

### First-run provisioning

`lib/provision.js` does not depend on pnpm:

1. if the profile does not exist, generate `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml`
   from DSH's own template;
2. copy `resources/plugins/dsh-whale-widget` into the profile's `node_modules`
   (only when missing; if the profile already has one, it is upgraded only when the bundled version is newer);
3. add the plugin name to `dsh.profile.bundles`.

> Why it must be copied into the profile's `node_modules`: a bundle is imported as an **ES module from
> the profile directory**. Leaving it only at the DSH install anchor lets `resolveBundleDir` find it,
> but the import itself fails with `ERR_MODULE_NOT_FOUND`.

### Authentication (why there is no manual login)

DSH generates a random token at startup and prints a URL containing `?token=...` to stdout.
Visiting that URL makes the server set a signed cookie bound to `host:port` (valid for 30 days).
The client uses both routes:

1. when it starts the service itself → it reads the token straight from stdout;
2. when it adopts a service someone else started → it **mints the same cookie itself** using the signing
   key from the credential store.

The signing scheme (`lib/auth-cookie.js`, mirrored from `@deepseek-ai/dsh-client-connection`):

```
cookie name  = "dsh-auth-" + base64url(sha256(authority))
cookie value = "v1." + base64url(JSON{version,authority,issuedAt,expiresAt})
                    + "." + base64url(HMAC-SHA256(secret, <the middle base64url string>))
secret       = payload.secret of client-connection/browser-session in $DSH_HOME/.credentials.yaml
```

Because the key is persisted in the credential store and the cookie is bound to `127.0.0.1:<port>`
rather than to a process, it **stays valid across service restarts**.

---

## Development

```powershell
npm install
npm start                      # dev run (system node + installed dsh)
npm start -- --hidden          # no windows at all, for automation

node tools/selftest.js         # capability self-check without Electron (includes cookie minting)
node tools/verify.js           # UI/structure verification + screenshots (.verify\)
node tools/verify-lifecycle.js # real start → restart → stop on a spare port
node tools/verify-packaged.js  # bundled-DSH runtime against a fresh DSH_HOME
node tools/verify-i18n-live.js # language switching, animations, surface toggle
node tools/run-electron.js tools/preview-overlay.js  # render just the panel and screenshot it
node tools/run-electron.js tools/make-icon.js        # regenerate assets/icon.ico
```

### Build

```powershell
npm run build        # produces dist\DSHSD-Setup-<version>.exe
npm run build:dir    # unpacked directory only (dist\win-unpacked), for debugging
npm run verify:build # verify the artifact: run the packaged exe and probe its routes
```

Vendor staging is done by `tools/stage-vendor.js`:

- `vendor/dsh/` — the DSH runtime, installed with `npm install @deepseek-ai/dsh@<version>` (~212 MB)
- `vendor/plugins/dsh-whale-widget/` — the bundled widget (fetched from its upstream repo if absent)

Overridable via environment variables: `DSH_VERSION` (default `0.1.5-rc.1`), `WHALE_SOURCE`.

> **Maintainer note**: electron-builder's filter
> (`app-builder-lib/out/util/filter.js`) **unconditionally excludes** any directory whose relative path
> is or ends with `/node_modules`, so an entire `node_modules` tree is silently dropped from
> `extraResources` (`filter: ["**/*"]` does not help). `electron-builder.config.js` therefore enumerates
> every `node_modules` directory at build time and points `from` *inside* each one, so the relative paths
> become package names instead of `node_modules`.

### Layout

```
dsh-client/
├── main.js                     Electron main process (single window, views, tray, IPC, balance polling)
├── preload.js                  contextBridge safety bridge
├── electron-builder.config.js  packaging config (dynamic extraResources)
├── lib/
│   ├── runtime.js              runtime resolution (bundled / system) + the flag rationale
│   ├── provision.js            first-run profile setup and plugin pre-install
│   ├── i18n.js                 zh/en dictionaries shared by main and renderer
│   ├── dsh-settings.js         writes DSH's own language preference
│   ├── config.js               persisted config and projects
│   ├── dsh-locator.js          locates node / dsh / widget assets
│   ├── auth-cookie.js          mints the session cookie
│   ├── server-manager.js       service process lifecycle
│   └── logger.js               ring buffer + file log
├── renderer/
│   ├── control.html/css/js     floating panel / full-window console
│   └── i18n.js                 renderer-side lookup
├── tools/                      self-checks, verification, preview, icon, vendor staging
├── vendor/                     build payload (dsh / plugins, generated)
└── dist/                       build output
```

---

## Config and data locations

| What | Path |
|---|---|
| Client config | `%APPDATA%\dsh-desktop-client\config.json` |
| Client log | `%APPDATA%\dsh-desktop-client\logs\dsh-client.log` |
| Electron session (cookies) | `%APPDATA%\dsh-desktop-client\Partitions\` |
| DSH home / profile | `%USERPROFILE%\.dsh\` |
| Widget usage ledger | `%USERPROFILE%\.dsh\.dshw-usage.json` |

---

## Known limitations

- Windows x64 only (stopping processes uses `taskkill`, port probing uses `netstat`).
- **Installing / updating / removing plugins still needs pnpm on the system** (`dsh plugin` is a pnpm
  forwarder). The bundled widget is unaffected, and the log explains what to install when pnpm is missing.
  The first-run widget pre-install path does **not** need pnpm.
- **Stop** in adopted mode ends whatever process is listening on the port — including an instance you
  started by hand.
- Balance and today's usage come from the widget's `/dsh-whale/balance.json`; without an API key they show
  `--` while the service still reports its state normally.
- In local-ledger mode "used today" is derived from balance deltas, so consumption that happens while the
  client is not running is not counted (the widget's own behaviour).
- Dev note: a transparent `WebContentsView` cannot be captured with CDP
  `Page.captureScreenshot` (it times out); use `tools/preview-overlay.js` to inspect the panel.

### Two environment traps worth knowing

**① Never inject environment variables whose names contain `KEY` / `TOKEN` / `SECRET` into DSH.**
`dsh-subprocess` scrubs the child environment with `/KEY|PASSWORD|SECRET|TOKEN/i` (a deliberate
credential-leak defence). Injecting `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0`
to force git onto openssl left `KEY_0` scrubbed while the other two survived, and git then refused to
run anything with `missing config key GIT_CONFIG_KEY_0`. git's schannel backend works fine in an
unrestricted process, so that workaround was both unnecessary and harmful.

**② The bundled DSH leaks `ELECTRON_RUN_AS_NODE=1` to its children.**
Bundled mode uses that variable to make Electron host DSH as Node, but it stays in the DSH process
environment and is inherited. Consequence: **launching any Electron program from inside a DSH session
runs it as plain Node** (`require('electron').app` is `undefined`) and it crashes — `npm start` for this
very client included. Scripts under `tools/` add `delete process.env.ELECTRON_RUN_AS_NODE` for
self-defence; scripts that must run *inside* Electron (`make-icon`, `preview-overlay`) should be started
with `node tools/run-electron.js <script>`. To remove the pollution entirely you would have to ship a
separate `node.exe` (about +80 MB).

---

## Third-party components and licenses

This project's own code is released under MIT. The build bundles the following third-party components,
all MIT:

| Component | License | Source |
|---|---|---|
| [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (`@deepseek-ai/dsh` and its dependencies) | MIT | npm, fetched at build time by `tools/stage-vendor.js` |
| [Whale balance widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) (`dsh-whale-widget`) | MIT © 2026 MeteorNOX | fetched at build time from its upstream repo |
| [Electron](https://github.com/electron/electron) | MIT | npm |

On the whale widget: upstream is **MIT**, which explicitly permits redistribution
(`publish, distribute, sublicense`), so bundling it in the installer is compliant. The plugin's own
`LICENSE` file ships inside the installer at `resources/plugins/dsh-whale-widget/LICENSE`, satisfying
MIT's requirement to preserve the copyright and permission notice.

This repository **does not contain** the source of those third-party components (`vendor/` is excluded
via `.gitignore`); they are fetched by `npm run stage` at build time.

---

## License

Released under the [MIT License](LICENSE).

The third-party components bundled in the installer (DeepSeek Harness, the whale widget, Electron) are
also MIT; see their own `LICENSE` files for the respective copyright notices.
