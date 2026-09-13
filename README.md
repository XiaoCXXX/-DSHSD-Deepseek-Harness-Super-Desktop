# DSH Desktop Client

**English** | [中文](README.zh.md)

## Overview

DSH Desktop Client is a Windows desktop host for **DeepSeek Harness (DSH)**. It packages the DSH
service, its web interface and a set of companion plugins into a single application, so that starting
DSH does not require a terminal, a manually opened browser, or a pre-installed Node.js toolchain.

**DSHSD** = **D**eepseek **H**arness **S**uper **D**esktop. This abbreviation is the project's short
name; it is also the name of the installer (`DSHSD-Setup-<version>.exe`), of the desktop shortcut and
of the uninstall entry.

### Principal characteristics

- The installer **bundles the DSH runtime**. The target machine requires no Node.js, pnpm or npx.
- The DSH web interface fills the application window; all client controls reside in a **floating
  options bar** anchored to the top-right corner.
- The client extends DSH in two directions: configuration remains available while the service is
  stopped, and a complete theming system is added on top of DSH's own appearance.
- The client is **self-contained and offline-capable at install time**; it contains no credentials of
  any kind and performs no model calls of its own.

> **Note on authorship.** The source code and the majority of this document were produced by
> DeepSeek. The maintainer's role is to direct the agent and to verify that the information presented
> here is accurate.

---

## 1. Installation and first launch

### 1.1 Requirements

| Item | Requirement |
|---|---|
| Operating system | Windows 10 / 11, x64 |
| Disk space | Approximately 500 MB after installation |
| Privileges | Administrator (the installer is machine-wide) |
| Pre-installed runtimes | None. Node.js, pnpm and npx are **not** required |
| Credentials | A personal `DEEPSEEK_API_KEY` |

### 1.2 Installation procedure

1. Download `DSHSD-Setup-<version>.exe` from [Releases](../../releases). The current version is
   `1.0.0-HF1`.
2. Run the installer and follow the prompts. Because the package installs machine-wide, Windows
   requests elevation once; approve it.
3. The installer creates a **DSHSD** shortcut on the desktop and an uninstall entry in
   *Apps & features*.

> When upgrading from a build earlier than `1.0.0-HF1`, the uninstall entry may appear twice, because
> that version changed from a per-user to a machine-wide installation and the registration moved from
> `HKCU` to `HKLM`. The obsolete per-user entry can be removed.

### 1.3 First launch

Starting the client from the shortcut performs the following steps, in order:

1. creates the DSH web profile under `%USERPROFILE%\.dsh` if it does not yet exist;
2. installs and enables the plugins that ship inside the installer;
3. starts the DSH service and displays its interface in the application window.

**Every user must supply their own API key.** It is obtained from the DeepSeek open platform. DSH
prompts for it on first launch; no configuration file has to be located or edited by hand.

> Closing the application window only minimizes it to the **tray**; the service continues to run. To
> terminate the client, use **Exit client** in the *Settings* section, or right-click the tray icon and
> choose *Exit*.

---

## 2. User interface

### 2.1 Layout

```
┌─ Window (DSH interface fills it)────┐
│                    ┌─────────────┐  │
│                    │● Running    │  │ ← floating bar, top-right
│                    │ CNY 147.18  │  │
│                    │ ▶ ■ ⟳ ⋯     │  │
│                    └─────────────┘  │
└─────────────────────────────────────┘
```

Selecting `⋯` expands the bar into five collapsible sections:

| Section | Contents |
|---|---|
| **Service** | Port, process ID, uptime and working directory; start, stop, restart, open in browser |
| **Projects** | Project list (working directory and port); create, edit, delete, switch |
| **Plugins** | Installed plugins with version and UI-layer status; update, uninstall, or install by package name |
| **Logs** | Server, client and plugin output; filter, clear, open the log file |
| **Settings** | Launch at login, automatic service start, theme, language, automatic view switching, environment probe, hide window, exit client |

Double-clicking an empty area of the bar toggles it as well; `Esc` collapses it.

View switches, section expansion and button presses are animated, and color transitions between themes
are interpolated. All animation is disabled automatically when the operating system requests reduced
motion.

### 2.2 Themes

Six themes are provided: the two native DSH themes (**DSH White/Blue** and **DSH Dark**), plus
**Ice**, **Ocean**, **Midnight** and **High Contrast**. A single selection drives both presentation
layers — the client's own `--c-*` tokens and the DSH web interface's `--dsw-*` tokens.

The DSH side is implemented by [`plugins/dsh-theme-pack`](plugins/dsh-theme-pack), one of the DSH
plugins distributed inside the installer. It serves the theme payload, injects a small applier script
into the DSH page, and persists state in `$DSH_HOME/.dsh-theme.json`. The applier writes the palette as
inline `!important` custom properties on `<html>` and `<body>`, so that DSH's own theme presenter
cannot override it, and pins the base color scheme (`body[data-ds-dark-theme]`) to match the selected
theme.

When a **native** theme is selected, the applier removes every variable it previously wrote and
releases the pinned base color scheme, returning full control to DSH. Without this step the
`!important` variables from the previous theme would continue to override DSH's own palette, which is
the defect in which switching back to a native theme appeared to have no effect.

### 2.3 View modes

The client provides three view modes: **floating bar with the DSH interface** (`bar`), **full-window
client console** (`console`), and **portable floating window** (`bubble`).

By default, switching is **manual**: the `▣` button in the bar opens the console, and **Back to DSH**
in the console header returns to the bar. The selection is persisted across restarts. The `❐` button
enters the portable floating window.

To let the mode follow the service state instead — console while stopped, bar while running — enable
**Settings → Switch the view automatically with the service**. Selecting a mode manually disables that
setting implicitly; otherwise the next service state change would override the manual selection. The
portable floating window can only be selected manually, since it is independent of whether the service
is running and therefore cannot be derived from it.

### 2.4 Portable floating window (quick ask)

In this mode the client consists of exactly two elements: the **floating console** and a **typeable
bubble**.

- A frameless, always-on-top window of 380×540; the header strip serves both as the console and as the
  drag handle.
- A question is entered in the bubble. The answer streams into the bubble while the turn is running,
  and once the turn ends the full text is condensed into **one sentence**.
- **View full answer** returns to the window that displays the DSH interface, where the complete reply
  appears in the conversation.
- `✕` hides the floating window without terminating the client; `⤢` switches directly to the DSH
  interface.

Two options are available under **Settings → Portable floating window**:

| Option | Values | Meaning |
|---|---|---|
| Session used by quick ask | Active session / Dedicated session | *Active* reuses the conversation currently open, so the full answer is already on screen. *Dedicated* opens a separate `快速提问 / Quick ask` session and leaves existing conversations untouched. |
| Production of the short answer | Model / Truncate | *Model* issues one additional small model call, on the same route as the answer and with reasoning disabled, requesting a single sentence. *Truncate* simply cuts the full answer. Truncation is applied automatically if the model call fails. |

#### 2.4.1 Implementation of quick ask

The client does **not** use DSH's internal RPC. The installer instead ships a second DSH plugin,
[`plugins/dsh-quick-ask`](plugins/dsh-quick-ask), which runs inside the DSH process and exposes a
single ordinary SSE route:

```
GET /dsh-quick/ask?id=…&q=…&session=active|dedicated&summary=model|truncate
    → text/event-stream: answer / summary / done / error
```

Inside DSH the plugin uses `ctx.sessionController` to create or resume a session and to submit the
prompt, `ctx.on('session/event')` to observe that specific turn, matched by the prompt's `requestId`,
and `ctx.llm.stream()` for the one-sentence summary. The summary call writes nothing to any session
log, so quick asking never pollutes a conversation.

### 2.5 Interface language

The interface is available in **Chinese and English**, selectable under **Settings → Language**. A
single selection applies to both layers:

- the client itself — options bar, console and tray menu;
- the DSH interface — by writing `locale.preference` (`zh` or `en`) into `$DSH_HOME/settings.yaml`.

DSH watches that file with chokidar, so the change takes effect immediately and **no service restart is
required**. The write preserves other namespaces in the file, such as `ui-onboarding`. The client also
synchronizes the value once at startup so that both layers agree. The client is therefore the single
point of control for language: a change made in DSH's own settings is reverted on the next client
start.

Log output follows the same setting. Lines produced by the client itself — startup, adoption, cookie
minting, plugin commands — are written in the current language, whereas **DSH server and pnpm output is
passed through untranslated**. Existing log lines retain the language in which they were written.

---

## 3. Architecture

### 3.1 Layered views within a single window

One `BrowserWindow` hosts two stacked `WebContentsView` instances:

```
┌─ Window ──────────────────────────────────┐
│  dshView        DSH interface (fills window) │  ← shown while running
│  overlayView    floating bar (transparent, on top) │  ← always on top
└───────────────────────────────────────────┘
```

The essential property is that the overlay view is sized to exactly the dimensions of its own content
(approximately 320×54 collapsed and 396×702 expanded). Areas outside the bar therefore do not belong to
the overlay view at the operating-system level, and mouse events reach the DSH interface beneath it.
There is consequently no invisible mask that intercepts clicks. The bar is anchored to the top-right
corner in order to remain clear of the desktop pet in the bottom-right.

### 3.2 Runtime resolution

`lib/runtime.js` resolves the runtime in the following priority order:

| Mode | Applicable when | node | dsh |
|---|---|---|---|
| **bundled** | `resources/dsh/` exists (installed build) | Electron's built-in Node (`ELECTRON_RUN_AS_NODE=1`) | `resources/dsh/node_modules/@deepseek-ai/dsh` |
| **system** | development, or unpackaged | system `node.exe` | npx cache or a globally installed dsh |

The packaged build does not distribute a separate `node.exe`; it uses Electron's built-in Node 24.

> **The `--expose-internals` flag is required.** DSH's HMR service relies on Node internals.
> `cordis-plugin-loader` has two ways of obtaining them: with the flag it uses `require()`, otherwise
> it falls back to the native addon `node-addon-require-builtin`, which is compiled against system
> Node's ABI and fails to load under Electron. Bundled mode therefore always passes the flag; see
> `lib/runtime.js`.

### 3.3 First-run provisioning

`lib/provision.js` does not depend on pnpm:

1. if the profile does not exist, `package.json`, `cordis.patch.yml` and `pnpm-workspace.yaml` are
   generated from DSH's own template;
2. the bundled plugins are copied into the profile's `node_modules`. Missing files are always
   installed; an existing installation is refreshed when the bundled build is newer **or** its
   content hash differs, so a stale copy cannot survive an upgrade;
3. the plugin names are added to `dsh.profile.bundles`.

> The copy into the profile's `node_modules` is mandatory because a bundle is imported as an **ES
> module relative to the profile directory**. Leaving it only at the DSH installation anchor allows
> `resolveBundleDir` to locate it, but the import itself then fails with `ERR_MODULE_NOT_FOUND`.

### 3.4 Authentication

DSH generates a random token at startup and prints a URL containing `?token=…` to stdout. Visiting
that URL causes the server to set a signed cookie bound to `host:port` and valid for 30 days. The
client uses both mechanisms:

1. when it starts the service itself, it reads the token directly from stdout;
2. when it adopts a service started by another process, it **mints the same cookie itself**, using the
   signing key from the credential store.

The signing scheme (`lib/auth-cookie.js`, mirrored from `@deepseek-ai/dsh-client-connection`):

```
cookie name  = "dsh-auth-" + base64url(sha256(authority))
cookie value = "v1." + base64url(JSON{version,authority,issuedAt,expiresAt})
                    + "." + base64url(HMAC-SHA256(secret, <the middle base64url string>))
secret       = payload.secret of client-connection/browser-session in $DSH_HOME/.credentials.yaml
```

Because the key is persisted in the credential store and the cookie is bound to `127.0.0.1:<port>`
rather than to a process, it remains valid across service restarts.

---

## 4. Development

### 4.1 Commands

```powershell
npm install
npm start                      # development run (system node + installed dsh)
npm start -- --hidden          # no windows at all, for automation

node tools/selftest.js         # capability self-check without Electron (includes cookie minting)
node tools/verify.js           # interface and structure verification, with screenshots (.verify\)
node tools/verify-lifecycle.js # real start → restart → stop on a spare port
node tools/verify-packaged.js  # bundled-DSH runtime against a fresh DSH_HOME
node tools/verify-i18n-live.js # language switching, animations, view switching
node tools/check-sync.js       # verifies the three plugin copies are identical
node tools/run-electron.js tools/preview-overlay.js  # render only the bar and screenshot it
node tools/run-electron.js tools/make-icon.js        # regenerate assets/icon.ico
```

### 4.2 Build

```powershell
npm run build        # produces dist\DSHSD-Setup-<version>.exe
npm run build:dir    # unpacked directory only (dist\win-unpacked), for debugging
npm run verify:build # verify the artifact: run the packaged executable and probe its routes
```

Vendor staging is performed by `tools/stage-vendor.js`:

- `vendor/dsh/` — the DSH runtime, installed with `npm install @deepseek-ai/dsh@<version>` (about
  212 MB);
- `vendor/plugins/<name>/` — the bundled plugins, taken from `plugins/` in this repository.

Two environment variables override the defaults: `DSH_VERSION` (default `0.1.5-rc.1`).

> **Maintainer note.** electron-builder's filter (`app-builder-lib/out/util/filter.js`)
> unconditionally excludes any directory whose relative path is, or ends with, `/node_modules`, so an
> entire `node_modules` tree is silently dropped from `extraResources`; `filter: ["**/*"]` does not
> help. `electron-builder.config.js` therefore enumerates every `node_modules` directory at build time
> and points `from` *inside* each one, so that the relative paths become package names rather than
> `node_modules`.

### 4.3 Repository layout

```
dsh-client/
├── main.js                     Electron main process (window, views, tray, IPC, balance polling)
├── preload.js                  contextBridge safety bridge
├── electron-builder.config.js  packaging configuration (dynamic extraResources)
├── lib/
│   ├── runtime.js              runtime resolution (bundled / system) and flag rationale
│   ├── provision.js            first-run profile setup and plugin provisioning
│   ├── i18n.js                 zh/en dictionaries shared by main and renderer
│   ├── dsh-settings.js         writes DSH's own language preference
│   ├── config.js               persisted configuration and projects
│   ├── dsh-locator.js          locates node, dsh and plugin assets
│   ├── auth-cookie.js          mints the session cookie
│   ├── server-manager.js       service process lifecycle
│   └── logger.js               ring buffer and file log
├── renderer/
│   ├── control.html/css/js     floating bar and full-window console
│   ├── bubble.html/css/js      portable floating window
│   └── i18n.js                 renderer-side lookup
├── plugins/                    bundled DSH plugins (source of truth)
├── nsis/                       installer customization
├── tools/                      self-checks, verification, preview, icon, vendor staging
├── vendor/                     build payload (generated)
└── dist/                       build output
```

---

## 5. Configuration and data locations

| Item | Path |
|---|---|
| Client configuration | `%APPDATA%\dsh-desktop-client\config.json` |
| Client log | `%APPDATA%\dsh-desktop-client\logs\dsh-client.log` |
| Electron session data (cookies) | `%APPDATA%\dsh-desktop-client\Partitions\` |
| DSH home and profile | `%USERPROFILE%\.dsh\` |
| Desktop pet usage ledger | `%USERPROFILE%\.dsh\.dshw-usage.json` |

---

## 6. Known limitations

- **Windows x64 only.** Stopping processes uses `taskkill` and port probing uses `netstat`.
- **Installing, updating or removing plugins still requires pnpm on the host system**, because
  `dsh plugin` is a pnpm forwarder. The plugins bundled in the installer are unaffected, and the log
  states what to install when pnpm is absent. The first-run provisioning path does **not** require
  pnpm.
- **Stop** in adopted mode terminates whichever process is listening on the port, including an
  instance started manually.
- Balance and daily usage are read from the desktop pet's `/dsh-pet/balance.json`. Without an API key
  they display `--`, while the service still reports its state normally.
- In local-ledger mode, *used today* is derived from balance deltas, so consumption occurring while
  the client is not running is not counted. This is the desktop pet's own behavior.
- A transparent `WebContentsView` cannot be captured with the CDP command `Page.captureScreenshot`,
  which times out. Use `tools/preview-overlay.js` to inspect the bar.

### 6.1 Two environment traps

**① Do not inject environment variables whose names contain `KEY`, `TOKEN` or `SECRET` into DSH.**
`dsh-subprocess` scrubs the child environment with `/KEY|PASSWORD|SECRET|TOKEN/i` as a deliberate
credential-leak defence. Injecting `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0` and `GIT_CONFIG_VALUE_0` in
order to force git onto openssl left `KEY_0` scrubbed while the other two survived, after which git
refused to execute anything, reporting `missing config key GIT_CONFIG_KEY_0`. git's schannel backend
works correctly in an unrestricted process, so that workaround was both unnecessary and harmful.

**② The bundled DSH leaks `ELECTRON_RUN_AS_NODE=1` to its children.** Bundled mode uses that variable
to make Electron host DSH as Node, but it remains in the DSH process environment and is inherited.
Consequently, **launching any Electron program from inside a DSH session runs it as plain Node**
(`require('electron').app` is `undefined`) and it crashes; `npm start` for this client is one such
case. Scripts under `tools/` add `delete process.env.ELECTRON_RUN_AS_NODE` for self-defence. Scripts
that must run *inside* Electron, such as `make-icon` and `preview-overlay`, should be started with
`node tools/run-electron.js <script>`. Eliminating the pollution entirely would require distributing a
separate `node.exe`, at a cost of approximately 80 MB.

---

## 7. Third-party components and licenses

This project's own code is released under the MIT License. The build distributes the following
third-party components, all under MIT:

| Component | License | Source |
|---|---|---|
| [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (`@deepseek-ai/dsh` and its dependencies) | MIT | npm, fetched at build time by `tools/stage-vendor.js` |
| [Whale balance widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | MIT © 2026 MeteorNOX | fetched at build time from its upstream repository |
| [Electron](https://github.com/electron/electron) | MIT | npm |

Regarding the whale balance widget: the upstream project is licensed under **MIT**, which explicitly
permits redistribution (`publish, distribute, sublicense`), so bundling it in the installer is
compliant. The plugin's own `LICENSE` file is distributed inside the installer, satisfying MIT's
requirement to preserve the copyright and permission notice.

This repository **does not contain** the source of those third-party components; `vendor/` is excluded
through `.gitignore` and the material is fetched by `npm run stage` at build time.

---

## 8. License

Released under the [MIT License](LICENSE).

The third-party components distributed inside the installer — DeepSeek Harness, the whale balance
widget and Electron — are likewise MIT licensed; see their own `LICENSE` files for the respective
copyright notices.
